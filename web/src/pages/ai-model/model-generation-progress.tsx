import { LoaderCircle } from "lucide-react";

import type { AiModelPhase } from "@/lib/design/model-portrait-pipeline";

/** 两阶段进度：先锚定母版，再以母版为参考图派生，进度文案要区分这两步。 */
export function ModelGenerationProgress({ phase }: { phase: AiModelPhase }) {
    const anchoring = phase.phase === "anchoring";
    const finished = !anchoring && phase.total > 0 && phase.done >= phase.total;
    const title = anchoring ? "正在生成模特母版" : finished ? "正在整理生成结果" : "正在派生同一位模特";
    const detail = anchoring ? "先生成一张母版锁定人物身份，后续图片都以它为参考图。" : finished ? `已派生 ${phase.done}/${phase.total} 张。` : `已派生 ${phase.done}/${phase.total} 张，均以母版为参考图。`;
    return (
        <div className="flex items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2.5" aria-live="polite">
            <LoaderCircle className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
            <div className="min-w-0">
                <div className="text-[length:var(--fs-label)] font-medium text-foreground">{title}</div>
                <div className="mt-0.5 text-[length:var(--fs-micro)] leading-4 text-foreground/58">{detail}</div>
            </div>
        </div>
    );
}
