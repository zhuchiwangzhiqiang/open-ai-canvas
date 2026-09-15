import { readImageMeta } from "@/lib/image-utils";
import type { AiModelPortraitRole } from "@/lib/design/model-portrait-pipeline";
import { getActiveUserScope } from "@/lib/user-scope";
import type { AiModelHistoryItem, AiModelHistoryRecord } from "@/pages/ai-model/model-history-store";
import { withGenerationArtifactCommitLock } from "@/services/generation-asset-repository";
import { getImageBlob, uploadImage } from "@/services/image-storage";
import { isResourceUrl, resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { flushAssetStorePersistence, useAssetStore, type NewAsset } from "@/stores/use-asset-store";
import { saveRemoteUserDataNow, scheduleRemoteUserDataSync } from "@/services/user-data-sync";

// AI 模特生成的图要和画布生成结果一样进素材库。入库走 useAssetStore.addGenerationAsset：
// 它按 effectKey 派生稳定素材 ID，同一张图重复登记只会返回同一条素材。
//
// 入库键统一按「历史记录 ID + 序号」派生：生成后自动入库与在历史记录里手动补录用的是同一把键，
// 所以补录已经入库过的记录不会产生重复素材，两套键并存也不会让同一张图进库两次。

const ROLE_LABELS: Record<AiModelPortraitRole, string> = { anchor: "母版", derive: "派生", candidate: "候选" };

export type AiModelAssetSyncResult = {
    assetIds: string[];
    /** 入库失败的张数。生成/补录的其余部分照常完成，失败只作为计数返回，不抛出。 */
    failed: number;
    /** 本地已写入但服务端提交失败：调用方应如实提示"云端待同步"，不能当成完全成功。 */
    remotePending: boolean;
};

type StoredHistoryImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

/** 稳定入库键。recordId 由历史记录创建时生成，序号对应记录内的第几张。 */
export function historyItemEffectKey(recordId: string, index: number): string {
    return `ai-model-history:${recordId}:${index}`;
}

/**
 * 资源型 storageKey 对应的稳定服务端地址；非资源型（只在本机 IndexedDB）返回 null。
 * 单独抽出来是为了让"素材记录里不允许出现 blob:"这条规则可以被测试直接守住。
 */
export function stableHistoryImageUrl(storageKey: string): string | null {
    const resourceId = resourceIdFromStorageKey(storageKey);
    return resourceId ? resourceFileUrl(resourceId) : null;
}

/** 试探服务端是否真的能读出这张图：只取 1 字节，避免为了探测下载整张图。 */
async function resourceUrlReadable(url: string, signal?: AbortSignal): Promise<boolean> {
    try {
        // 资源 URL 需要带 Cookie，否则会 401（与 imageToDataUrl 的取法一致）。
        const response = await fetch(url, { signal, headers: { Range: "bytes=0-0" }, credentials: isResourceUrl(url) ? "include" : "same-origin" });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * 用本地原图重签一份可用的服务端资源，返回新的 URL 与 storageKey。
 *
 * 必须连 storageKey 一起换：use-asset-store 每次加载都会按 data.storageKey 重新推导 dataUrl，
 * 只改 dataUrl 会被下一次加载覆盖回旧资源（列表用 coverUrl 看得见、详情用 dataUrl 就是碎图）。
 */
async function remintResource(storageKey: string, signal?: AbortSignal): Promise<{ url: string; storageKey: string } | null> {
    const blob = await getImageBlob(storageKey).catch(() => undefined);
    if (!blob) return null;
    const uploaded = await uploadImage(blob);
    if (signal?.aborted) return null;
    const reminted = stableHistoryImageUrl(uploaded.storageKey);
    return reminted && (await resourceUrlReadable(reminted, signal)) ? { url: reminted, storageKey: uploaded.storageKey } : null;
}

/** 素材卡片会直接把字节数显示成「宽x高 · 大小 · 类型」，取不到就显示 0 B，所以本地缓存缺失时回源量一次。 */
async function measureMediaBytes(url: string, signal?: AbortSignal): Promise<number> {
    try {
        const response = await fetch(url, { signal, credentials: isResourceUrl(url) ? "include" : "same-origin" });
        if (!response.ok) return 0;
        return (await response.blob()).size;
    } catch {
        return 0;
    }
}

/**
 * 历史记录只存 storageKey，素材记录还要求可消费的 URL、正尺寸和字节数。
 *
 * URL 必须真的能读出来，且不能是 blob:：本地 blob 缓存是热的，resolveImageUrl 会返回
 * 页面级 objectURL，写进素材记录并同步到服务端后刷新即失效（列表走本地缓存看得见、详情请求服务端就碎图）。
 * 所以资源型只认服务端读得出来的地址，读不出来（有记录但文件缺失、状态 pending 等）就用本地原图重签一份；
 * 两条都不行才算这张入库失败，绝不写一条看着成功、实际打不开的素材。
 */
async function storedHistoryImage(item: AiModelHistoryItem, signal?: AbortSignal): Promise<StoredHistoryImage> {
    if (!item.storageKey) throw new Error("历史图片缺少资源标识");
    const stable = stableHistoryImageUrl(item.storageKey);
    let effectiveKey = item.storageKey;
    let url = stable && (await resourceUrlReadable(stable, signal)) ? stable : "";
    if (!url) {
        // 非资源型 key（只在本机 IndexedDB）也需要重签，否则只能拿到 blob:。
        const reminted = await remintResource(item.storageKey, signal);
        if (reminted) {
            url = reminted.url;
            effectiveKey = reminted.storageKey;
        }
    }
    if (!url) throw new Error("历史图片不可读且无法重签资源");
    const [meta, blob] = await Promise.all([readImageMeta(url, signal).catch(() => undefined), getImageBlob(effectiveKey).catch(() => undefined)]);
    return {
        url,
        storageKey: effectiveKey,
        width: meta?.width || 1024,
        height: meta?.height || 1024,
        bytes: blob?.size || (await measureMediaBytes(url, signal)),
        mimeType: blob?.type || meta?.mimeType || "image/png",
    };
}

/** 纯拼装：把已落地的图片信息组装成素材记录，便于单测直接校验素材合同。 */
export function historyItemAssetDraft(record: AiModelHistoryRecord, item: AiModelHistoryItem, index: number, stored: StoredHistoryImage): NewAsset {
    const roleLabel = ROLE_LABELS[item.role];
    const description = record.description.trim();
    return {
        kind: "image",
        title: description ? `AI 模特 · ${description.slice(0, 24)}` : `AI 模特 · ${roleLabel}`,
        coverUrl: stored.url,
        tags: ["AI 模特", roleLabel],
        // 数字模特就是可复用的“角色”，后续在主图、试穿里当主体用。
        category: "character",
        status: "confirmed",
        source: "AI 模特",
        metadata: {
            source: "ai-model",
            generationEffectKey: historyItemEffectKey(record.id, index),
            recordId: record.id,
            model: record.model,
            consistency: record.consistency,
            role: item.role,
            prompt: item.prompt ?? "",
        },
        data: {
            dataUrl: stored.url,
            storageKey: stored.storageKey,
            width: stored.width,
            height: stored.height,
            bytes: stored.bytes,
            mimeType: stored.mimeType,
        },
    };
}

/** 把一条历史记录的全部图片登记进素材库；单张失败只计数，不影响其余。 */
export async function saveAiModelRecordToAssets(record: AiModelHistoryRecord, signal?: AbortSignal): Promise<AiModelAssetSyncResult> {
    // 与画布生成产物共用同一把提交锁：同作用域内的素材写入串行，避免并发读改写互相覆盖。
    const result = await withGenerationArtifactCommitLock(getActiveUserScope(), async () => {
        const assetIds: string[] = [];
        let failed = 0;
        for (const [index, item] of record.items.entries()) {
            try {
                const stored = await storedHistoryImage(item, signal);
                const assetId = await useAssetStore.getState().addGenerationAsset(historyItemEffectKey(record.id, index), historyItemAssetDraft(record, item, index, stored), signal);
                // addGenerationAsset 命中已有记录时原样返回旧记录，而旧记录可能带着坏 URL
                // （blob:，或指向服务端已缺失文件的资源）。这里统一校正成这次算出的可用 URL：
                // storageKey 必须一起换，否则加载时 dataUrl 会按旧 storageKey 被推导回坏资源。
                const existing = useAssetStore.getState().assets.find((asset) => asset.id === assetId);
                if (existing?.kind === "image" && (existing.coverUrl !== stored.url || existing.data.dataUrl !== stored.url || existing.data.storageKey !== stored.storageKey)) {
                    useAssetStore.getState().updateAsset(assetId, { coverUrl: stored.url, data: { ...existing.data, dataUrl: stored.url, storageKey: stored.storageKey } });
                }
                assetIds.push(assetId);
            } catch {
                failed += 1;
            }
        }
        return { assetIds, failed, remotePending: false };
    });
    if (!result.assetIds.length) return result;

    // 只写本地是不够的：登录/刷新时服务端快照会 replaceAssets，未提交的素材会被直接覆盖掉。
    // 所以必须像素材页和画布产物那样，在返回成功前把素材提交到服务端。
    try {
        await flushAssetStorePersistence();
        await saveRemoteUserDataNow();
        return result;
    } catch {
        // 本地已经写成功，云端失败不算整体失败：安排重试并交由调用方如实提示"云端待同步"。
        scheduleRemoteUserDataSync();
        return { ...result, remotePending: true };
    }
}
