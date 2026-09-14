import { ATTRIBUTE_GROUPS, type ModelAttributes } from "@/lib/design/model-attributes";
import { AttributeChipGroup } from "@/components/ui/attribute-chip-group";

export function ModelAttributeForm({ value, onChange, disabled = false }: { value: ModelAttributes; onChange: (next: ModelAttributes) => void; disabled?: boolean }) {
    return (
        <div className="space-y-4">
            {ATTRIBUTE_GROUPS.map((group) => (
                <AttributeChipGroup
                    key={group.id}
                    label={group.label}
                    values={group.values}
                    value={value[group.id]}
                    disabled={disabled}
                    onChange={(selected) => {
                        const next: ModelAttributes = { ...value };
                        if (selected) next[group.id] = selected;
                        else delete next[group.id];
                        onChange(next);
                    }}
                />
            ))}
        </div>
    );
}
