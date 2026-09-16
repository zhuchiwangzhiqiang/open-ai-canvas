import assert from "node:assert/strict";
import test from "node:test";

// Bun 直接执行 TypeScript 测试时需要保留扩展名；生产 tsconfig 不包含 test/。
import { ATTRIBUTE_GROUPS, DEFAULT_MODEL_ATTRIBUTES, isEmptyModelAttributes, normalizeModelAttributes } from "../src/lib/design/model-attributes.ts";
import { buildModelAnchorPrompt, buildModelVariantPrompt, DERIVE_FRAMINGS, deriveFraming } from "../src/lib/design/model-prompt.ts";

const attributes = {
    gender: "女模特",
    nationality: "亚洲",
    age: "青年",
    bodyType: "高挑",
    skinTone: "白皙",
    style: "简约摄影棚",
    pose: "站姿正面",
};

// 正向单主体描述在最前面；其后是引导语与逐项人物设定，顺序取 ATTRIBUTE_GROUPS。
const ANCHOR_SUBJECT = ["整张画面就是一张完整的人像照片，画面中只有一个人物。"];
const ANCHOR_LEAD = [
    ...ANCHOR_SUBJECT,
    "你是电商数字模特生成助手，任务是生成一张可复用数字模特的单人母版图。",
    "优先保证面部与身材特征稳定、跨张一致，避免夸张变形。",
    "人物设定：",
    "- 性别：女模特",
    "- 国籍：亚洲",
    "- 风格：简约摄影棚",
    "- 年龄：青年",
    "- 体型：高挑",
    "- 肤色：白皙",
    "- 姿势：站姿正面",
];
const ANCHOR_TAIL = ["构图：全身人像，从头顶到脚底完整入画，不要裁掉腿部和脚，镜头拉远，四周留出背景空间。", "面部清晰、五官自然，适合后续换装与商品主图复用；禁止水印与乱码文字。"];
// 派生带参考图，因此在构图行前多一行参考图用途说明。
const REFERENCE_ROLE = "参考图只用于锁定人物身份、面部特征与身材比例；不要沿用参考图的构图、裁切和背景，按下面的构图重新取景。";

test("锚定 prompt 按固定骨架组装：引导语、逐项人物设定、用户描述、构图与输出约束", () => {
    const prompt = buildModelAnchorPrompt(attributes, "清冷气质，短发");

    assert.equal(prompt, [...ANCHOR_LEAD, "用户描述：清冷气质，短发", ...ANCHOR_TAIL].join("\n"));
});

test("锚定 prompt 的人物设定按属性分组顺序排列，不随传入顺序变化", () => {
    // 传入顺序故意打乱，输出仍须按 ATTRIBUTE_GROUPS 的展示顺序。
    const shuffled = { pose: "站姿正面", skinTone: "白皙", bodyType: "高挑", age: "青年", style: "简约摄影棚", nationality: "亚洲", gender: "女模特" };
    const prompt = buildModelAnchorPrompt(shuffled);

    const settingLines = prompt.split("\n").filter((line) => line.startsWith("- "));
    assert.deepEqual(
        settingLines,
        ATTRIBUTE_GROUPS.map((group) => `- ${group.label}：${attributes[group.id as keyof typeof attributes]}`),
    );
});

// 把母版 prompt 改成派生 prompt：构图行换成指定变体，并在其前面插入参考图用途说明。
function withFraming(prompt: string, framing: string): string {
    return prompt
        .split("\n")
        .flatMap((line) => (line.startsWith("构图") ? [REFERENCE_ROLE, framing] : [line]))
        .join("\n");
}

test("派生 prompt 与母版一致，只把构图行换成往里裁的 B、C 并声明参考图用途", () => {
    const anchor = buildModelAnchorPrompt(attributes, "清冷气质，短发");
    const second = buildModelVariantPrompt(attributes, { framing: DERIVE_FRAMINGS[0] }, "清冷气质，短发");
    const third = buildModelVariantPrompt(attributes, { framing: DERIVE_FRAMINGS[1] }, "清冷气质，短发");

    // 派生是图生图，母版没有参考图，这行只能在派生 prompt 里出现一次。
    assert.equal(anchor.includes("参考图"), false);
    assert.equal(second.split(REFERENCE_ROLE).length - 1, 1);
    assert.equal(second, withFraming(anchor, "构图：半身人像，正面偏三四分，面部清晰，人物主体占满画面，景深干净。"));
    assert.equal(third, withFraming(anchor, "构图：略侧三分身，姿态自然，光影更有层次，仍同一人物身份。"));
    // 身份设定与用户描述必须与母版逐字一致，身份才不会被改写。
    for (const line of anchor.split("\n").filter((item) => item.startsWith("- ") || item.startsWith("用户描述："))) {
        assert.ok(second.includes(line), `派生 B 缺少：${line}`);
        assert.ok(third.includes(line), `派生 C 缺少：${line}`);
    }
});

