import localforage from "localforage";

import type { ModelAttributes } from "@/lib/design/model-attributes";
import type { AiModelPortrait, AiModelPortraitResult } from "@/lib/design/model-portrait-pipeline";
import { scopedStorageKey } from "@/lib/user-scope";
import { uploadImage } from "@/services/image-storage";

// 生成结果必须落成本地资源：刷新后仍能回看，且后端不可用时上传会自动退回 IndexedDB。
const store = localforage.createInstance({ name: "infinite-canvas", storeName: "ai_model_history" });
const HISTORY_LIMIT = 30;
const HISTORY_KEY = "ai-model-history";

/** prompt 在旧记录里可能缺失（字段后加），预览面板需要按可选处理。 */
export type AiModelHistoryItem = { storageKey: string; role: AiModelPortrait["role"]; prompt?: string };

export type AiModelHistoryRecord = {
    id: string;
    createdAt: string;
    model: string;
    description: string;
    attributes: ModelAttributes;
    consistency: AiModelPortraitResult["consistency"];
    items: AiModelHistoryItem[];
};

function historyKey() {
    return scopedStorageKey(HISTORY_KEY);
}

export async function readAiModelHistory(): Promise<AiModelHistoryRecord[]> {
    if (typeof window === "undefined") return [];
    const value = await store.getItem<AiModelHistoryRecord[]>(historyKey());
    return Array.isArray(value) ? value : [];
}

export async function appendAiModelHistory(input: { model: string; description: string; attributes: ModelAttributes; consistency: AiModelPortraitResult["consistency"]; portraits: AiModelPortrait[] }): Promise<AiModelHistoryRecord[]> {
    const items: AiModelHistoryItem[] = [];
    for (const portrait of input.portraits) {
        const uploaded = await uploadImage(portrait.image.dataUrl);
        items.push({ storageKey: uploaded.storageKey, role: portrait.role, prompt: portrait.prompt });
    }
    const record: AiModelHistoryRecord = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        model: input.model,
        description: input.description,
        attributes: input.attributes,
        consistency: input.consistency,
        items,
    };
    const next = [record, ...(await readAiModelHistory())].slice(0, HISTORY_LIMIT);
    await store.setItem(historyKey(), next);
    return next;
}
