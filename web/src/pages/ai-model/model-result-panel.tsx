import { Button } from "antd";
import { saveAs } from "file-saver";
import { Download, Maximize2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { WorkspaceState } from "@/components/layout/workspace-state";
import type { AiModelPhase, AiModelPortrait, AiModelPortraitResult } from "@/lib/design/model-portrait-pipeline";
import { cn } from "@/lib/utils";
import { ModelGenerationProgress } from "@/pages/ai-model/model-generation-progress";
import { AiModelPreview } from "@/pages/ai-model/model-preview";

const roleLabels: Record<AiModelPortrait["role"], string> = {
    anchor: "母版",
    derive: "派生",
    candidate: "候选",
};

function PortraitCard({ portrait, index, onOpen }: { portrait: AiModelPortrait; index: number; onOpen: () => void }) {
    return (
        <figure className="group relative overflow-hidden rounded-md border border-border bg-surface">
            <button type="button" aria-label={`放大预览第 ${index + 1} 张模特图`} className="block w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1" onClick={onOpen}>
                <img src={portrait.image.dataUrl} alt={`AI 模特 ${index + 1}`} className="aspect-[3/4] w-full object-cover" loading="lazy" />
                <span className="absolute inset-0 grid place-items-center bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none" aria-hidden="true">
                    <Maximize2 className="size-4" />
                </span>
            </button>
            <span className={cn("absolute left-2 top-2 rounded px-1.5 py-0.5 text-[length:var(--fs-micro)] font-medium text-white", portrait.role === "anchor" ? "bg-black/70" : "bg-black/55")}>{roleLabels[portrait.role]}</span>
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
    model,
    description,
    assetSync,
    onRetry,
}: {
    result: AiModelPortraitResult | null;
    phase: AiModelPhase | null;
    error: string;
    busy: boolean;
    count: number;
    model: string;
    description: string;
    /** 生成图入素材库的状态；入库是附带动作，失败不影响结果本身。 */
    assetSync: { pending: boolean; saved: number; failed: number; remotePending: boolean };
    onRetry: () => void;
}) {
    const navigate = useNavigate();
    const [previewIndex, setPreviewIndex] = useState<number | null>(null);

    if (busy && phase) return <ModelGenerationProgress phase={phase} />;

    if (error) {
        return (
            <div className="rounded-md border border-border bg-surface p-4">
                <div className="text-[length:var(--fs-label)] font-medium text-foreground">生成失败</div>
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
            <div className="flex flex-wrap items-center gap-2 text-[length:var(--fs-micro)] text-foreground/58">
                {result.consistency === "referenced" ? (
                    <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-primary">已锁定同一模特</span>
                ) : (
                    <span className="rounded border border-border bg-surface-active px-1.5 py-0.5">当前模型不支持参考图，未锁定同一人</span>
                )}
                <span>共 {result.portraits.length} 张</span>
                {assetSync.pending ? <span className="text-foreground/45">正在存入素材库…</span> : null}
                {!assetSync.pending && assetSync.saved > 0 ? (
                    <button
                        type="button"
                        className="rounded border border-border bg-surface-active px-1.5 py-0.5 text-foreground/70 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                        onClick={() => navigate("/assets")}
                    >
                        已存入素材库 {assetSync.saved} 张 · 去查看
                    </button>
                ) : null}
                {!assetSync.pending && assetSync.failed > 0 ? <span className="text-destructive">{assetSync.failed} 张未能存入素材库</span> : null}
                {!assetSync.pending && assetSync.failed === 0 && assetSync.remotePending ? <span className="text-foreground/45">（本地已保存，云端待同步）</span> : null}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {result.portraits.map((portrait, index) => (
                    <PortraitCard key={portrait.id} portrait={portrait} index={index} onOpen={() => setPreviewIndex(index)} />
                ))}
            </div>
            {result.failed.length ? (
                <ul className="space-y-1 rounded-md border border-border bg-surface px-3 py-2 text-[length:var(--fs-micro)] text-foreground/58">
                    {result.failed.map((failure) => (
                        <li key={failure.index}>
                            第 {failure.index + 1} 张派生失败：{failure.error}
                        </li>
                    ))}
                </ul>
            ) : null}
            {previewIndex !== null ? (
                <AiModelPreview
                    title={description.trim() || "本次生成结果"}
                    model={model}
                    images={result.portraits.map((portrait) => ({ url: portrait.image.dataUrl, role: portrait.role, prompt: portrait.prompt }))}
                    index={previewIndex}
                    onIndexChange={setPreviewIndex}
                    onClose={() => setPreviewIndex(null)}
                />
            ) : null}
        </div>
    );
}
