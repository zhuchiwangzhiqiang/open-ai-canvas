import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { normalizeModelAttributes, POSE_VALUES, type ModelAttributes } from "@/lib/design/model-attributes";
import { buildModelAnchorPrompt, buildModelVariantPrompt, deriveFraming } from "@/lib/design/model-prompt";
import { isGenerationTaskCancelled, runBackendGenerationTask, runBackendGenerationTaskBatch, type BackendGenerationResult, type GenerationTaskDependencies } from "@/services/api/generation-task";
import type { GenerationTask } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

// 与后端单次批量上限保持一致：runBackendGenerationTaskBatch 会把 count 收敛到 1..15。
export const MAX_MODEL_PORTRAITS = 15;

export type AiModelPhase = { phase: "anchoring" } | { phase: "deriving"; done: number; total: number };

/** candidate 表示模型不支持参考图，这些图之间没有身份关联。 */
export type AiModelPortraitRole = "anchor" | "derive" | "candidate";

export type AiModelPortrait = {
    id: string;
    role: AiModelPortraitRole;
    taskId: string;
    image: ReferenceImage;
    /** 当时真正发给上游的那段提示词，随历史记录落库，预览面板原样展示而不再二次拼装。 */
    prompt: string;
};

export type AiModelPortraitFailure = { index: number; error: string };

export type AiModelPortraitResult = {
    portraits: AiModelPortrait[];
    failed: AiModelPortraitFailure[];
    /** referenced：已用母版参考图锁定身份；unverified：模型不吃参考图，未锁定。 */
    consistency: "referenced" | "unverified";
};

export type AiModelPortraitInput = {
    config: AiConfig;
    attributes: ModelAttributes;
    description?: string;
    count: number;
    /** true 时派生图轮换姿势，false 时沿用属性中的姿势。 */
    variation: boolean;
    signal?: AbortSignal;
    onPhase?: (phase: AiModelPhase) => void;
    onTask?: (task: GenerationTask) => void;
};

/** 生成入口可替换，便于在不触达后端的前提下验证两阶段编排。 */
export type AiModelGenerationRunner = {
    runTask: typeof runBackendGenerationTask;
    runBatch: typeof runBackendGenerationTaskBatch;
};

const defaultRunner: AiModelGenerationRunner = {
    runTask: runBackendGenerationTask,
    runBatch: runBackendGenerationTaskBatch,
};

type BackendGenerationImage = NonNullable<BackendGenerationResult["images"]>[number];

/** 是否能用参考图锚定身份；为 false 时同一批图无法保证是同一个人。 */
export function supportsModelReference(config: AiConfig): boolean {
    return (modelCapabilityConfigFor(config, config.model).image?.references.maxImages ?? 0) > 0;
}

export function clampPortraitCount(count: number): number {
    const normalized = Math.floor(Number(count));
    if (!Number.isFinite(normalized) || normalized < 1) return 1;
    return Math.min(MAX_MODEL_PORTRAITS, normalized);
}

/** 派生姿势轮换：避开母版已经使用的姿势，不足时循环补齐。 */
export function derivedPoses(anchorPose: string | undefined, total: number, variation: boolean): Array<string | undefined> {
    if (total <= 0) return [];
    if (!variation) return Array.from({ length: total }, () => undefined);
    const candidates = POSE_VALUES.filter((pose) => pose !== anchorPose);
    if (!candidates.length) return Array.from({ length: total }, () => anchorPose);
    return Array.from({ length: total }, (_, index) => candidates[index % candidates.length]);
}

function imageResultToReference(image: BackendGenerationImage): ReferenceImage | null {
    if (!image?.dataUrl) return null;
    return {
        id: crypto.randomUUID(),
        name: "ai-model.png",
        type: image.mimeType || "image/png",
        dataUrl: image.dataUrl,
        storageKey: image.storageKey,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
    };
}

function firstReference(result: BackendGenerationResult): ReferenceImage | null {
    const image = result.images?.[0];
    return image ? imageResultToReference(image) : null;
}

function failureMessage(reason: unknown): string {
    if (reason instanceof Error && reason.message) return reason.message;
    return "生成失败";
}

function collectFailures(settled: Array<PromiseSettledResult<BackendGenerationResult>>, offset = 0): AiModelPortraitFailure[] {
    const failures: AiModelPortraitFailure[] = [];
    settled.forEach((entry, index) => {
        if (entry.status === "rejected") failures.push({ index: index + offset, error: failureMessage(entry.reason) });
        else if (!firstReference(entry.value)) failures.push({ index: index + offset, error: "任务未返回图片" });
    });
    return failures;
}

function throwIfCancelled(settled: Array<PromiseSettledResult<BackendGenerationResult>>, signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    const cancelled = settled.find((entry): entry is PromiseRejectedResult => entry.status === "rejected" && isGenerationTaskCancelled(entry.reason, signal));
    throw cancelled ? cancelled.reason : new Error("生成已取消");
}

