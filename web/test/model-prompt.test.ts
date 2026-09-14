import assert from "node:assert/strict";
import test from "node:test";

// Bun 直接执行 TypeScript 测试时需要保留扩展名；生产 tsconfig 不包含 test/。
import { isEmptyModelAttributes, normalizeModelAttributes } from "../src/lib/design/model-attributes.ts";
import { buildModelAnchorPrompt, buildModelVariantPrompt } from "../src/lib/design/model-prompt.ts";

const attributes = {
    gender: "女模特",
    nationality: "亚洲",
    age: "青年",
    bodyType: "高挑",
    skinTone: "白皙",
    style: "简约摄影棚",
    pose: "站姿正面",
};

const identity = "女模特、亚洲、青年、高挑、白皙";

test("锚定 prompt 按身份、风格、姿势的固定顺序组装并保留描述", () => {
    const prompt = buildModelAnchorPrompt(attributes, "清冷气质，短发");

    assert.equal(
        prompt,
        [
            "清冷气质，短发",
            `模特设定：${identity}、简约摄影棚、站姿正面。`,
            "输出要求：全身写实商业人像摄影，面部清晰，简洁纯净背景，自然光，无文字水印。",
        ].join("\n"),
    );
});

test("派生 prompt 保持身份短语逐字不变，只替换姿势", () => {
    const anchor = buildModelAnchorPrompt(attributes);
    const variant = buildModelVariantPrompt(attributes, { pose: "侧身" });

    assert.ok(anchor.includes(identity));
    assert.ok(variant.includes(identity));
    assert.ok(variant.includes("模特设定：女模特、亚洲、青年、高挑、白皙、简约摄影棚、侧身。"));
    assert.ok(variant.includes("一致性要求：保持与参考图中人物完全相同的面部特征、发型、肤色与体型。"));
    assert.ok(!variant.includes("站姿正面"));
});

test("派生 prompt 未指定姿势时沿用属性中的姿势", () => {
    const variant = buildModelVariantPrompt(attributes);

    assert.ok(variant.includes("女模特、亚洲、青年、高挑、白皙、简约摄影棚、站姿正面"));
});

test("不在白名单内的取值不会进入 prompt", () => {
    const prompt = buildModelAnchorPrompt({ gender: "女模特", nationality: "火星", style: "赛博朋克" });

    assert.ok(prompt.includes("女模特"));
    assert.ok(!prompt.includes("火星"));
    assert.ok(!prompt.includes("赛博朋克"));
});

test("空描述不产生多余空行，且仍保留设定与输出要求", () => {
    const prompt = buildModelAnchorPrompt(attributes, "   ");

    assert.equal(
        prompt,
        [`模特设定：${identity}、简约摄影棚、站姿正面。`, "输出要求：全身写实商业人像摄影，面部清晰，简洁纯净背景，自然光，无文字水印。"].join("\n"),
    );
});

test("normalizeModelAttributes 丢弃未知分组并去除首尾空白", () => {
    const normalized = normalizeModelAttributes({ gender: "  女模特  ", age: "青年" });

    assert.deepEqual(normalized, { gender: "女模特", age: "青年" });
    assert.equal(isEmptyModelAttributes({ gender: "不存在" }), true);
    assert.equal(isEmptyModelAttributes(undefined), true);
    assert.equal(isEmptyModelAttributes({ pose: "回眸" }), false);
});
