package platform

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"infinite-canvas/backend/internal/kernel"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"
)

const maxAPICallPayloadBytes = 128 << 10
const maxAPICallPayloadSourceBytes = 1 << 20

// errPayloadNotJSON 表示流式解析失败或报文不是单个 JSON 文档，调用方应退回通用路径。
var errPayloadNotJSON = errors.New("api call payload is not a single JSON document")

// SanitizeAPICallPayload 保留排障所需报文，同时阻止密钥和大段内嵌媒体进入日志库。
// JSON 先净化再截断：内嵌 data URL 会被换成短占位，因此原文大小不再决定"是否可记录"。
func SanitizeAPICallPayload(data []byte, contentType string) string {
	if len(data) == 0 {
		return ""
	}
	mediaType, params, _ := mime.ParseMediaType(contentType)
	if mediaType == "" {
		mediaType, _, _ = mime.ParseMediaType(http.DetectContentType(data))
	}
	if mediaType == "multipart/form-data" && params["boundary"] != "" {
		return sanitizeMultipartPayload(bytes.NewReader(data), params["boundary"])
	}
	if isJSONMediaType(mediaType) || json.Valid(data) {
		var payload any
		if json.Unmarshal(data, &payload) == nil {
			formatted, err := json.MarshalIndent(sanitizeAPICallJSON(payload, ""), "", "  ")
			if err == nil {
				return truncateAPICallPayload(string(formatted))
			}
		}
	}
	if len(data) > maxAPICallPayloadSourceBytes {
		return fmt.Sprintf("[报文过大，已省略，共 %d 字节]", len(data))
	}
	if isBinaryMediaType(mediaType) {
		return fmt.Sprintf("[%s 二进制报文，共 %d 字节]", kernel.DefaultString(mediaType, "未知类型"), len(data))
	}
	return truncateAPICallPayload(string(data))
}

// RequestPayloadForLog 记录发给上游的请求报文。JSON 走流式净化：内嵌参考图常达数 MB，
// 先把它们换成占位再落库，既不丢 prompt 与参数，也不会把整份报文读进内存。
func RequestPayloadForLog(req *http.Request) string {
	if req == nil || req.GetBody == nil {
		return ""
	}
	contentType := req.Header.Get("Content-Type")
	mediaType, params, _ := mime.ParseMediaType(contentType)
	if mediaType == "multipart/form-data" && params["boundary"] != "" {
		body, err := req.GetBody()
		if err != nil {
			return ""
		}
		defer body.Close()
		return sanitizeMultipartPayload(body, params["boundary"])
	}
	if isJSONMediaType(mediaType) || mediaType == "" {
		body, err := req.GetBody()
		if err == nil {
			sanitized, streamErr := sanitizeJSONPayloadStream(body)
			body.Close()
			if streamErr == nil {
				return sanitized
			}
		}
		// 不是单个合法 JSON 文档：GetBody 每次返回新的 reader，退回通用路径重读。
	}
	body, err := req.GetBody()
	if err != nil {
		return ""
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, maxAPICallPayloadSourceBytes+1))
	if err != nil {
		return ""
	}
	if len(data) > maxAPICallPayloadSourceBytes {
		return fmt.Sprintf("[请求报文过大，已省略，超过 %d 字节]", maxAPICallPayloadSourceBytes)
	}
	return SanitizeAPICallPayload(data, contentType)
}

// sanitizeJSONPayloadStream 逐 token 净化 JSON：任何时刻只在内存里保留一个字符串 token，
// 因此报文大小不再受 maxAPICallPayloadSourceBytes 限制，输出仍由 maxAPICallPayloadBytes 兜底。
func sanitizeJSONPayloadStream(source io.Reader) (string, error) {
	decoder := json.NewDecoder(source)
	decoder.UseNumber()
	writer := newPayloadWriter(maxAPICallPayloadBytes)
	if err := writeSanitizedJSONValue(decoder, writer, "", 0); err != nil {
		return "", errPayloadNotJSON
	}
	if _, err := decoder.Token(); err != io.EOF {
		// 顶层值之后还有内容，说明不是单个 JSON 文档。
		return "", errPayloadNotJSON
	}
	return writer.String(), nil
}

