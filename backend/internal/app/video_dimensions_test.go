package app

import (
	"encoding/base64"
	"encoding/binary"
	"strings"
	"testing"
)

// mp4Box 拼一个 box：4 字节大小 + 4 字节类型 + body。
func mp4Box(boxType string, body []byte) []byte {
	out := make([]byte, 8+len(body))
	binary.BigEndian.PutUint32(out[0:4], uint32(8+len(body)))
	copy(out[4:8], boxType)
	copy(out[8:], body)
	return out
}

// sampleEntry 拼一个 VisualSampleEntry：宽高在 entry+32/+34（大端 uint16）。
func sampleEntry(fourcc string, width, height uint16) []byte {
	body := make([]byte, 70)
	binary.BigEndian.PutUint16(body[24:26], width) // entry 头之后第 32 字节
	binary.BigEndian.PutUint16(body[26:28], height)
	entry := mp4Box(fourcc, body)
	return entry
}

// stsdBox 拼 stsd：version/flags(4) + entry_count(4) + entry…
func stsdBox(entry []byte) []byte {
	body := make([]byte, 8)
	binary.BigEndian.PutUint32(body[4:8], 1)
	return mp4Box("stsd", append(body, entry...))
}

// tkhdBox 拼 version 0 的 tkhd，宽高是 16.16 定点，位于 body+76/+80。
func tkhdBox(width, height uint32) []byte {
	body := make([]byte, 84)
	binary.BigEndian.PutUint32(body[76:80], width<<16)
	binary.BigEndian.PutUint32(body[80:84], height<<16)
	return mp4Box("tkhd", body)
}

// mvhdBox 拼 version 0 的 mvhd：body+12 时间基、body+16 时长。
func mvhdBox(timescale, duration uint32) []byte {
	body := make([]byte, 100)
	binary.BigEndian.PutUint32(body[12:16], timescale)
	binary.BigEndian.PutUint32(body[16:20], duration)
	return mp4Box("mvhd", body)
}

// syntheticMP4 拼一个最小 mp4：ftyp + moov(mvhd, trak(tkhd, mdia(minf(stbl(stsd(entry))))))。
func syntheticMP4(entry []byte, tkhd []byte) []byte {
	ftyp := mp4Box("ftyp", []byte("isom\x00\x00\x02\x00isomiso2"))
	stbl := mp4Box("stbl", stsdBox(entry))
	minf := mp4Box("minf", stbl)
	mdia := mp4Box("mdia", minf)
	children := append(append([]byte{}, tkhd...), mdia...)
	trak := mp4Box("trak", children)
	moovBody := append(mvhdBox(1000, 6000), trak...)
	moov := mp4Box("moov", moovBody)
	return append(ftyp, moov...)
}

func TestVideoDimensionsFromBytesReadsSampleEntry(t *testing.T) {
	data := syntheticMP4(sampleEntry("avc1", 1280, 720), tkhdBox(1920, 1080))

	width, height, durationMs, ok := videoDimensionsFromBytes(data)
	if !ok {
		t.Fatal("videoDimensionsFromBytes 未识别合成 mp4")
	}
	// sample entry 是画面真实尺寸，优先于 tkhd 的显示尺寸。
	if width != 1280 || height != 720 {
		t.Fatalf("宽高 = %d×%d，期望 1280×720", width, height)
	}
	if durationMs != 6000 {
		t.Fatalf("时长 = %dms，期望 6000ms", durationMs)
	}
}

func TestVideoDimensionsFromBytesFallsBackToTrackHeader(t *testing.T) {
	// 没有可用 sample entry 时退回 tkhd（碎片化 mp4 的常见形态）。
	data := syntheticMP4(sampleEntry("zzzz", 0, 0), tkhdBox(1920, 1080))

	width, height, _, ok := videoDimensionsFromBytes(data)
	if !ok || width != 1920 || height != 1080 {
		t.Fatalf("tkhd 兜底 = %d×%d ok=%v，期望 1920×1080", width, height, ok)
	}
}

func TestVideoDimensionsFromBytesRejectsNonVideoPayloads(t *testing.T) {
	cases := []struct {
		name string
		data []byte
	}{
		{"空数据", nil},
		{"非 mp4 容器", []byte("webm-not-mp4-payload")},
		{"音频 mp4（mp4a sample entry）", syntheticMP4(sampleEntry("mp4a", 1280, 720), tkhdBox(0, 0))},
		{"截断的 moov", syntheticMP4(sampleEntry("avc1", 1280, 720), tkhdBox(1920, 1080))[:20]},
	}
	for _, testCase := range cases {
		if _, _, _, ok := videoDimensionsFromBytes(testCase.data); ok {
			t.Errorf("%s：不应识别出视频尺寸", testCase.name)
		}
	}
}

// 这条覆盖真实故障：视频结果不带尺寸时，前端素材合同（宽度必须大于 0）会拒绝整条结果。
func TestPersistGeneratedVideoResultFillsDimensionsFromContainer(t *testing.T) {
	svc := newResourceTestService(t)
	video := syntheticMP4(sampleEntry("hvc1", 720, 1280), tkhdBox(720, 1280))
	dataURL := "data:video/mp4;base64," + base64.StdEncoding.EncodeToString(video)

	stored, err := svc.persistGeneratedMediaResult("user-1", map[string]interface{}{
		"mode":  "video",
		"video": map[string]interface{}{"dataUrl": dataURL, "mimeType": "video/mp4", "bytes": len(video)},
	})
	if err != nil {
		t.Fatalf("persistGeneratedMediaResult() error = %v", err)
	}
	videoItem, ok := stored["video"].(map[string]interface{})
	if !ok {
		t.Fatalf("stored video = %#v", stored["video"])
	}
	if got := intValue(videoItem["width"]); got != 720 {
		t.Fatalf("素材宽度 = %d，期望 720（前端会拒绝 0）", got)
	}
	if got := intValue(videoItem["height"]); got != 1280 {
		t.Fatalf("素材高度 = %d，期望 1280", got)
	}
	if got := intValue(videoItem["durationMs"]); got != 6000 {
		t.Fatalf("素材时长 = %dms，期望 6000ms", got)
	}
	// 这三个值直接取自落库后的 resource.Width/Height/DurationMs，等于验证了资源行本身。
	storageKey := stringField(videoItem, "storageKey")
	if !strings.HasPrefix(storageKey, "resource:") || stringField(videoItem, "resourceId") == "" {
		t.Fatalf("storageKey = %q，resourceId = %q", storageKey, stringField(videoItem, "resourceId"))
	}
}
