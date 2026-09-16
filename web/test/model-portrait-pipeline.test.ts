import assert from "node:assert/strict";
import test from "node:test";

// Bun 直接执行 TypeScript 测试时需要保留扩展名；生产 tsconfig 不包含 test/。
import { clampPortraitCount, derivedPoses, generateAiModelPortraits, supportsModelReference, type AiModelGenerationRunner, type AiModelPhase } from "../src/lib/design/model-portrait-pipeline.ts";
import { DERIVE_FRAMINGS } from "../src/lib/design/model-prompt.ts";
import type { BackendGenerationResult } from "../src/services/api/generation-task.ts";
import type { AiConfig } from "../src/stores/use-config-store.ts";

type TaskOptions = Parameters<AiModelGenerationRunner["runTask"]>[0];
type BatchOptions = Parameters<AiModelGenerationRunner["runBatch"]>[0];

// 管线只读取 model 与 channels，能力探测走 modelCapabilityConfigFor 的兜底配置。
const referencedConfig = { model: "c1::m1", channels: [{ id: "c1", models: ["m1"] }] } as unknown as AiConfig;
// grok-imagine-image 的兜底能力配置 maxImages 为 0，代表模型不吃参考图。
const unreferencedConfig = { model: "c1::grok-imagine-image", channels: [{ id: "c1", models: ["grok-imagine-image"] }] } as unknown as AiConfig;

function imageResult(dataUrl: string): BackendGenerationResult {
    return { mode: "image", images: [{ dataUrl, mimeType: "image/png" }] };
}

function input(overrides: Partial<Parameters<typeof generateAiModelPortraits>[0]> = {}) {
    return {
        config: referencedConfig,
        attributes: { gender: "女模特", nationality: "亚洲", style: "简约摄影棚", pose: "站姿正面" },
        description: "清冷气质",
        count: 3,
        variation: true,
        ...overrides,
    };
}

test("支持参考图时先出母版，再以母版为参考图派生剩余张数", async () => {
    const taskCalls: TaskOptions[] = [];
    const runner = {
        runTask: async (options: TaskOptions) => {
            taskCalls.push(options);
            return imageResult(`data:image/png;base64,${taskCalls.length}`);
        },
        runBatch: async () => {
            throw new Error("支持参考图时不应走批量候选分支");
        },
    } as unknown as AiModelGenerationRunner;

    const phases: AiModelPhase[] = [];
    const result = await generateAiModelPortraits(input({ onPhase: (phase) => phases.push(phase) }), runner);

    assert.equal(taskCalls.length, 3);
    assert.equal(result.consistency, "referenced");
    assert.deepEqual(
        result.portraits.map((portrait) => portrait.role),
        ["anchor", "derive", "derive"],
    );
    assert.equal(result.failed.length, 0);

    // 每个任务只产出一张：张数完全由任务数决定。
    assert.equal(taskCalls[0].config.count, "1");
    assert.equal(taskCalls[0].referenceImages, undefined);
    assert.equal(taskCalls[0].metadata?.portraitRole, "anchor");

    // 派生必须携带母版参考图，这就是身份一致性的来源。
    assert.equal(taskCalls[1].referenceImages?.[0], result.portraits[0].image);
    assert.equal(taskCalls[2].referenceImages?.[0], result.portraits[0].image);
    assert.ok(taskCalls[1].prompt.includes(DERIVE_FRAMINGS[0]));
    assert.ok(taskCalls[2].prompt.includes(DERIVE_FRAMINGS[1]));
    // 派生带参考图，必须说明参考图只锁身份：否则模型会沿用母版的全身构图，裁不出更近的取景。
    assert.ok(taskCalls[1].prompt.includes("不要沿用参考图的构图、裁切和背景"));
    assert.ok(taskCalls[2].prompt.includes("不要沿用参考图的构图、裁切和背景"));
    assert.equal(taskCalls[0].prompt.includes("参考图"), false);
    assert.notEqual(taskCalls[1].prompt, taskCalls[2].prompt);

    // 预览面板直接展示 portrait.prompt，它必须逐字等于当时发给上游的那段文本。
    assert.deepEqual(
        result.portraits.map((portrait) => portrait.prompt),
        taskCalls.map((call) => call.prompt),
    );

    assert.deepEqual(phases[0], { phase: "anchoring" });
    assert.deepEqual(phases[phases.length - 1], { phase: "deriving", done: 2, total: 2 });
});

