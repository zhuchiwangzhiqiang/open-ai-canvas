import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { DESIGN_TOOL_GROUPS, type DesignToolId } from "@/constant/design-tools";
import { cn } from "@/lib/utils";

/** 设计中心的二级导航：按分组折叠展示工具入口。 */
export function DesignToolNav({ activeTool, onSelect }: { activeTool: DesignToolId; onSelect: (tool: DesignToolId) => void }) {
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

    return (
        <nav className="flex flex-col gap-3 p-2.5" aria-label="设计中心工具">
            {DESIGN_TOOL_GROUPS.map((group) => {
                const GroupIcon = group.icon;
                const expanded = !collapsedGroups[group.id];
                return (
                    <section key={group.id} className="flex flex-col gap-0.5">
                        <button
                            type="button"
                            aria-expanded={expanded}
                            className="flex min-h-9 w-full items-center gap-2.5 rounded-[var(--r-sm)] px-2 py-1.5 text-left text-[length:var(--fs-body)] font-medium text-foreground/72 transition-colors select-none hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                            onClick={() => setCollapsedGroups((current) => ({ ...current, [group.id]: expanded }))}
                        >
                            <span className="grid size-7 shrink-0 place-items-center rounded-[var(--r-sm)] bg-surface-active text-foreground/60">
                                <GroupIcon className="size-3.5" strokeWidth={1.7} />
                            </span>
                            <span className="min-w-0 flex-1 truncate">{group.label}</span>
                            <ChevronDown className={cn("size-3.5 shrink-0 text-foreground/40 transition-transform duration-200 motion-reduce:transition-none", expanded && "rotate-180")} strokeWidth={2} />
                        </button>
                        {expanded ? (
                            /* pl-7 让三级入口的图标左缘对齐分组图标的右缘，靠缩进表达从属关系。 */
                            <div className="flex flex-col gap-0.5 pl-7">
                                {group.tools.map((tool) => {
                                    const ToolIcon = tool.icon;
                                    const active = tool.id === activeTool;
                                    const soon = tool.status === "soon";
                                    return (
                                        <button
                                            key={tool.id}
                                            type="button"
                                            aria-current={active ? "page" : undefined}
                                            title={soon ? `${tool.description}（即将上线）` : tool.description}
                                            className={cn(
                                                "flex min-h-9 w-full items-center gap-2.5 rounded-[var(--r-sm)] px-2 py-1.5 text-left text-[length:var(--fs-body)] transition-colors select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1",
                                                active ? "bg-primary/10 font-medium text-primary" : "text-foreground/62 hover:bg-surface-hover hover:text-foreground",
                                            )}
                                            onClick={() => onSelect(tool.id)}
                                        >
                                            <span className={cn("grid size-6 shrink-0 place-items-center rounded-[var(--r-sm)]", active ? "bg-primary/15" : cn("bg-surface-active", soon ? "text-foreground/40" : "text-foreground/55"))}>
                                                <ToolIcon className="size-3" strokeWidth={1.7} />
                                            </span>
                                            <span className="flex min-w-0 flex-1 items-center gap-2">
                                                <span className="min-w-0 truncate">{tool.label}</span>
                                                {/* 状态跟在名称后面而不是贴右对齐，避免每行堆一个灰块形成锯齿列。 */}
                                                {soon ? <span className={cn("shrink-0 text-[length:var(--fs-micro)]", active ? "text-primary/60" : "text-foreground/35")}>即将上线</span> : null}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : null}
                    </section>
                );
            })}
        </nav>
    );
}
