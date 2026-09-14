import { MODEL_PRESETS, type ModelPreset } from "@/lib/design/model-attributes";
import { cn } from "@/lib/utils";

export function ModelPresetCards({ activeId, onApply, disabled = false }: { activeId?: string; onApply: (preset: ModelPreset) => void; disabled?: boolean }) {
    return (
        <div className="grid gap-2 sm:grid-cols-2">
            {MODEL_PRESETS.map((preset) => {
                const active = preset.id === activeId;
                return (
                    <button
                        key={preset.id}
                        type="button"
                        disabled={disabled}
                        aria-pressed={active}
                        className={cn(
                            "rounded-md border p-2.5 text-left transition-colors motion-reduce:transition-none",
                            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1",
                            active ? "border-primary bg-primary/10" : "border-border bg-surface hover:bg-surface-hover",
                            disabled && "cursor-not-allowed opacity-50",
                        )}
                        onClick={() => onApply(preset)}
                    >
                        <div className="text-[var(--fs-label)] font-medium text-foreground">{preset.title}</div>
                        <div className="mt-1 text-[var(--fs-micro)] leading-4 text-foreground/52">{preset.summary}</div>
                    </button>
                );
            })}
        </div>
    );
}
