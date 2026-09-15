import { Maximize2 } from "lucide-react";
import { useEffect, useState } from "react";

import { WorkspaceState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import { AiModelHistoryPreview } from "@/pages/ai-model/model-preview";
import { resolveImageUrl } from "@/services/image-storage";
import { modelOptionName } from "@/stores/use-config-store";
import type { AiModelHistoryRecord } from "@/pages/ai-model/model-history-store";

function StoredThumb({ storageKey, alt, onOpen }: { storageKey: string; alt: string; onOpen: () => void }) {
    const [url, setUrl] = useState("");
    useEffect(() => {
        let cancelled = false;
        resolveImageUrl(storageKey)
            .then((value) => {
                if (!cancelled) setUrl(value);
            })
            .catch(() => {
                if (!cancelled) setUrl("");
            });
        return () => {
            cancelled = true;
        };
    }, [storageKey]);
    if (!url) return <div className="size-16 shrink-0 rounded-md bg-surface-active" aria-hidden />;
    return (
        <button type="button" aria-label={`放大预览 ${alt}`} className="group relative size-16 shrink-0 overflow-hidden rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1" onClick={onOpen}>
            <img src={url} alt="" className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.05] motion-reduce:transition-none motion-reduce:group-hover:scale-100" loading="lazy" />
            <span className="absolute inset-0 grid place-items-center bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none" aria-hidden="true">
                <Maximize2 className="size-3.5" />
            </span>
        </button>
    );
}

function formatCreatedAt(value: string) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return "";
    return new Date(parsed).toLocaleString("zh-CN", { hour12: false });
}

export function ModelHistoryPanel({ records, loading }: { records: AiModelHistoryRecord[]; loading: boolean }) {
    const [preview, setPreview] = useState<{ record: AiModelHistoryRecord; index: number } | null>(null);

    if (loading) return <WorkspaceLoadingState label="正在读取历史记录" rows={2} />;
    if (!records.length) return <WorkspaceState icon="empty" title="还没有历史记录" description="生成的模特会进入历史记录，后续可在「AI 模特图」等能力中复用。" />;

    return (
        <>
            <ul className="space-y-2">
                {records.map((record) => (
                    <li key={record.id} className="rounded-md border border-border bg-surface p-3">
                        <div className="flex flex-wrap items-center gap-2 text-[length:var(--fs-micro)] text-foreground/58">
                            <span>{formatCreatedAt(record.createdAt)}</span>
                            {/* 存的是 channel::model，列表里也剥掉渠道前缀，否则是一串 ID。 */}
                            <span className="truncate" title={record.model}>
                                {modelOptionName(record.model)}
                            </span>
                            <span className="rounded border border-border bg-surface-active px-1.5 py-0.5">{record.consistency === "referenced" ? "已锁定同一模特" : "未锁定同一人"}</span>
                        </div>
                        {record.description ? <p className="mt-1.5 line-clamp-2 text-[length:var(--fs-label)] text-foreground/72">{record.description}</p> : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                            {record.items.map((item, index) => (
                                <StoredThumb key={`${record.id}-${index}`} storageKey={item.storageKey} alt={`历史模特图 ${index + 1}`} onOpen={() => setPreview({ record, index })} />
                            ))}
                        </div>
                    </li>
                ))}
            </ul>
            {preview ? <AiModelHistoryPreview record={preview.record} index={preview.index} onIndexChange={(index) => setPreview((current) => (current ? { ...current, index } : current))} onClose={() => setPreview(null)} /> : null}
        </>
    );
}
