import { useState } from "react";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { DESIGN_TOOLS, type DesignTool, type DesignToolId } from "@/constant/design-tools";
import { AiModelWorkbench } from "@/pages/ai-model";
import { DesignToolNav } from "@/pages/design/design-tool-nav";

/** 尚未接入流程的工具只展示定位说明，避免点开是空白页。 */
function DesignToolComingSoon({ tool }: { tool: DesignTool }) {
    const Icon = tool.icon;
    return (
        <div className="grid min-h-[280px] place-items-center rounded-[var(--r-md)] border border-dashed border-border px-6 py-10">
            <div className="flex max-w-[360px] flex-col items-center gap-3 text-center">
                <span className="grid size-11 place-items-center rounded-[var(--r-md)] bg-surface-active text-foreground/50">
                    <Icon className="size-5" strokeWidth={1.6} />
                </span>
                <div className="flex items-center gap-2">
                    <span className="text-[length:var(--fs-heading)] font-semibold text-foreground">{tool.label}</span>
                    <span className="rounded-[var(--r-xs)] border border-border px-1.5 leading-5 text-[length:var(--fs-micro)] text-foreground/50">即将上线</span>
                </div>
                <p className="text-[length:var(--fs-body)] text-foreground/60">{tool.description}</p>
            </div>
        </div>
    );
}

/**
 * 设计中心：左侧是工具目录的二级导航（分组折叠），右侧渲染当前工具。
 * available 工具在下面登记内容组件，soon 工具统一走 DesignToolComingSoon。
 *
 * 标题行刻意留在滚动容器之外：滚动容器带 padding，标题一旦放进去，
 * 滚动后容器上内边距会把下方内容露出一条缝。
 */
export default function DesignCenterPage() {
    const [activeTool, setActiveTool] = useState<DesignToolId>("ai-model");
    const active = DESIGN_TOOLS.find((tool) => tool.id === activeTool) ?? DESIGN_TOOLS[0];

    return (
        <WorkspacePage fluid scroll={false} className="design-center-page">
            <div className="flex h-full min-h-0 flex-col md:flex-row">
                <aside className="flex shrink-0 flex-col border-b border-border md:w-[228px] md:border-b-0 md:border-r">
                    <div className="flex h-11 shrink-0 items-center px-3.5 text-[length:var(--fs-body)] font-semibold text-foreground">设计中心</div>
                    <div className="thin-scrollbar max-h-[46vh] min-h-0 flex-1 overflow-y-auto overscroll-contain md:max-h-none">
                        <DesignToolNav activeTool={activeTool} onSelect={setActiveTool} />
                    </div>
                </aside>

                <section className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {/* 工具区上方只留一行：左侧二级导航已经高亮当前工具，页头只为补一句定位。
                        PageHeader 是 min-h-14 的两行头（标题 + 副标题 + 上下 padding，实测占 ~74px），
                        压成一行后这 ~42px 全部让给下面的工具卡片，模型/描述/原型/属性少滚一屏。 */}
                    <div className="flex min-w-0 shrink-0 items-baseline gap-2 px-3 pb-2 sm:px-4">
                        <h1 className="truncate text-[length:var(--fs-heading)] leading-6 font-semibold text-foreground">{active.label}</h1>
                        <span className="min-w-0 truncate text-xs leading-6 text-foreground/52">{active.description}</span>
                    </div>
                    {/* xl 起工具内部两栏各自滚动，外层让出滚动权；xl 以下仍是整页单条滚动。 */}
                    {/* 顶部只留半档间距：标题行已自带 padding-bottom，再垫一层会让卡片上方空一截、内容区变矮。 */}
                    <div className="app-workspace-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-2 pb-3 sm:px-4 sm:pb-4 xl:overflow-hidden">
                        {activeTool === "ai-model" ? (
                            <AiModelWorkbench />
                        ) : (
                            <div className="min-h-0 xl:h-full xl:overflow-y-auto">
                                <DesignToolComingSoon tool={active} />
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </WorkspacePage>
    );
}
