import { useEffect, useState } from "react";

import { WorkspaceState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import { resolveImageUrl } from "@/services/image-storage";
import type { AiModelHistoryRecord } from "@/pages/ai-model/model-history-store";

function StoredThumb({ storageKey, alt }: { storageKey: string; alt: string }) {
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
    return <img src={url} alt={alt} className="size-16 shrink-0 rounded-md object-cover" loading="lazy" />;
}

function formatCreatedAt(value: string) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return "";
    return new Date(parsed).toLocaleString("zh-CN", { hour12: false });
}

export function ModelHistoryPanel({ records, loading }: { records: AiModelHistoryRecord[]; loading: boolean }) {
    if (loading) return <WorkspaceLoadingState label="正在读取历史记录" rows={2} />;
    if (!records.length) return <WorkspaceState icon="empty" title="还没有历史记录" description="生成的模特会进入历史记录，后续可在「AI 模特图」等能力中复用。" />;

    return (
        <ul className="space-y-2">
            {records.map((record) => (
                <li key={record.id} className="rounded-md border border-border bg-surface p-3">
                    <div className="flex flex-wrap items-center gap-2 text-[var(--fs-micro)] text-foreground/58">
                        <span>{formatCreatedAt(record.createdAt)}</span>
                        <span className="truncate">{record.model}</span>
                        <span className="rounded border border-border bg-surface-active px-1.5 py-0.5">{record.consistency === "referenced" ? "已锁定同一模特" : "未锁定同一人"}</span>
                    </div>
                    {record.description ? <p className="mt-1.5 line-clamp-2 text-[var(--fs-label)] text-foreground/72">{record.description}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                        {record.items.map((item, index) => (
                            <StoredThumb key={`${record.id}-${index}`} storageKey={item.storageKey} alt={`历史模特图 ${index + 1}`} />
                        ))}
                    </div>
                </li>
            ))}
        </ul>
    );
}
