package platform

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func jsonRequestForLog(t *testing.T, body string) *http.Request {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, "https://api.example.com/v1/images/generations", bytes.NewReader([]byte(body)))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	return request
}

// 派生请求会把母版参考图以 data URL 内联进 extra_body.image，报文常达数 MB。
// 这类报文必须仍能记录 prompt 与参数，只把内嵌媒体换成占位。
func TestRequestPayloadForLogKeepsPromptAndReplacesInlineMedia(t *testing.T) {
	inlineImage := "data:image/jpeg;base64," + strings.Repeat("A", 1_500_000)
	body, err := json.Marshal(map[string]any{
		"model":  "agnes-image-2.1-flash",
		"prompt": "整张画面就是一张完整的人像照片，画面中只有一个人物，人物主体占满画面。",
		"size":   "2K",
		"ratio":  "3:4",
		"extra_body": map[string]any{
			"image":           []any{inlineImage},
			"response_format": "url",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(body) <= maxAPICallPayloadSourceBytes {
		t.Fatalf("测试报文必须超过 %d 字节，当前 %d", maxAPICallPayloadSourceBytes, len(body))
	}

	logged := RequestPayloadForLog(jsonRequestForLog(t, string(body)))

	if strings.Contains(logged, "AAAA") {
		t.Fatalf("内嵌媒体没有被替换：%s", firstRunes(logged, 200))
	}
	if !strings.Contains(logged, "整张画面就是一张完整的人像照片") {
		t.Fatalf("prompt 丢失：%s", firstRunes(logged, 200))
	}
	if !strings.Contains(logged, "[内嵌媒体 image/jpeg") {
		t.Fatalf("缺少内嵌媒体占位：%s", firstRunes(logged, 200))
	}
	if !strings.Contains(logged, `"ratio": "3:4"`) {
		t.Fatalf("请求参数丢失：%s", firstRunes(logged, 200))
	}
	if strings.Contains(logged, "请求报文过大") {
		t.Fatal("JSON 报文不应因为原文超过读取上限就被整体丢弃")
	}
	if len(logged) > maxAPICallPayloadBytes+200 {
		t.Fatalf("日志长度未被限制：%d", len(logged))
	}
	if !json.Valid([]byte(logged)) {
		t.Fatalf("净化后的报文应当是合法 JSON：%s", firstRunes(logged, 200))
	}
}

func TestRequestPayloadForLogRedactsSecrets(t *testing.T) {
	body := `{"api_key":"sk-real-key","accessToken":"token-value","nested":{"password":"p","keep":"v"}}`

	logged := RequestPayloadForLog(jsonRequestForLog(t, body))

	for _, secret := range []string{"sk-real-key", "token-value"} {
		if strings.Contains(logged, secret) {
			t.Fatalf("密钥泄漏：%s", logged)
		}
	}
	if strings.Count(logged, "[REDACTED]") != 3 {
		t.Fatalf("应屏蔽 3 处密钥：%s", logged)
	}
	if !strings.Contains(logged, `"keep": "v"`) {
		t.Fatalf("普通字段不应被改写：%s", logged)
	}
}

func TestRequestPayloadForLogRedactsSignedQuery(t *testing.T) {
	body := `{"image":["https://cdn.example/a.png?token=abc&signature=def&width=100"]}`

	logged := RequestPayloadForLog(jsonRequestForLog(t, body))

	if strings.Contains(logged, "abc") || strings.Contains(logged, "def") {
		t.Fatalf("签名参数泄漏：%s", logged)
	}
	if !strings.Contains(logged, "width=100") {
		t.Fatalf("普通查询参数应保留：%s", logged)
	}
}

func TestRequestPayloadForLogTruncatesHugePrompt(t *testing.T) {
	body, err := json.Marshal(map[string]any{"prompt": strings.Repeat("长", 200_000)})
	if err != nil {
		t.Fatal(err)
	}

	logged := RequestPayloadForLog(jsonRequestForLog(t, string(body)))

	if len(logged) > maxAPICallPayloadBytes+200 {
		t.Fatalf("日志长度未被限制：%d", len(logged))
	}
	if !strings.Contains(logged, "报文已截断") {
		t.Fatalf("缺少截断标记：%s", firstRunes(logged, 120))
	}
	// 按 rune 边界截断，避免截出半个字符导致 PostgreSQL 文本列写入失败。
	if !utf8Valid(logged) {
		t.Fatal("截断后不是合法 UTF-8")
	}
}

// 非 JSON 报文仍沿用读取上限，避免把大块二进制或文本读进内存。
func TestRequestPayloadForLogKeepsSizeGuardForNonJSON(t *testing.T) {
	request, err := http.NewRequest(http.MethodPost, "https://api.example.com/upload", strings.NewReader(strings.Repeat("x", maxAPICallPayloadSourceBytes+16)))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "text/plain")

	logged := RequestPayloadForLog(request)

	if !strings.Contains(logged, "请求报文过大") {
		t.Fatalf("非 JSON 大报文应退化为占位：%s", firstRunes(logged, 120))
	}
}

func TestRequestPayloadForLogHandlesArrayRoot(t *testing.T) {
	inlineImage := "data:image/png;base64," + strings.Repeat("B", 300_000)
	body, err := json.Marshal([]any{map[string]any{"image": inlineImage}})
	if err != nil {
		t.Fatal(err)
	}

	logged := RequestPayloadForLog(jsonRequestForLog(t, string(body)))

	if strings.Contains(logged, "BBBB") {
		t.Fatalf("数组根节点的内嵌媒体没有被替换：%s", firstRunes(logged, 200))
	}
	if !strings.Contains(logged, "[内嵌媒体 image/png") {
		t.Fatalf("缺少内嵌媒体占位：%s", firstRunes(logged, 200))
	}
}

// []byte 路径（自定义渠道中继）同样先净化再截断，不再因为原文超限丢整份报文。
func TestSanitizeAPICallPayloadKeepsLargeJSON(t *testing.T) {
	inlineImage := "data:image/jpeg;base64," + strings.Repeat("C", 1_500_000)
	body, err := json.Marshal(map[string]any{
		"prompt": "保留这段提示词",
		"image":  inlineImage,
	})
	if err != nil {
		t.Fatal(err)
	}

	logged := SanitizeAPICallPayload(body, "application/json")

	if !strings.Contains(logged, "保留这段提示词") {
		t.Fatalf("大 JSON 的 prompt 丢失：%s", firstRunes(logged, 200))
	}
	if strings.Contains(logged, "CCCC") {
		t.Fatalf("内嵌媒体没有被替换：%s", firstRunes(logged, 200))
	}
	if strings.Contains(logged, "报文过大") {
		t.Fatal("JSON 报文不应因为原文超限被整体丢弃")
	}
}

func TestSanitizeAPICallPayloadKeepsSizeGuardForNonJSON(t *testing.T) {
	logged := SanitizeAPICallPayload([]byte(strings.Repeat("x", maxAPICallPayloadSourceBytes+16)), "text/plain")

	if !strings.Contains(logged, "报文过大") {
		t.Fatalf("非 JSON 大报文应退化为占位：%s", firstRunes(logged, 120))
	}
}

// 指纹取解码后的字节：与磁盘上的图片文件逐字节一致，因此日志里的占位能对应回具体是哪张图。
func TestRequestPayloadForLogFingerprintsInlineMedia(t *testing.T) {
	imageBytes := bytes.Repeat([]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A}, 700)
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(imageBytes)
	body, err := json.Marshal(map[string]any{"extra_body": map[string]any{"image": []any{dataURL}}})
	if err != nil {
		t.Fatal(err)
	}

	logged := RequestPayloadForLog(jsonRequestForLog(t, string(body)))

	if !strings.Contains(logged, fmt.Sprintf("sha256=%x", sha256.Sum256(imageBytes))) {
		t.Fatalf("占位缺少解码字节的指纹：%s", firstRunes(logged, 200))
	}
	if strings.Contains(logged, "0x89") || strings.Contains(logged, base64.StdEncoding.EncodeToString(imageBytes)) {
		t.Fatalf("内嵌媒体本体不应出现在日志里：%s", firstRunes(logged, 200))
	}
}

func TestRequestPayloadForLogFingerprintsEachInlineMediaSeparately(t *testing.T) {
	first := []byte("first-image-bytes")
	second := []byte("second-image-bytes")
	body, err := json.Marshal(map[string]any{"extra_body": map[string]any{"image": []any{
		"data:image/png;base64," + base64.StdEncoding.EncodeToString(first),
		"data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(second),
	}}})
	if err != nil {
		t.Fatal(err)
	}

	logged := RequestPayloadForLog(jsonRequestForLog(t, string(body)))

	for _, payload := range [][]byte{first, second} {
		if !strings.Contains(logged, fmt.Sprintf("sha256=%x", sha256.Sum256(payload))) {
			t.Fatalf("缺少其中一张内嵌图的指纹：%s", firstRunes(logged, 300))
		}
	}
}

// 非 base64 的 data URL（如 svg）没有"解码后字节"，指纹取原文，占位里始终有可比对值。
func TestSanitizeAPICallPayloadFingerprintsNonBase64DataURL(t *testing.T) {
	payload := "<svg/>"
	body, err := json.Marshal(map[string]any{"image": "data:image/svg+xml," + payload})
	if err != nil {
		t.Fatal(err)
	}

	logged := SanitizeAPICallPayload(body, "application/json")

	if !strings.Contains(logged, fmt.Sprintf("sha256=%x", sha256.Sum256([]byte(payload)))) {
		t.Fatalf("非 base64 载荷的指纹不对：%s", firstRunes(logged, 200))
	}
}

// 载荷不是合法 base64 时退回原文指纹：解析失败不能让日志丢掉可比对信息。
func TestSanitizeAPICallPayloadFingerprintsMalformedBase64(t *testing.T) {
	payload := "not-valid-base64!!"
	body, err := json.Marshal(map[string]any{"image": "data:image/png;base64," + payload})
	if err != nil {
		t.Fatal(err)
	}

	logged := SanitizeAPICallPayload(body, "application/json")

	if !strings.Contains(logged, fmt.Sprintf("sha256=%x", sha256.Sum256([]byte(payload)))) {
		t.Fatalf("解析失败时应退回原文指纹：%s", firstRunes(logged, 200))
	}
}

func firstRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func utf8Valid(value string) bool {
	for _, r := range value {
		if r == '\uFFFD' {
			return false
		}
	}
	return true
}