// writeSanitizedJSONValue 写出一层 JSON 值。key 是当前字段名，数组元素继承所在字段名，
// 这样 extra_body.image 这类数组里的 data URL 也能按字段语义被替换。
func writeSanitizedJSONValue(decoder *json.Decoder, writer *payloadWriter, key string, depth int) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	indent := strings.Repeat("  ", depth)
	childIndent := strings.Repeat("  ", depth+1)
	switch typed := token.(type) {
	case json.Delim:
		switch typed {
		case '{':
			writer.WriteString("{")
			first := true
			for decoder.More() {
				keyToken, err := decoder.Token()
				if err != nil {
					return err
				}
				childKey, ok := keyToken.(string)
				if !ok {
					return errPayloadNotJSON
				}
				if !first {
					writer.WriteString(",")
				}
				first = false
				writer.WriteString("\n" + childIndent + strconv.Quote(childKey) + ": ")
				if err := writeSanitizedJSONValue(decoder, writer, childKey, depth+1); err != nil {
					return err
				}
			}
			if _, err := decoder.Token(); err != nil {
				return err
			}
			if !first {
				writer.WriteString("\n" + indent)
			}
			writer.WriteString("}")
		case '[':
			writer.WriteString("[")
			first := true
			for decoder.More() {
				if !first {
					writer.WriteString(",")
				}
				first = false
				writer.WriteString("\n" + childIndent)
				if err := writeSanitizedJSONValue(decoder, writer, key, depth+1); err != nil {
					return err
				}
			}
			if _, err := decoder.Token(); err != nil {
				return err
			}
			if !first {
				writer.WriteString("\n" + indent)
			}
			writer.WriteString("]")
		default:
			return errPayloadNotJSON
		}
	case string:
		writer.WriteString(strconv.Quote(sanitizeAPICallString(typed, key)))
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return err
		}
		writer.Write(encoded)
	}
	return nil
}

// payloadWriter 只保留日志允许的前缀，超出的部分仅累计长度，避免为截断再复制一份完整报文。
type payloadWriter struct {
	buffer  bytes.Buffer
	limit   int
	dropped int
}

func newPayloadWriter(limit int) *payloadWriter {
	return &payloadWriter{limit: limit}
}

func (w *payloadWriter) WriteString(value string) {
	remaining := w.limit - w.buffer.Len()
	if remaining <= 0 {
		w.dropped += len(value)
		return
	}
	if len(value) <= remaining {
		w.buffer.WriteString(value)
		return
	}
	// 按 rune 边界截断：PostgreSQL 文本列不接受截到半个字符的 UTF-8。
	w.buffer.WriteString(cutAtRuneBoundary(value, remaining))
	w.dropped += len(value) - remaining
}

func (w *payloadWriter) Write(value []byte) {
	w.WriteString(string(value))
}

func (w *payloadWriter) String() string {
	if w.dropped == 0 {
		return w.buffer.String()
	}
	return w.buffer.String() + fmt.Sprintf("\n[报文已截断，原始长度 %d 字节]", w.buffer.Len()+w.dropped)
}

func cutAtRuneBoundary(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	cut := limit
	for cut > 0 && !utf8.RuneStart(value[cut]) {
		cut--
	}
	return value[:cut]
}

func isJSONMediaType(mediaType string) bool {
	return mediaType == "application/json" || strings.HasSuffix(mediaType, "+json")
}

func isBinaryMediaType(mediaType string) bool {
	return strings.HasPrefix(mediaType, "image/") || strings.HasPrefix(mediaType, "video/") ||
		strings.HasPrefix(mediaType, "audio/") || mediaType == "application/octet-stream"
}

func sanitizeMultipartPayload(source io.Reader, boundary string) string {
	reader := multipart.NewReader(source, boundary)
	fields := make(map[string]any)
	for partIndex := 0; partIndex < 100; partIndex++ {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "[multipart 请求报文无法解析]"
		}
		name := part.FormName()
		if part.FileName() != "" {
			size, _ := io.Copy(io.Discard, part)
			fields[name] = map[string]any{"fileName": part.FileName(), "contentType": part.Header.Get("Content-Type"), "size": size}
		} else {
			content, _ := io.ReadAll(io.LimitReader(part, maxAPICallPayloadBytes+1))
			fields[name] = sanitizeAPICallJSON(string(content), name)
		}
		part.Close()
	}
	formatted, _ := json.MarshalIndent(fields, "", "  ")
	return truncateAPICallPayload(string(formatted))
}

