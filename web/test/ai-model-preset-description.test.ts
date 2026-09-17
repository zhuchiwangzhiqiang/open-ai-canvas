import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

// Bun 直接执行 TypeScript 测试时需要保留扩展名；生产 tsconfig 不包含 test/。
import { isEmptyModelAttributes, MODEL_PRESETS, normalizeModelAttributes } from "../src/lib/design/model-attributes.ts";

// 页面是 React 组件，仓库没有 jsdom，点选原型的契约用源码断言守住（与其它页面测试同一做法）。
const pageSource = readFileSync(resolve(import.meta.dir, "../src/pages/ai-model/index.tsx"), "utf8");
const cardSource = readFileSync(resolve(import.meta.dir, "../src/pages/ai-model/model-preset-cards.tsx"), "utf8");

test("点选原型后描述回填原型简介，而不是另一段独立文案", () => {
    assert.ok(pageSource.includes("setDescription(preset.summary)"), "页面应把原型简介写进描述框");
    assert.ok(!pageSource.includes("preset.description"), "原型不再有独立描述字段，页面不应再读它");
    // 卡片副文案和描述种子必须是同一段文字：两者不一致时用户会看到"描述和卡片说的不是一回事"。
    assert.ok(cardSource.includes("{preset.summary}"), "卡片副文案应展示原型简介");
});

test("原型简介非空且不重复，卡片文案可直接当提示词用", () => {
    const summaries = MODEL_PRESETS.map((preset) => preset.summary);
    assert.equal(summaries.length, new Set(summaries).size, "原型简介不能重复");
    for (const preset of MODEL_PRESETS) {
        assert.ok(preset.title.trim().length > 0, "原型缺少标题");
        assert.ok(preset.summary.trim().length > 0, `${preset.title} 缺少简介`);
        // 简介会整段进入 prompt，空白或换行都会污染那一行。
        assert.equal(preset.summary, preset.summary.replace(/\s+/g, " ").trim(), `${preset.title} 的简介含多余空白`);
    }
});

// 预设属性来自白名单之外的取值时会被 normalizeModelAttributes 静默丢掉，用户只看到"设定没生效"。
test("原型属性全部在白名单内且非空", () => {
    for (const preset of MODEL_PRESETS) {
        assert.equal(isEmptyModelAttributes(preset.attributes), false, `${preset.title} 没有有效属性`);
        assert.deepEqual(normalizeModelAttributes(preset.attributes), preset.attributes, `${preset.title} 的属性被白名单丢弃`);
    }
});
