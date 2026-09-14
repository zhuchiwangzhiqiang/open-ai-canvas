import {
    IDENTITY_ATTRIBUTE_GROUP_IDS,
    POSE_ATTRIBUTE_GROUP_ID,
    STYLE_ATTRIBUTE_GROUP_ID,
    normalizeModelAttributes,
    type ModelAttributes,
} from "@/lib/design/model-attributes";

export type ModelVariant = {
    pose?: string;
    style?: string;
};

const OUTPUT_REQUIREMENT = "全身写实商业人像摄影，面部清晰，简洁纯净背景，自然光，无文字水印";
const CONSISTENCY_REQUIREMENT = "一致性要求：保持与参考图中人物完全相同的面部特征、发型、肤色与体型。";

function cleanText(value: string | undefined): string {
    return (value ?? "").replace(/\s+/g, " ").trim();
}

function joinValues(values: Array<string | undefined>): string {
    return values.filter((value): value is string => Boolean(value)).join("、");
}

// 锚定与派生共用同一取值顺序，身份短语才能逐字一致。
function identityValues(attributes: ModelAttributes): Array<string | undefined> {
    return IDENTITY_ATTRIBUTE_GROUP_IDS.map((id) => attributes[id]);
}

/** 锚定 prompt：根据属性与描述生成第一张母版图。 */
export function buildModelAnchorPrompt(attributes: ModelAttributes | undefined, description?: string): string {
    const normalized = normalizeModelAttributes(attributes);
    const setting = joinValues([...identityValues(normalized), normalized[STYLE_ATTRIBUTE_GROUP_ID], normalized[POSE_ATTRIBUTE_GROUP_ID]]);
    return [cleanText(description), setting ? `模特设定：${setting}。` : "", `输出要求：${OUTPUT_REQUIREMENT}。`]
        .filter(Boolean)
        .join("\n");
}

/** 派生 prompt：身份属性不变，只改写风格与姿势，并显式要求沿用参考图中的人物。 */
export function buildModelVariantPrompt(attributes: ModelAttributes | undefined, variant: ModelVariant = {}, description?: string): string {
    const normalized = normalizeModelAttributes(attributes);
    const style = variant.style ?? normalized[STYLE_ATTRIBUTE_GROUP_ID];
    const pose = variant.pose ?? normalized[POSE_ATTRIBUTE_GROUP_ID];
    const setting = joinValues([...identityValues(normalized), style, pose]);
    return [cleanText(description), setting ? `模特设定：${setting}。` : "", CONSISTENCY_REQUIREMENT, `输出要求：${OUTPUT_REQUIREMENT}。`]
        .filter(Boolean)
        .join("\n");
}