/**
 * 两阶段生成：先按属性生成一张母版锁定身份，再以母版为参考图派生剩余张数。
 * 模型不支持参考图时退化为互相独立的候选图，并在结果里如实标记 consistency。
 */
export async function generateAiModelPortraits(input: AiModelPortraitInput, runner: AiModelGenerationRunner = defaultRunner, dependencies?: GenerationTaskDependencies): Promise<AiModelPortraitResult> {
    const count = clampPortraitCount(input.count);
    const attributes = normalizeModelAttributes(input.attributes);
    // 每个任务只产出一张，张数完全由任务数决定，避免 config.count 再放大。
    const singleConfig: AiConfig = { ...input.config, count: "1" };

    // 两处母版请求共用同一段文本，顺带保证落库的 prompt 与真正发出去的一致。
    const anchorPrompt = buildModelAnchorPrompt(attributes, input.description);

    if (!supportsModelReference(input.config)) {
        input.onPhase?.({ phase: "anchoring" });
        const settled = await runner.runBatch(
            {
                mode: "image",
                prompt: anchorPrompt,
                config: singleConfig,
                count,
                signal: input.signal,
                metadata: { scene: "ai_model", portraitRole: "candidate" },
                onTaskUpdate: input.onTask,
            },
            dependencies,
        );
        throwIfCancelled(settled, input.signal);
        const portraits: AiModelPortrait[] = [];
        settled.forEach((entry) => {
            if (entry.status !== "fulfilled") return;
            const image = firstReference(entry.value);
            if (image) portraits.push({ id: image.id, role: "candidate", taskId: "", image, prompt: anchorPrompt });
        });
        const failed = collectFailures(settled);
        if (!portraits.length) throw new Error(failed[0]?.error || "生成失败");
        return { portraits, failed, consistency: "unverified" };
    }

    input.onPhase?.({ phase: "anchoring" });
    let anchorTaskId = "";
    const anchorResult = await runner.runTask(
        {
            mode: "image",
            prompt: anchorPrompt,
            config: singleConfig,
            signal: input.signal,
            metadata: { scene: "ai_model", portraitRole: "anchor" },
            onTaskUpdate: (task) => {
                anchorTaskId = task.id;
                input.onTask?.(task);
            },
        },
        dependencies,
    );
    const anchorImage = firstReference(anchorResult);
    if (!anchorImage) throw new Error("母版生成未返回图片");
    const anchor: AiModelPortrait = { id: anchorImage.id, role: "anchor", taskId: anchorTaskId, image: anchorImage, prompt: anchorPrompt };

    const derivingTotal = count - 1;
    // 派生与母版共用同一段 prompt 骨架，只替换「构图变体」行：第 2 张 B、第 3 张 C，更多张按 B、C 循环。
    const framings = Array.from({ length: derivingTotal }, (_, index) => deriveFraming(index));
    const derivedTaskIds: string[] = new Array(framings.length).fill("");
    let derivedDone = 0;
    // count=1 时根本没有派生任务，不能报出一个 0/0 的阶段：进度面板会据此显示"正在派生同一位模特"。
    if (framings.length) input.onPhase?.({ phase: "deriving", done: 0, total: framings.length });
    const settled = await Promise.allSettled(
        framings.map((framing, index) =>
            runner
                .runTask(
                    {
                        mode: "image",
                        prompt: buildModelVariantPrompt(attributes, { framing }, input.description),
                        config: singleConfig,
                        referenceImages: [anchor.image],
                        signal: input.signal,
                        metadata: { scene: "ai_model", portraitRole: "derive", portraitIndex: index },
                        onTaskUpdate: (task) => {
                            derivedTaskIds[index] = task.id;
                            input.onTask?.(task);
                        },
                    },
                    dependencies,
                )
                .then((result) => {
                    derivedDone += 1;
                    input.onPhase?.({ phase: "deriving", done: derivedDone, total: framings.length });
                    return result;
                }),
        ),
    );
    throwIfCancelled(settled, input.signal);

    const portraits: AiModelPortrait[] = [anchor];
    const failed: AiModelPortraitFailure[] = [];
    settled.forEach((entry, index) => {
        if (entry.status === "rejected") {
            failed.push({ index, error: failureMessage(entry.reason) });
            return;
        }
        const image = firstReference(entry.value);
        if (!image) {
            failed.push({ index, error: "任务未返回图片" });
            return;
        }
        // 纯函数按同一构图变体重算，拿到的就是该张图实际发出的派生 prompt。
        portraits.push({ id: image.id, role: "derive", taskId: derivedTaskIds[index], image, prompt: buildModelVariantPrompt(attributes, { framing: framings[index] }, input.description) });
    });
    return { portraits, failed, consistency: "referenced" };
}
