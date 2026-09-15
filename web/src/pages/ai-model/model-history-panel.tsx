import { App, Button } from "antd";
import { Maximize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { WorkspaceState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import { historyItemEffectKey, saveAiModelRecordToAssets } from "@/pages/ai-model/model-asset-sync";
import { AiModelHistoryPreview } from "@/pages/ai-model/model-preview";
import { resolveImageUrl } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
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
    const { message } = App.useApp();
    const [preview, setPreview] = useState<{ record: AiModelHistoryRecord; index: number } | null>(null);
    const [saving, setSaving] = useState<Record<string, boolean>>({});
    const [autoSyncing, setAutoSyncing] = useState(false);
    // 每次挂载对每条记录最多自动补录一次；失败留给手动按钮重试，避免和素材状态更新互相触发成环。
    const attempted = useRef(new Set<string>());
    // 已入库判定按入库键查素材，不用本地状态记账：刷新后仍能正确显示"已存入"。
    const assets = useAssetStore((state) => state.assets);
    // 必须等素材库落盘完成再判定，否则会把"还没加载出来"误当成"没入库"，对每条记录白跑一次补录。
    const assetsHydrated = useAssetStore((state) => state.hydrated);

    const savedCount = (record: AiModelHistoryRecord) => {
        const byKey = new Map(assets.map((asset) => [asset.metadata?.generationEffectKey, asset]));
        return record.items.filter((_, index) => {
            const asset = byKey.get(historyItemEffectKey(record.id, index));
            // blob: 是页面级 objectURL，写进素材记录就会碎图（列表走本地缓存看得见，详情请求服务端就没了），
            // 这种记录算作"未入库"，让补录重跑时按可读 URL 校正。
            return asset ? !asset.coverUrl.startsWith("blob:") : false;
        }).length;
    };

    useEffect(() => {
        if (loading || !assetsHydrated) return;
        // 入库功能上线前生成的记录不会自动入库：打开历史记录时替用户补一次，不需要手动点。
        const pending = records.filter((record) => !attempted.current.has(record.id) && savedCount(record) < record.items.length);
        if (!pending.length) return;
        pending.forEach((record) => attempted.current.add(record.id));
        setAutoSyncing(true);
        void (async () => {
            for (const record of pending) await saveAiModelRecordToAssets(record).catch(() => undefined);
            setAutoSyncing(false);
        })();
    }, [loading, assetsHydrated, records, assets]);

    if (loading) return <WorkspaceLoadingState label="正在读取历史记录" rows={2} />;
    if (!records.length) return <WorkspaceState icon="empty" title="还没有历史记录" description="生成的模特会进入历史记录，后续可在「AI 模特图」等能力中复用。" />;

    const saveToAssets = async (record: AiModelHistoryRecord) => {
        setSaving((current) => ({ ...current, [record.id]: true }));
        try {
            const result = await saveAiModelRecordToAssets(record);
            if (result.failed) message.warning(`${result.failed} 张未能存入素材库`);
            else if (result.remotePending) message.warning(`已在本地存入素材库 ${result.assetIds.length} 张，云端同步待重试`);
            else message.success(`已存入素材库 ${result.assetIds.length} 张`);
        } catch {
            message.error("存入素材库失败");
        } finally {
            setSaving((current) => ({ ...current, [record.id]: false }));
        }
    };

    return (
        <>
            {autoSyncing ? <p className="mb-2 text-[length:var(--fs-micro)] text-foreground/45">正在把历史图片同步到素材库…</p> : null}
            <ul className="space-y-2">
                {records.map((record) => {
                    const saved = savedCount(record);
                    const total = record.items.length;
                    return (
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
                            <div className="mt-2.5 flex items-center justify-between gap-2">
                                <span className="text-[length:var(--fs-micro)] text-foreground/45">{saved >= total ? `已存入素材库 ${saved} 张` : saved > 0 ? `素材库已有 ${saved}/${total} 张` : `共 ${total} 张，未存入素材库`}</span>
                                {saved < total ? (
                                    <Button size="small" loading={saving[record.id]} onClick={() => void saveToAssets(record)}>
                                        存入素材库
                                    </Button>
                                ) : null}
                            </div>
                        </li>
                    );
                })}
            </ul>
            {preview ? <AiModelHistoryPreview record={preview.record} index={preview.index} onIndexChange={(index) => setPreview((current) => (current ? { ...current, index } : current))} onClose={() => setPreview(null)} /> : null}
        </>
    );
}