test("count=1 时只出母版，且不产生派生阶段", async () => {
    const taskCalls: TaskOptions[] = [];
    const runner = {
        runTask: async (options: TaskOptions) => {
            taskCalls.push(options);
            return imageResult(`data:image/png;base64,${taskCalls.length}`);
        },
        runBatch: async () => {
            throw new Error("支持参考图时不应走批量候选分支");
        },
    } as unknown as AiModelGenerationRunner;

    const phases: AiModelPhase[] = [];
    const result = await generateAiModelPortraits(input({ count: 1, onPhase: (phase) => phases.push(phase) }), runner);

    assert.equal(taskCalls.length, 1);
    assert.deepEqual(
        result.portraits.map((portrait) => portrait.role),
        ["anchor"],
    );
    assert.equal(result.consistency, "referenced");
    assert.equal(result.failed.length, 0);
    // 没有派生任务就不该报出 0/0 的派生阶段，否则进度面板会显示"正在派生同一位模特"。
    assert.deepEqual(phases, [{ phase: "anchoring" }]);

    // 母版走逐项人物设定 + 固定构图约束的骨架，且落库 prompt 与真正发出的那段逐字一致。
    assert.equal(taskCalls[0].metadata?.portraitRole, "anchor");
    assert.equal(taskCalls[0].referenceImages, undefined);
    assert.ok(taskCalls[0].prompt.includes("人物设定：\n- 性别：女模特"));
    assert.ok(taskCalls[0].prompt.includes("构图：全身人像，从头顶到脚底完整入画"));
    assert.equal(result.portraits[0].prompt, taskCalls[0].prompt);
});

test("模型不吃参考图时退化为候选图，并标记未锁定身份", async () => {
    const batchCalls: BatchOptions[] = [];
    let taskCalled = false;
    const runner = {
        runTask: async () => {
            taskCalled = true;
            return imageResult("data:image/png;base64,anchor");
        },
        runBatch: async (options: BatchOptions) => {
            batchCalls.push(options);
            return Array.from({ length: options.count }, (_, index) => ({
                status: "fulfilled" as const,
                value: imageResult(`data:image/png;base64,candidate-${index}`),
            }));
        },
    } as unknown as AiModelGenerationRunner;

    const result = await generateAiModelPortraits(input({ config: unreferencedConfig }), runner);

    assert.equal(taskCalled, false);
    assert.equal(batchCalls.length, 1);
    assert.equal(batchCalls[0].count, 3);
    assert.equal(result.consistency, "unverified");
    assert.deepEqual(
        result.portraits.map((portrait) => portrait.role),
        ["candidate", "candidate", "candidate"],
    );
    assert.ok(result.portraits.every((portrait) => portrait.prompt === batchCalls[0].prompt));
});

test("派生单张失败时保留其余结果并记录失败项", async () => {
    let callIndex = 0;
    const runner = {
        runTask: async () => {
            callIndex += 1;
            if (callIndex === 2) throw new Error("上游超时");
            return imageResult(`data:image/png;base64,${callIndex}`);
        },
        runBatch: async () => {
            throw new Error("支持参考图时不应走批量候选分支");
        },
    } as unknown as AiModelGenerationRunner;

    const result = await generateAiModelPortraits(input(), runner);

    assert.equal(result.portraits.length, 2);
    assert.deepEqual(
        result.portraits.map((portrait) => portrait.role),
        ["anchor", "derive"],
    );
    assert.deepEqual(result.failed, [{ index: 0, error: "上游超时" }]);
});

test("母版没有返回图片时整体失败", async () => {
    const runner = {
        runTask: async () => ({ mode: "image" as const, images: [] }),
        runBatch: async () => [],
    } as unknown as AiModelGenerationRunner;

    await assert.rejects(() => generateAiModelPortraits(input(), runner), /母版生成未返回图片/);
});

test("能力探测与张数收敛", () => {
    assert.equal(supportsModelReference(referencedConfig), true);
    assert.equal(supportsModelReference(unreferencedConfig), false);
    assert.equal(clampPortraitCount(0), 1);
    assert.equal(clampPortraitCount(99), 15);
    assert.equal(clampPortraitCount(3), 3);
});

test("派生姿势轮换避开母版姿势，关闭变化时沿用属性姿势", () => {
    assert.deepEqual(derivedPoses("站姿正面", 3, true), ["侧身", "走动", "坐姿"]);
    assert.deepEqual(derivedPoses("站姿正面", 3, false), [undefined, undefined, undefined]);
    assert.deepEqual(derivedPoses(undefined, 2, true), ["站姿正面", "侧身"]);
    assert.deepEqual(derivedPoses("站姿正面", 0, true), []);
});