// 母版必须是全身：派生是往里裁，母版裁掉了腿脚就没有任何一张能补回来（实测停在膝盖以上）。
test("母版构图是全身并声明从头到脚的入画边界，派生只做更近的取景", () => {
    const anchor = buildModelAnchorPrompt(attributes);

    assert.ok(anchor.includes("构图：全身人像，从头顶到脚底完整入画，不要裁掉腿部和脚"));
    // 共享的单主体首行不再声明"占满画面"：它和全身构图的留白要求互相打架。
    assert.equal(anchor.split("\n")[0], "整张画面就是一张完整的人像照片，画面中只有一个人物。");
    for (const framing of DERIVE_FRAMINGS) {
        assert.ok(!framing.includes("从头顶到脚底"), `派生不应再要求全身：${framing}`);
    }
});

test("构图变体按序号轮换，超出 B、C 后循环", () => {
    assert.equal(deriveFraming(0), DERIVE_FRAMINGS[0]);
    assert.equal(deriveFraming(1), DERIVE_FRAMINGS[1]);
    assert.equal(deriveFraming(2), DERIVE_FRAMINGS[0]);
    assert.equal(deriveFraming(-1), DERIVE_FRAMINGS[0]);
});

test("不在白名单内的取值不会进入 prompt", () => {
    const prompt = buildModelAnchorPrompt({ gender: "女模特", nationality: "火星", style: "赛博朋克" });

    assert.ok(prompt.includes("- 性别：女模特"));
    assert.ok(!prompt.includes("火星"));
    assert.ok(!prompt.includes("赛博朋克"));
    assert.ok(!prompt.includes("- 国籍："));
    assert.ok(!prompt.includes("- 风格："));
});

test("单主体约束只做正向描述，prompt 里不出现任何多图概念词", () => {
    // 列举"九宫格/拼贴/多视图"这类禁用词本身会暗示模型去画它：上一版把它们写进前两行后仍然出九宫格。
    const prompt = buildModelAnchorPrompt(attributes);

    assert.equal(prompt.split("\n")[0], "整张画面就是一张完整的人像照片，画面中只有一个人物。");
    for (const word of ["九宫格", "多宫格", "分屏", "拼贴", "三联图", "分镜宫格", "多图拼接", "多视图", "联系表", "角色设定表", "变体", "基底图"]) {
        assert.ok(!prompt.includes(word), `prompt 不应出现多图概念词：${word}`);
    }
});

test("没有可用属性时不留下孤立的「人物设定：」标题", () => {
    const prompt = buildModelAnchorPrompt({ nationality: "火星" });

    assert.ok(!prompt.includes("人物设定："));
    assert.equal(prompt, [...ANCHOR_LEAD.slice(0, 3), ...ANCHOR_TAIL].join("\n"));
});

test("空描述不产生多余空行，且仍保留人物设定与输出约束", () => {
    const prompt = buildModelAnchorPrompt(attributes, "   ");

    assert.equal(prompt, [...ANCHOR_LEAD, ...ANCHOR_TAIL].join("\n"));
    assert.ok(!prompt.includes("用户描述"));
});

test("normalizeModelAttributes 丢弃未知分组并去除首尾空白", () => {
    const normalized = normalizeModelAttributes({ gender: "  女模特  ", age: "青年" });

    assert.deepEqual(normalized, { gender: "女模特", age: "青年" });
    assert.equal(isEmptyModelAttributes({ gender: "不存在" }), true);
    assert.equal(isEmptyModelAttributes(undefined), true);
    assert.equal(isEmptyModelAttributes({ pose: "回眸" }), false);
});

// 默认值是写死在表单里的字面量，一旦拼错会被白名单静默丢掉、用户看不到任何报错。
test("表单默认属性全部在白名单内且非空", () => {
    assert.deepEqual(normalizeModelAttributes(DEFAULT_MODEL_ATTRIBUTES), DEFAULT_MODEL_ATTRIBUTES);
    assert.equal(Object.keys(DEFAULT_MODEL_ATTRIBUTES).length, ATTRIBUTE_GROUPS.length);
    assert.equal(isEmptyModelAttributes(DEFAULT_MODEL_ATTRIBUTES), false);
});