func sanitizeAPICallJSON(value any, key string) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for childKey, childValue := range typed {
			result[childKey] = sanitizeAPICallJSON(childValue, childKey)
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, childValue := range typed {
			result[index] = sanitizeAPICallJSON(childValue, key)
		}
		return result
	case string:
		return sanitizeAPICallString(typed, key)
	default:
		return value
	}
}

// sanitizeAPICallString 是两条日志路径共用的字段级规则：密钥字段、内嵌媒体、带签名的 URL。
func sanitizeAPICallString(value string, key string) string {
	normalizedKey := normalizeAPICallKey(key)
	for _, secretKey := range []string{"apikey", "accesstoken", "authorization", "password", "secret"} {
		if strings.Contains(normalizedKey, secretKey) {
			return "[REDACTED]"
		}
	}
	if strings.HasPrefix(value, "data:") {
		return embeddedMediaPlaceholder(value)
	}
	if strings.Contains(normalizedKey, "base64") || strings.Contains(normalizedKey, "b64") {
		return fmt.Sprintf("[内嵌编码数据，共 %d 字符]", len(value))
	}
	if sanitizedURL, ok := sanitizeAPICallURL(value); ok {
		return sanitizedURL
	}
	return value
}

func normalizeAPICallKey(key string) string {
	return strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "_", ""), "-", ""))
}

// embeddedMediaPlaceholder 描述一段内嵌媒体，并附上内容指纹，让日志能对应回具体文件：
// base64 data URL 取**解码后**字节的 sha256（与落盘文件逐字节一致），非 base64 的 data URL 取原文；
// 载荷不是合法 base64 时退回原文，保证占位里总有可比对的指纹。
func embeddedMediaPlaceholder(value string) string {
	mediaType, payload, isBase64 := splitDataURL(value)
	return fmt.Sprintf("[内嵌媒体 %s，共 %d 字符, sha256=%s]",
		kernel.DefaultString(mediaType, "未知类型"), len(value), dataURIFingerprint(payload, isBase64))
}

// splitDataURL 拆分 data:[<mediatype>][;base64],<data>；没有逗号时整段按载荷处理。
func splitDataURL(value string) (mediaType string, payload string, isBase64 bool) {
	header, body, found := strings.Cut(strings.TrimPrefix(value, "data:"), ",")
	if !found {
		return "", value, false
	}
	if isBase64 = strings.HasSuffix(header, ";base64"); isBase64 {
		header = strings.TrimSuffix(header, ";base64")
	}
	return strings.TrimSpace(header), body, isBase64
}

// dataURIFingerprint 流式计算指纹：逐块读取解码结果，不把整份媒体放进内存。
func dataURIFingerprint(payload string, isBase64 bool) string {
	hasher := sha256.New()
	if isBase64 {
		if _, err := io.Copy(hasher, base64.NewDecoder(base64.StdEncoding, strings.NewReader(payload))); err != nil {
			hasher.Reset()
			_, _ = io.Copy(hasher, strings.NewReader(payload))
		}
	} else {
		_, _ = io.Copy(hasher, strings.NewReader(payload))
	}
	return fmt.Sprintf("%x", hasher.Sum(nil))
}

func sanitizeAPICallURL(value string) (string, bool) {
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", false
	}
	query := parsed.Query()
	for key := range query {
		normalized := normalizeAPICallKey(key)
		if strings.Contains(normalized, "token") || strings.Contains(normalized, "signature") || strings.Contains(normalized, "apikey") || normalized == "key" {
			query.Set(key, "[REDACTED]")
		}
	}
	parsed.RawQuery = query.Encode()
	return parsed.String(), true
}

func truncateAPICallPayload(value string) string {
	if len(value) <= maxAPICallPayloadBytes {
		return value
	}
	return cutAtRuneBoundary(value, maxAPICallPayloadBytes) + fmt.Sprintf("\n[报文已截断，原始长度 %d 字节]", len(value))
}
