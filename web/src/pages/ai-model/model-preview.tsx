import { Button } from "antd";
import { saveAs } from "file-saver";
import { Download, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";

import { AppModal } from "@/components/ui/product/app-modal";
import { buildModelAnchorPrompt } from "@/lib/design/model-prompt";
import type { AiModelPortraitRole } from "@/lib/design/model-portrait-pipeline";
import { cn } from "@/lib/utils";
import type { AiModelHistoryItem, AiModelHistoryRecord } from "@/pages/ai-model/model-history-store";
import { resolveImageUrl } from "@/services/image-storage";
import { modelOptionName } from "@/stores/use-config-store";

const ROLE_LABELS: Record<AiModelPortraitRole, string> = { anchor: "母版", derive: "派生", candidate: "候选" };

export type AiModelPreviewImage = {
    url: string;
    role: AiModelPortraitRole;
    prompt: string;
    /** prompt 是按模特设定重建而非原始文本时为 true，面板会补一行说明。 */
    reconstructed?: boolean;
};

function useRecordImageUrls(items: AiModelHistoryItem[]) {
    const [urls, setUrls] = useState<string[]>([]);

    useEffect(() => {
        let cancelled = false;
        // 历史记录只存 storageKey，大图和缩略图条都要先换成能直接渲染的 URL。
        Promise.all(items.map((item) => resolveImageUrl(item.storageKey).catch(() => "")))
            .then((resolved) => {
                if (!cancelled) setUrls(resolved);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [items]);

    return urls;
}

function formatCreatedAt(value: string) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return "";
    return new Date(parsed).toLocaleString("zh-CN", { hour12: false });
}

/** 图片预览：左侧大图 + 缩略图条，右侧详情面板（提示词与下载）。生成结果与历史记录共用这一套。 */
export function AiModelPreview({
    title,
    model,
    createdAt,
    images,
    index,
    onIndexChange,
    onClose,
}: {
    title: string;
    model: string;
    createdAt?: string;
    images: AiModelPreviewImage[];
    index: number;
    onIndexChange: (index: number) => void;
    onClose: () => void;
}) {
    const current = images[index];
    const url = current?.url ?? "";
    const roleLabel = current ? ROLE_LABELS[current.role] : "";

    const download = () => {
        if (url) saveAs(url, `ai-model-${index + 1}.png`);
    };

    return (
        <AppModal
            flush
            open
            title={null}
            footer={null}
            centered
            destroyOnHidden
            closeIcon={null}
            width="min(1180px, calc(100vw - 32px))"
            onCancel={onClose}
            /* 大图要直接浮在遮罩上，所以去掉 AntD 弹窗外壳的底色与投影。 */
            styles={{ container: { background: "transparent", boxShadow: "none" } }}
        >
            <div className="flex max-h-[86vh] flex-col gap-3 lg:flex-row lg:gap-4">
                <div className="group relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
                    {url ? (
                        <img src={url} alt={`AI 模特第 ${index + 1} 张`} className="max-h-[58vh] w-auto max-w-full rounded-lg object-contain lg:max-h-[82vh]" />
                    ) : (
                        <div className="aspect-[3/4] w-full max-w-[320px] animate-pulse rounded-lg bg-foreground/10 motion-reduce:animate-none" />
                    )}
                    {url ? (
                        <button
                            type="button"
                            aria-label={`下载第 ${index + 1} 张模特图`}
                            className="absolute grid size-10 place-items-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/70 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 motion-reduce:transition-none"
                            onClick={download}
                        >
                            <Download className="size-4" />
                        </button>
                    ) : null}
                    {images.length > 1 ? (
                        <div className="absolute bottom-3 flex gap-2">
                            {images.map((image, imageIndex) => (
                                <button
                                    key={imageIndex}
                                    type="button"
                                    aria-label={`查看第 ${imageIndex + 1} 张`}
                                    aria-current={imageIndex === index ? "true" : undefined}
                                    className={cn(
                                        "size-12 shrink-0 overflow-hidden rounded-md border-2 bg-black/30 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 motion-reduce:transition-none",
                                        imageIndex === index ? "border-white" : "border-white/25 hover:border-white/60",
                                    )}
                                    onClick={() => onIndexChange(imageIndex)}
                                >
                                    {image.url ? <img src={image.url} alt="" className="size-full object-cover" /> : null}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>

                <aside className="flex w-full shrink-0 flex-col rounded-xl border border-border bg-surface lg:w-[340px]">
                    <header className="flex items-start gap-2 border-b border-border p-3.5">
                        <div className="min-w-0 flex-1">
                            <h2 className="line-clamp-2 text-[length:var(--fs-body)] font-semibold text-foreground">{title}</h2>
                            <p className="mt-1 text-[length:var(--fs-micro)] text-foreground/45">设计中心 · AI 模特</p>
                        </div>
                        <button
                            type="button"
                            aria-label="关闭预览"
                            className="grid size-7 shrink-0 place-items-center rounded-md text-foreground/45 transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 motion-reduce:transition-none"
                            onClick={onClose}
                        >
                            <X className="size-3.5" />
                        </button>
                    </header>

                    <div className="hide-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-3.5">
                        <div className="flex items-center gap-2 rounded-lg bg-surface-active px-2.5 py-2">
                            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-background text-foreground/55">
                                <UserRound className="size-3.5" strokeWidth={1.7} />
                            </span>
                            {/* 历史记录与生成结果存的都是 channel::model，展示时统一剥掉渠道前缀。 */}
                            <span className="min-w-0 flex-1 truncate text-[length:var(--fs-micro)] text-foreground/75" title={model}>
                                {modelOptionName(model)}
                            </span>
                            <span className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[length:var(--fs-micro)] text-foreground/60">{roleLabel}</span>
                        </div>

                        <div className="mt-1 flex items-baseline justify-between gap-2">
                            <span className="text-[length:var(--fs-micro)] font-medium text-foreground/50">模特提示词</span>
                            {createdAt ? <span className="text-[length:var(--fs-micro)] text-foreground/38">{formatCreatedAt(createdAt)}</span> : null}
                        </div>
                        <p className="whitespace-pre-wrap rounded-lg border border-border bg-background p-2.5 text-[length:var(--fs-micro)] leading-5 text-foreground/80">{current?.prompt ?? ""}</p>
                        {current?.reconstructed ? <p className="text-[length:var(--fs-micro)] leading-4 text-foreground/40">该记录生成于保存提示词之前，此处按模特设定重建。</p> : null}
                    </div>

                    <div className="border-t border-border p-3.5">
                        <Button type="primary" block disabled={!url} onClick={download}>
                            <span className="inline-flex items-center gap-1.5">
                                <Download className="size-3.5" />
                                下载
                            </span>
                        </Button>
                    </div>
                </aside>
            </div>
        </AppModal>
    );
}

/** 历史记录入口：先把 storageKey 换成可渲染 URL，再交给 AiModelPreview。 */
export function AiModelHistoryPreview({ record, index, onIndexChange, onClose }: { record: AiModelHistoryRecord; index: number; onIndexChange: (index: number) => void; onClose: () => void }) {
    const items = record.items;
    const urls = useRecordImageUrls(items);
    const images: AiModelPreviewImage[] = items.map((item, itemIndex) => ({
        url: urls[itemIndex] ?? "",
        role: item.role,
        // prompt 是后加字段：旧记录缺它，只能按同一套模特属性重建，新记录永远原样展示。
        prompt: item.prompt ?? buildModelAnchorPrompt(record.attributes, record.description),
        reconstructed: !item.prompt,
    }));
    const current = items[index];
    const roleLabel = current ? ROLE_LABELS[current.role] : "";

    return <AiModelPreview title={record.description.trim() || `${roleLabel}图`} model={record.model} createdAt={record.createdAt} images={images} index={index} onIndexChange={onIndexChange} onClose={onClose} />;
}
