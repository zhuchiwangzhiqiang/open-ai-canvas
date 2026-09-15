import { App, Button, Input, Switch } from "antd";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { ModelPicker } from "@/components/model-picker";
import { DEFAULT_MODEL_ATTRIBUTES, isEmptyModelAttributes, type ModelAttributes, type ModelPreset } from "@/lib/design/model-attributes";
import { generateAiModelPortraits, supportsModelReference, type AiModelPhase, type AiModelPortraitResult } from "@/lib/design/model-portrait-pipeline";
import { generationErrorMessage } from "@/lib/generation-error";
import { modelCapabilityConfigFor, normalizeImageValue } from "@/lib/model-capabilities";
import { requestCreditCost } from "@/lib/model-pricing";
import { cn } from "@/lib/utils";
import { ModelAttributeForm } from "@/pages/ai-model/model-attribute-form";
import { ModelHistoryPanel } from "@/pages/ai-model/model-history-panel";
import { appendAiModelHistory, readAiModelHistory, type AiModelHistoryRecord } from "@/pages/ai-model/model-history-store";
import { ModelPresetCards } from "@/pages/ai-model/model-preset-cards";
import { ModelResultPanel } from "@/pages/ai-model/model-result-panel";
import { isGenerationTaskCancelled } from "@/services/api/generation-task";
import { modelOptionName, resolveModelChannel, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";

const PORTRAIT_COUNT = 3;

function SectionTitle({ index, title, hint }: { index: number; title: string; hint?: string }) {
    return (
        <div className="mb-2.5">
            <div className="flex items-center gap-2">
                {/* 圆环用 foreground 透明度而非 border token：--border 在暗色下是 #222，压在 --surface(#1f1f1f) 的卡片上几乎看不见。 */}
                {/* leading-none 让行盒等于字号，序号才会落在 size-4 圆环正中间。 */}
                <span className="grid size-4 shrink-0 place-items-center rounded-full border border-foreground/25 text-[length:var(--fs-micro)] leading-none text-foreground/62">{index}</span>
                <span className="text-[length:var(--fs-label)] font-semibold text-foreground">{title}</span>
                {hint ? <span className="text-[length:var(--fs-micro)] text-foreground/45">{hint}</span> : null}
            </div>
        </div>
    );
}

/** AI 模特工作台主体：/ai-model 与设计中心的「AI 模特」共用同一份实现。 */
export function AiModelWorkbench() {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const [selectedModel, setSelectedModel] = useState(config.imageModel || config.model);
    const [description, setDescription] = useState("");
    const [attributes, setAttributes] = useState<ModelAttributes>(DEFAULT_MODEL_ATTRIBUTES);
    const [presetId, setPresetId] = useState<string | undefined>(undefined);
    const [variation, setVariation] = useState(true);
    const [busy, setBusy] = useState(false);
    const [phase, setPhase] = useState<AiModelPhase | null>(null);
    const [result, setResult] = useState<AiModelPortraitResult | null>(null);
    const [error, setError] = useState("");
    const [tab, setTab] = useState<"result" | "history">("result");
    const [history, setHistory] = useState<AiModelHistoryRecord[]>([]);
    const [historyLoading, setHistoryLoading] = useState(true);
    const abortRef = useRef<AbortController | null>(null);

    // 模型渠道可能在挂载后才完成同步，这里只在空值时补一次默认值。
    useEffect(() => {
        if (!selectedModel) setSelectedModel(config.imageModel || config.model);
    }, [config.imageModel, config.model, selectedModel]);

    useEffect(() => {
        let cancelled = false;
        readAiModelHistory()
            .then((records) => {
                if (!cancelled) setHistory(records);
            })
            .catch(() => undefined)
            .finally(() => {
                if (!cancelled) setHistoryLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // 参考图能力决定这批图能不能锁成同一个人，因此按所选模型单独解析。
    const selectedConfig = useMemo<AiConfig>(() => ({ ...config, model: selectedModel, imageModel: selectedModel }), [config, selectedModel]);
    const imageProfile = useMemo(() => modelCapabilityConfigFor(selectedConfig, selectedModel).image!, [selectedConfig, selectedModel]);
    const referenceSupported = useMemo(() => supportsModelReference(selectedConfig), [selectedConfig]);
    const portraitCost = useMemo(() => {
        const channel = resolveModelChannel(selectedConfig, selectedModel);
        return requestCreditCost({ channelMode: selectedConfig.channelMode, modelCosts: channel.modelCosts, model: modelOptionName(selectedModel), count: PORTRAIT_COUNT, capability: "image", config: selectedConfig });
    }, [selectedConfig, selectedModel]);

    const applyPreset = (preset: ModelPreset) => {
        setAttributes(preset.attributes);
        setDescription(preset.description);
        setPresetId(preset.id);
    };

    const cancel = () => abortRef.current?.abort();

    const generate = async () => {
        if (!selectedModel) {
            message.warning("请先选择图片模型");
            return;
        }
        if (isEmptyModelAttributes(attributes) && !description.trim()) {
            message.warning("请填写描述，或至少选择一项模特属性");
            return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        setBusy(true);
        setError("");
        setResult(null);
        setPhase(null);
        setTab("result");
        try {
            // 尺寸/质量必须按所选模型的能力归一化，否则不支持的值会直接被上游拒绝。
            const normalized = normalizeImageValue(imageProfile, { size: config.size, quality: config.quality, count: String(PORTRAIT_COUNT) });
            const requestConfig: AiConfig = { ...selectedConfig, size: normalized.size, quality: normalized.quality, count: normalized.count };
            const generated = await generateAiModelPortraits({
                config: requestConfig,
                attributes,
                description,
                count: PORTRAIT_COUNT,
                variation,
                signal: controller.signal,
                onPhase: setPhase,
            });
            setResult(generated);
            void appendAiModelHistory({ model: selectedModel, description, attributes, consistency: generated.consistency, portraits: generated.portraits })
                .then(setHistory)
                .catch(() => undefined);
        } catch (thrown) {
            if (isGenerationTaskCancelled(thrown, controller.signal)) message.info("已取消生成");
            else setError(generationErrorMessage(thrown));
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
            setBusy(false);
            setPhase(null);
        }
    };

    return (
        /* xl 起两栏各自独立滚动：根容器撑满便要让行轨道也有确定高度，否则 auto 行会按内容撑高、栏内滚不起来。 */
        <div className="grid min-h-0 gap-4 xl:h-full xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)]">
            {/* 卡片内部再分两层：设置项在 xl 起自己滚动，生成操作固定在卡片底部不随表单滚走。 */}
            <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface" aria-label="AI 模特生成设置">
                {/* 卡片内顶部留白收窄一档，让「模型」更贴近卡片上沿。 */}
                <div className="hide-scrollbar space-y-5 px-4 pt-3 pb-4 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain">
                    <div>
                        <SectionTitle index={1} title="模型" hint="用户可选" />
                        <ModelPicker config={selectedConfig} value={selectedModel} onChange={setSelectedModel} capability="image" fullWidth showSelectedPrice showOptionPrices placeholder="选择图片模型" onMissingConfig={() => navigate("/settings")} />
                        {!referenceSupported ? <p className="mt-2 text-[length:var(--fs-micro)] leading-4 text-foreground/52">当前模型不支持参考图，这批图之间无法锁定为同一位模特。</p> : null}
                    </div>

                    <div>
                        <SectionTitle index={2} title="描述" hint="想要的模特 · 非必填" />
                        <Input.TextArea
                            value={description}
                            onChange={(event) => {
                                setDescription(event.target.value);
                                setPresetId(undefined);
                            }}
                            autoSize={{ minRows: 3, maxRows: 5 }}
                            maxLength={300}
                            disabled={busy}
                            placeholder="例如：清冷气质、短发、适合秋冬大衣；可留空，仅用下方属性生成"
                        />
                    </div>

                    <div>
                        <SectionTitle index={3} title="原型" hint="一键预填" />
                        <ModelPresetCards activeId={presetId} disabled={busy} onApply={applyPreset} />
                    </div>

                    <div>
                        <SectionTitle index={4} title="模特属性" />
                        <ModelAttributeForm
                            value={attributes}
                            disabled={busy}
                            onChange={(next) => {
                                setAttributes(next);
                                setPresetId(undefined);
                            }}
                        />
                    </div>

                    <label className="flex items-center justify-between gap-3 text-[length:var(--fs-label)] text-foreground/72">
                        <span>派生时自动变化姿势</span>
                        <Switch size="small" checked={variation} disabled={busy} onChange={setVariation} />
                    </label>
                </div>

                <div className="shrink-0 space-y-2 border-t border-border p-4">
                    <p className="text-[length:var(--fs-micro)] leading-4 text-foreground/52">生成的模特会进入历史记录，后续可在「AI 模特图」等能力中复用。</p>
                    <Button type="primary" size="large" block disabled={busy || !selectedModel} onClick={() => void generate()}>
                        {busy ? (
                            <span className="inline-flex items-center gap-1.5">
                                <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                                生成中…
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1.5">
                                <Sparkles className="size-4" />
                                生成 {PORTRAIT_COUNT} 张模特
                            </span>
                        )}
                    </Button>
                    {busy ? (
                        <Button block onClick={cancel}>
                            取消生成
                        </Button>
                    ) : null}
                    {portraitCost !== null && portraitCost !== undefined ? <p className="text-center text-[length:var(--fs-micro)] text-foreground/52">预计消耗 {portraitCost.toLocaleString("zh-CN", { maximumFractionDigits: 3 })} 积分</p> : null}
                </div>
            </section>

            <section className="flex min-h-0 min-w-0 flex-col" aria-label="AI 模特结果">
                {/* xl 起标签条由布局固定（不受栏内滚动影响）；xl 以下整页滚动时靠 sticky 贴在页头下方。 */}
                <div className="sticky top-0 z-[var(--z-toolbar)] flex shrink-0 items-center gap-1 border-b border-border bg-background" role="tablist" aria-label="AI 模特结果视图">
                    {(["result", "history"] as const).map((key) => (
                        <button
                            key={key}
                            type="button"
                            role="tab"
                            aria-selected={tab === key}
                            className={cn(
                                "-mb-px h-9 border-b-2 px-3 text-[length:var(--fs-label)] font-medium transition-colors motion-reduce:transition-none",
                                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1",
                                tab === key ? "border-primary text-foreground" : "border-transparent text-foreground/58 hover:text-foreground",
                            )}
                            onClick={() => setTab(key)}
                        >
                            {key === "result" ? "生成结果" : "历史记录"}
                        </button>
                    ))}
                </div>
                <div className="hide-scrollbar mt-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain">
                    {tab === "result" ? (
                        <ModelResultPanel result={result} phase={phase} error={error} busy={busy} count={PORTRAIT_COUNT} model={selectedModel} description={description} onRetry={() => void generate()} />
                    ) : (
                        <ModelHistoryPanel records={history} loading={historyLoading} />
                    )}
                </div>
            </section>
        </div>
    );
}

/** /ai-model 独立入口。与设计中心一样把页头留在滚动容器外；xl 起交给两栏各自滚动，外层不再滚。 */
export default function AiModelPage() {
    return (
        <WorkspacePage fluid scroll={false} className="ai-model-page">
            <div className="flex h-full min-h-0 flex-col">
                {/* 顶部留白由 .ai-model-page 里的页头规则统一控制（padding-top 归零）。 */}
                <div className="shrink-0 px-3 sm:px-4 xl:px-5">
                    <PageHeader title="AI 模特" description="生成可复用数字模特 · 一致出图" />
                </div>
                {/* 同样不自留 pt：顶部留白交给页头，表单卡片才能占满剩下的高度。 */}
                <div className="app-workspace-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 sm:px-4 sm:pb-4 xl:overflow-hidden xl:px-5">
                    <AiModelWorkbench />
                </div>
            </div>
        </WorkspacePage>
    );
}
