import assert from "node:assert/strict";
import test from "node:test";

// Bun 直接执行 TypeScript 测试时需要保留扩展名；生产 tsconfig 不包含 test/。
import { parseAssetRecord } from "../src/lib/asset-record.ts";
import { historyItemAssetDraft, historyItemEffectKey, stableHistoryImageUrl } from "../src/pages/ai-model/model-asset-sync.ts";
import type { AiModelHistoryItem, AiModelHistoryRecord } from "../src/pages/ai-model/model-history-store.ts";

function record(overrides: Partial<AiModelHistoryRecord> = {}): AiModelHistoryRecord {
    return {
        id: "rec-1",
        createdAt: "2026-09-15T10:00:00.000Z",
        model: "c1::qwen-image-2.0",
        description: "清冷气质",
        attributes: { gender: "女模特" },
        consistency: "referenced",
        items: [
            { storageKey: "image:user:1", role: "anchor", prompt: "模特设定：女模特、亚洲。" },
            { storageKey: "image:user:2", role: "derive" },
        ],
        ...overrides,
    };
}

const stored = { url: "https://example.test/a.png", storageKey: "image:user:1", width: 1024, height: 1360, bytes: 4096, mimeType: "image/png" };

test("入库键按记录 ID + 序号派生，跨记录、跨张都不冲突", () => {
    assert.equal(historyItemEffectKey("rec-1", 0), historyItemEffectKey("rec-1", 0));
    assert.notEqual(historyItemEffectKey("rec-1", 0), historyItemEffectKey("rec-1", 1));
    assert.notEqual(historyItemEffectKey("rec-1", 0), historyItemEffectKey("rec-2", 0));
    assert.equal(historyItemEffectKey("rec-1", 0), "ai-model-history:rec-1:0");
});

// 素材落库前必须过 parseAssetRecord 的严格合同，否则会被隔离掉、在素材库里看不见。
test("拼出的素材记录通过素材持久化合同", () => {
    const target = record();
    const draft = historyItemAssetDraft(target, target.items[0], 0, stored);
    const parsed = parseAssetRecord({ ...draft, id: "generation_x", createdAt: target.createdAt, updatedAt: target.createdAt });

    assert.equal(parsed.kind, "image");
    assert.equal(parsed.category, "character");
    assert.equal(parsed.coverUrl, stored.url);
    assert.deepEqual(parsed.tags, ["AI 模特", "母版"]);
    if (parsed.kind !== "image") throw new Error("素材类型应为图片");
    assert.equal(parsed.data.storageKey, stored.storageKey);
    assert.equal(parsed.data.width, 1024);
    assert.equal(parsed.data.height, 1360);
    assert.equal(parsed.data.bytes, 4096);
    assert.equal(parsed.data.mimeType, "image/png");
});

test("标题优先用描述，描述为空时回退到角色名", () => {
    const described = record();
    assert.equal(historyItemAssetDraft(described, described.items[0], 0, stored).title, "AI 模特 · 清冷气质");

    const blank = record({ description: "   " });
    assert.equal(historyItemAssetDraft(blank, blank.items[0], 0, stored).title, "AI 模特 · 母版");
    assert.equal(historyItemAssetDraft(blank, blank.items[1], 1, stored).title, "AI 模特 · 派生");

    const long = record({ description: "一".repeat(60) });
    assert.ok(historyItemAssetDraft(long, long.items[0], 0, stored).title.length <= 24 + "AI 模特 · ".length);
});

test("素材元数据保留可追溯的生成上下文", () => {
    const target = record();
    const metadata = historyItemAssetDraft(target, target.items[1], 1, stored).metadata as Record<string, unknown>;

    assert.equal(metadata.source, "ai-model");
    assert.equal(metadata.model, "c1::qwen-image-2.0");
    assert.equal(metadata.recordId, "rec-1");
    assert.equal(metadata.consistency, "referenced");
    assert.equal(metadata.role, "derive");
    assert.equal(metadata.generationEffectKey, historyItemEffectKey("rec-1", 1));
    // 旧记录可能没存 prompt，不能拼出 undefined。
    assert.equal(metadata.prompt, "");
});

test("缺 prompt 的历史项仍能产出合法素材", () => {
    const target = record();
    const withoutPrompt: AiModelHistoryItem = { storageKey: "image:user:3", role: "candidate" };
    const draft = historyItemAssetDraft(target, withoutPrompt, 2, { ...stored, storageKey: "image:user:3" });

    assert.equal((draft.metadata as Record<string, unknown>).prompt, "");
    assert.equal(parseAssetRecord({ ...draft, id: "generation_y", createdAt: target.createdAt, updatedAt: target.createdAt }).kind, "image");
});

// blob: 是页面级 objectURL，写进会被持久化并同步到服务端的素材记录后刷新即失效（预览碎图）。
// 资源型 storageKey 必须落稳定的服务端地址；这条规则曾经踩过，用测试锁住。
test("资源型 storageKey 取稳定服务端地址，绝不产出 blob: URL", () => {
    const resourceKey = "resource:image:abcdef123456";
    const stable = stableHistoryImageUrl(resourceKey);

    assert.ok(stable, "资源型 storageKey 必须能给出稳定地址");
    assert.ok(!stable!.startsWith("blob:"), "稳定地址不能是 blob: URL");
    assert.ok(!stable!.startsWith("data:"), "稳定地址不能是内联 data URL");
});

test("非资源型 storageKey 不谎报稳定地址", () => {
    // 只存在于本机 IndexedDB 的旧格式 key：没有服务端地址，必须回落到本地解析而不是编一个。
    assert.equal(stableHistoryImageUrl("image:user:abc"), null);
});
