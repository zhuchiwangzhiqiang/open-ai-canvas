import { Button } from "antd";
import { saveAs } from "file-saver";
import { Download } from "lucide-react";

import { WorkspaceState } from "@/components/layout/workspace-state";
import type { AiModelPhase, AiModelPortrait, AiModelPortraitResult } from "@/lib/design/model-portrait-pipeline";
import { cn } from "@/lib/utils";
import { ModelGenerationProgress } from "@/pages/ai-model/model-generation-progress";

const roleLabels: Record<AiModelPortrait["role"], string> = {
    anchor: "母版",
    derive: "派生",
    candidate: "候选",
};

function PortraitCard({ portrait, index }: { portrait: AiModelPortrait; index: number }) {
    return (
        <figure className="group relative overflow-hidden rounded-md border border-border bg-surface">
            <img src={portrait.image.dataUrl} alt={`AI 模特 ${index + 1}`} className="aspect-[3/4] w-full object-cover" loading="lazy" />
            <span className={cn("absolute left-2 top-2 rounded px-1.5 py-0.5 text-[var(--fs-micro)] font-medium text-white", portrait.role === "anchor" ? "bg-black/70" : "bg-black/55")}>
                {roleLabels[portrait.role]}
            </span>
            <button
                type="button"
                aria-label={`下载第 ${index + 1} 张模特图`}
                className="absolute right-2 top-2 grid size-7 place-items-center rounded-md bg-black/55 text-white transition-opacity motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                onClick={() => saveAs(portrait.image.dataUrl, `ai-model-${index + 1}.png`)}
            >
                <Download className="size-3.5" />
            </button>
        </figure>
    );
}

export function ModelResultPanel({
    result,
    phase,
    error,
    busy,
    count,
    onRetry,
}: {
    result: AiModelPortraitResult | null;
    phase: AiModelPhase | null;
    error: string;
    busy: boolean;
    count: number;
    onRetry: () => void;
}) {
    if (busy && phase) return <ModelGenerationProgress phase={phase} />;

    if (error) {
        return (
            <div className="rounded-md border border-border bg-surface p-4">
                <div className="text-[var(--fs-label)] font-medium text-foreground">生成失败</div>
                <p className="mt-1.5 text-xs leading-5 text-foreground/58">{error}</p>
                <Button className="mt-3" onClick={onRetry}>
                    重试
                </Button>
            </div>
        );
    }

    if (!result?.portraits.length) {
        return <WorkspaceState icon="empty" title="还没有生成结果" description={`填好属性后点「生成 ${count} 张模特」，结果会出现在这里`} />;
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-[var(--fs-micro)] text-foreground/58">
                {result.consistency === "referenced" ? (
                    <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-primary">已锁定同一模特</span>
                ) : (
                    <span className="rounded border border-border bg-surface-active px-1.5 py-0.5">当前模型不支持参考图，未锁定同一人</span>
                )}
                <span>共 {result.portraits.length} 张</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {result.portraits.map((portrait, index) => (
                    <PortraitCard key={portrait.id} portrait={portrait} index={index} />
                ))}
            </div>
            {result.failed.length ? (
                <ul className="space-y-1 rounded-md border border-border bg-surface px-3 py-2 text-[var(--fs-micro)] text-foreground/58">
                    {result.failed.map((failure) => (
                        <li key={failure.index}>
                            第 {failure.index + 1} 张派生失败：{failure.error}
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}
