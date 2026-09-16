import { ATTRIBUTE_GROUPS, normalizeModelAttributes, type ModelAttributes } from "@/lib/design/model-attributes";

/** 派生构图变体：与母版共用同一段骨架，只替换「构图」这一行并额外声明参考图用途。 */
export type ModelVariant = {
    framing: string;
};

// 母版 prompt 的固定骨架：单主体描述 → 引导语 → 人物设定逐项列出 → 用户描述 → 构图行 → 复用约束；
// 派生在此之上多一行"参考图只锁身份"，位置紧邻构图行。
// 属性逐项列出而不是拼成一句话，模型才会把每一项当成独立约束读取。
// 单主体约束只做正向描述：图像 prompt 里列举"九宫格/拼贴/多视图"这类禁用词本身会暗示模型去画它，
// 上一版把禁用词写进前两行后仍然出九宫格，因此改为只描述"这张图是什么"，不再提任何多图概念。
const PORTRAIT_SINGLE_SUBJECT = ["整张画面就是一张完整的人像照片，画面中只有一个人物。"];
// "人设基底图"会被理解成角色设定表（多视图九宫格），改为明确的单张母版图。
const PORTRAIT_LEAD = [
    "你是电商数字模特生成助手，任务是生成一张可复用数字模特的单人母版图。",
    "优先保证面部与身材特征稳定、跨张一致，避免夸张变形。",
];
const PORTRAIT_SETTING_HEADING = "人物设定：";
// 派生走图生图：prompt 里不交代参考图的用途时，模型会把参考图的构图和裁切一并沿用。
// 实测母版是半身裁切时，写着"全身人像"的派生图仍然停在膝盖以上，因此单独声明参考图只锁身份。
const PORTRAIT_REFERENCE_ROLE = "参考图只用于锁定人物身份、面部特征与身材比例；不要沿用参考图的构图、裁切和背景，按下面的构图重新取景。";
// "构图变体 A" 的"变体"+字母编号会被理解为"后面还有 A–I 个变体"，直接去掉编号只留构图描述。
// 母版先出全身：图生图往里裁（全身→半身）远比往外补（半身→全身）可靠，
// 上一版母版半身、派生要求"全身人像"，实测两张派生都停在膝盖以上、看不到脚。
const ANCHOR_FRAMING = "构图：全身人像，从头顶到脚底完整入画，不要裁掉腿部和脚，镜头拉远，四周留出背景空间。";
/** 派生都从母版往里裁：先半身、再略侧三分身；张数更多时循环。 */
export const DERIVE_FRAMINGS = [
    "构图：半身人像，正面偏三四分，面部清晰，人物主体占满画面，景深干净。",
    "构图：略侧三分身，姿态自然，光影更有层次，仍同一人物身份。",
] as const;
const PORTRAIT_REUSE_REQUIREMENT = "面部清晰、五官自然，适合后续换装与商品主图复用；禁止水印与乱码文字。";

function cleanText(value: string | undefined): string {
    return (value ?? "").replace(/\s+/g, " ").trim();
}

/** 人物设定的逐项列表：按属性分组顺序输出已设置的项，未设置的分组不占行。 */
function attributeSettingLines(attributes: ModelAttributes): string[] {
    return ATTRIBUTE_GROUPS.flatMap((group) => {
        const value = attributes[group.id];
        return value ? [`- ${group.label}：${value}`] : [];
    });
}

/** 母版与派生共用的骨架；差异只有"是否附带参考图"和传入的构图行。 */
function buildPortraitPrompt(attributes: ModelAttributes | undefined, description: string | undefined, framing: string, withReference: boolean): string {
    const normalized = normalizeModelAttributes(attributes);
    const lines = [...PORTRAIT_SINGLE_SUBJECT, ...PORTRAIT_LEAD];
    const settings = attributeSettingLines(normalized);
    if (settings.length) lines.push(PORTRAIT_SETTING_HEADING, ...settings);
    const text = cleanText(description);
    if (text) lines.push(`用户描述：${text}`);
    if (withReference) lines.push(PORTRAIT_REFERENCE_ROLE);
    lines.push(framing, PORTRAIT_REUSE_REQUIREMENT);
    return lines.join("\n");
}

/** 第 index 张派生图（从 0 开始）使用的构图变体。 */
export function deriveFraming(index: number): string {
    const normalized = Math.max(0, Math.floor(index));
    return DERIVE_FRAMINGS[normalized % DERIVE_FRAMINGS.length];
}

/** 锚定 prompt：根据属性与描述生成第一张母版图；此时不带参考图。 */
export function buildModelAnchorPrompt(attributes: ModelAttributes | undefined, description?: string): string {
    return buildPortraitPrompt(attributes, description, ANCHOR_FRAMING, false);
}

/** 派生 prompt：以母版为参考图，因此额外声明参考图只用于锁定身份。 */
export function buildModelVariantPrompt(attributes: ModelAttributes | undefined, variant: ModelVariant, description?: string): string {
    return buildPortraitPrompt(attributes, description, variant.framing, true);
}
