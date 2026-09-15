import { cn } from "@/lib/utils";

/**
 * 单选属性胶囊组：组内互斥，再次点击已选项可清空。
 * 这里表达的是"组内单选"，所以用 radiogroup 语义而不是 aria-pressed（后者属于持久开关）。
 */
export function AttributeChipGroup({ label, values, value, onChange, disabled = false, className }: { label: string; values: readonly string[]; value: string | undefined; onChange: (value: string) => void; disabled?: boolean; className?: string }) {
    return (
        <div className={cn("min-w-0", className)}>
            <div className="text-[length:var(--fs-label)] font-medium text-foreground/62">{label}</div>
            <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
                {values.map((item) => {
                    const selected = item === value;
                    return (
                        <button
                            key={item}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={disabled}
                            className={cn(
                                "h-7 shrink-0 rounded-md border px-2.5 text-[length:var(--fs-label)] transition-colors motion-reduce:transition-none",
                                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1",
                                selected ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-foreground/62 hover:bg-surface-hover",
                                disabled && "cursor-not-allowed opacity-50",
                            )}
                            onClick={() => onChange(selected ? "" : item)}
                        >
                            {item}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
