import { Camera, Flame, Gem, ImagePlus, Layers, LayoutGrid, Package, Sparkles, UserRound, Wand2, type LucideIcon } from "lucide-react";

/** 设计中心的工具入口 id。新增工具时在这里补一条，并在 pages/design 登记内容组件。 */
export type DesignToolId = "ai-model" | "ai-model-image" | "product-image" | "ecommerce-set" | "ai-retouch" | "batch-matrix" | "viral-replica" | "ai-design";

/**
 * available：工具已可完整使用。
 * soon：入口先占位，点开只展示“即将上线”说明，不承载生成流程。
 */
export type DesignToolStatus = "available" | "soon";

export type DesignTool = {
    id: DesignToolId;
    label: string;
    icon: LucideIcon;
    /** 二级导航的悬停说明，同时作为工具的一句话定位。 */
    description: string;
    status: DesignToolStatus;
};

export type DesignToolGroup = {
    id: string;
    label: string;
    icon: LucideIcon;
    tools: DesignTool[];
};

/**
 * 设计中心的工具目录。左侧二级导航按此分组渲染，分组内顺序即展示顺序。
 * 只有 status 为 available 的工具才允许接入真实页面；soon 由导航统一标注“即将上线”。
 */
export const DESIGN_TOOL_GROUPS: readonly DesignToolGroup[] = [
    {
        id: "ai-commerce",
        label: "AI 电商",
        icon: Camera,
        tools: [
            { id: "ai-model", label: "AI 模特", icon: UserRound, description: "生成可复用数字模特 · 一致出图", status: "available" },
            { id: "ai-model-image", label: "AI 模特图", icon: ImagePlus, description: "用数字模特批量生成场景大片", status: "soon" },
            { id: "product-image", label: "商品图", icon: Package, description: "商品换背景与场景合成", status: "soon" },
            { id: "ecommerce-set", label: "电商套图", icon: Layers, description: "一套主图与详情图批量产出", status: "soon" },
        ],
    },
    {
        id: "ai-image-design",
        label: "AI 图片设计",
        icon: Wand2,
        tools: [
            { id: "ai-retouch", label: "AI 精修", icon: Sparkles, description: "人像与商品的高清精修", status: "soon" },
            { id: "batch-matrix", label: "批量矩阵", icon: LayoutGrid, description: "多变体矩阵批量出图", status: "soon" },
            { id: "viral-replica", label: "爆款复刻", icon: Flame, description: "复刻爆款构图与风格", status: "soon" },
            { id: "ai-design", label: "AI 设计", icon: Gem, description: "从需求直接生成设计方案", status: "soon" },
        ],
    },
];

/** 工具目录的扁平列表，供页面按 id 反查。 */
export const DESIGN_TOOLS: readonly DesignTool[] = DESIGN_TOOL_GROUPS.flatMap((group) => group.tools);
