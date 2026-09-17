package app

import "encoding/binary"

// 上游视频结果只回 URL，不带宽高与时长；落资源时留 0 会被前端素材合同拒绝
// （web/src/lib/asset-record.ts 要求视频宽度大于 0），表现为“任务成功但界面报生成失败”。
// 这里在写入前直接解析内存里的 mp4/mov 容器头补真实值：后端运行镜像（alpine）只装了
// ca-certificates/tzdata/wget，没有 ffprobe，不能依赖外部探测进程。
// 非 mp4 家族或解析不出视频轨时返回 ok=false，调用方保持原值，不伪造尺寸。
func videoDimensionsFromBytes(data []byte) (int, int, int64, bool) {
	moov, ok := mp4MoovPayload(data)
	if !ok {
		return 0, 0, 0, false
	}
	// sampleEntryDimensions 只认视频 sample entry，mp4a 这类音频条目的同偏移字节（声道数/位深）
	// 不会被误读成画面尺寸。
	width, height := sampleEntryDimensions(moov)
	if width <= 0 || height <= 0 {
		// 没有可用视频 sample entry 时退回 tkhd；音频轨的 tkhd 宽高为 0，所以 m4a 仍会被拒绝。
		width, height = trackHeaderDimensions(moov)
	}
	if width <= 0 || height <= 0 {
		return 0, 0, 0, false
	}
	return width, height, movieDurationMs(moov), true
}

// mp4MoovPayload 在顶层 box 中定位 moov，返回其 body（不含 box 头）。
func mp4MoovPayload(data []byte) ([]byte, bool) {
	if len(data) < 12 || string(data[4:8]) != "ftyp" {
		return nil, false
	}
	pos := 0
	for pos+8 <= len(data) {
		size := int(binary.BigEndian.Uint32(data[pos : pos+4]))
		boxType := string(data[pos+4 : pos+8])
		body := pos + 8
		switch {
		case size == 1:
			if pos+16 > len(data) {
				return nil, false
			}
			size = int(binary.BigEndian.Uint64(data[pos+8 : pos+16]))
			body = pos + 16
		case size == 0:
			// 规范允许 size=0 表示“直到文件末尾”，常见于流式写出的最后一个 box。
			size = len(data) - pos
		}
		if size < 8 || pos+size > len(data) {
			return nil, false
		}
		if boxType == "moov" {
			return data[body : pos+size], true
		}
		pos += size
	}
	return nil, false
}

// sampleEntryDimensions 读 stsd 里首个视频 sample entry 的宽高（VisualSampleEntry 固定偏移）。
func sampleEntryDimensions(moov []byte) (int, int) {
	for _, body := range boxBodies(moov, "stsd") {
		// stsd body = version/flags(4) + entry_count(4)，sample entry 从 body+8 开始；
		// entry = 头(8) + reserved(6) + data_reference_index(2) + pre_defined(16) → 宽高在 entry+32/+34。
		entry := body + 8
		if entry+36 > len(moov) {
			continue
		}
		if !isVideoSampleEntry(string(moov[entry+4 : entry+8])) {
			continue
		}
		width := int(binary.BigEndian.Uint16(moov[entry+32 : entry+34]))
		height := int(binary.BigEndian.Uint16(moov[entry+34 : entry+36]))
		if width > 0 && height > 0 {
			return width, height
		}
	}
	return 0, 0
}

func isVideoSampleEntry(fourcc string) bool {
	switch fourcc {
	case "avc1", "avc3", "hvc1", "hev1", "av01", "vp09", "mp4v":
		return true
	default:
		return false
	}
}

// trackHeaderDimensions 兜底读 tkhd 的显示宽高（16.16 定点），用于 sample entry 缺尺寸的碎片化 mp4。
func trackHeaderDimensions(moov []byte) (int, int) {
	for _, body := range boxBodies(moov, "tkhd") {
		if body >= len(moov) {
			continue
		}
		offset := body + 76 // version 0：宽高在 body+76/+80
		if moov[body] == 1 {
			offset = body + 88 // version 1：时间字段各宽 4 字节，整体后移 12
		}
		if offset+8 > len(moov) {
			continue
		}
		width := int(binary.BigEndian.Uint32(moov[offset:offset+4]) >> 16)
		height := int(binary.BigEndian.Uint32(moov[offset+4:offset+8]) >> 16)
		if width > 0 && height > 0 {
			return width, height
		}
	}
	return 0, 0
}

// movieDurationMs 读 mvhd 的时长；缺失或时间基非法时返回 0——时长是可选信息，不阻塞入库。
func movieDurationMs(moov []byte) int64 {
	for _, body := range boxBodies(moov, "mvhd") {
		if body+4 > len(moov) {
			continue
		}
		if moov[body] == 1 {
			if body+32 > len(moov) {
				continue
			}
			timescale := int64(binary.BigEndian.Uint32(moov[body+20 : body+24]))
			if timescale <= 0 {
				return 0
			}
			return int64(binary.BigEndian.Uint64(moov[body+24:body+32])) * 1000 / timescale
		}
		if body+20 > len(moov) {
			continue
		}
		timescale := int64(binary.BigEndian.Uint32(moov[body+12 : body+16]))
		if timescale <= 0 {
			return 0
		}
		return int64(binary.BigEndian.Uint32(moov[body+16:body+20])) * 1000 / timescale
	}
	return 0
}
