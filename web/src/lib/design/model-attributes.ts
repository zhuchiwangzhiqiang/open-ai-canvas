// AI 模特的属性协议：分组定义、预设与取值白名单。
// prompt 组装和页面渲染都只读这里的数据，避免属性字面量散落在多个文件。

export type AttributeGroupId = "gender" | "nationality" | "style" | "age" | "bodyType" | "skinTone" | "pose";

export type ModelAttributes = Partial<Record<AttributeGroupId, string>>;

export type ModelAttributeGroup = {
    id: AttributeGroupId;
    label: string;
    values: readonly string[];
};

export type ModelPreset = {
    id: string;
    title: string;
    /** 卡片副文案：说明适用场景，不进入 prompt。 */
    summary: string;
    /** 点击预设时回填到描述输入框的提示词种子。 */
    description: string;
    attributes: ModelAttributes;
};

export const POSE_VALUES = ["站姿正面", "侧身", "走动", "坐姿", "回眸"] as const;

/** 数组顺序即表单中的展示顺序。 */
export const ATTRIBUTE_GROUPS: readonly ModelAttributeGroup[] = [
    { id: "gender", label: "性别", values: ["女模特", "男模特", "童模"] },
    { id: "nationality", label: "国籍", values: ["亚洲", "欧美", "拉丁", "非洲", "中东", "东南亚"] },
    { id: "style", label: "风格", values: ["简约摄影棚", "街头实拍", "居家场景", "时尚大片", "运动活力"] },
    { id: "age", label: "年龄", values: ["青年", "少年", "成熟", "中年"] },
    {
        id: "bodyType",
        label: "体型",
        values: ["标准", "高挑", "娇小", "纤瘦", "微胖", "丰满", "大码", "特大码", "苹果型", "梨型", "沙漏型", "直筒型", "健硕", "运动型"],
    },
    { id: "skinTone", label: "肤色", values: ["白皙", "自然", "小麦", "深肤"] },
    { id: "pose", label: "姿势", values: POSE_VALUES },
];

// 身份属性决定"是不是同一个人"，必须在锚定与派生 prompt 中逐字一致；
// 风格与姿势属于可变属性，派生阶段允许改写。
export const IDENTITY_ATTRIBUTE_GROUP_IDS = ["gender", "nationality", "age", "bodyType", "skinTone"] as const;

export const STYLE_ATTRIBUTE_GROUP_ID: AttributeGroupId = "style";
export const POSE_ATTRIBUTE_GROUP_ID: AttributeGroupId = "pose";

export const MODEL_PRESETS: readonly ModelPreset[] = [
    {
        id: "asian-sweet-girl",
        title: "亚洲甜美少女",
        summary: "清透妆容、亲和微笑，适合女装日常主图",
        description: "清透妆容，亲和微笑，气质干净",
        attributes: { gender: "女模特", nationality: "亚洲", age: "青年", bodyType: "标准", skinTone: "白皙", style: "居家场景", pose: "站姿正面" },
    },
    {
        id: "western-tall-model",
        title: "欧美高挑女模",
        summary: "大长腿、时尚大片感，适合服饰 Lookbook",
        description: "大长腿，时尚大片感，气场利落",
        attributes: { gender: "女模特", nationality: "欧美", age: "青年", bodyType: "高挑", skinTone: "自然", style: "时尚大片", pose: "站姿正面" },
    },
    {
        id: "plus-size-shopper",
        title: "大码真实买家",
        summary: "真实体态、生活场景，适合大码品类种草",
        description: "真实体态，生活化，亲和自然",
        attributes: { gender: "女模特", nationality: "亚洲", age: "成熟", bodyType: "大码", skinTone: "自然", style: "居家场景", pose: "侧身" },
    },
    {
        id: "urban-male-model",
        title: "都市型男",
        summary: "利落干净、街头实拍，适合男装主图",
        description: "利落干净，都市感，神情自然",
        attributes: { gender: "男模特", nationality: "亚洲", age: "青年", bodyType: "标准", skinTone: "自然", style: "街头实拍", pose: "站姿正面" },
    },
];

const allowedValuesByGroup = new Map<AttributeGroupId, Set<string>>(ATTRIBUTE_GROUPS.map((group) => [group.id, new Set(group.values)]));

/**
 * 只保留白名单内的分组与取值：属性可能来自本地持久化状态或外部输入，
 * 未校验的文本会被直接拼进发给模型的上游 prompt。
 */
export function normalizeModelAttributes(value: ModelAttributes | undefined): ModelAttributes {
    const normalized: ModelAttributes = {};
    if (!value) return normalized;
    for (const group of ATTRIBUTE_GROUPS) {
        const candidate = value[group.id];
        if (typeof candidate !== "string") continue;
        const trimmed = candidate.trim();
        if (trimmed && allowedValuesByGroup.get(group.id)?.has(trimmed)) normalized[group.id] = trimmed;
    }
    return normalized;
}

export function isEmptyModelAttributes(attributes: ModelAttributes | undefined): boolean {
    return Object.keys(normalizeModelAttributes(attributes)).length === 0;
}
