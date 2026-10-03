import { AutoSelect } from "./client";
import type { FilterOption } from "./column-filter";

/** Select con etiqueta que aplica el filtro al cambiar (panel "Filtros"). */
export function FilterSelect({ name, label, value, all, options }: { name: string; label: string; value?: string; all: string; options: FilterOption[] }) {
  return (
    <label className="field">
      <span>{label}</span>
      <AutoSelect name={name} defaultValue={value ?? ""}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}{o.count !== undefined ? ` (${o.count.toLocaleString("en-US")})` : ""}</option>
        ))}
      </AutoSelect>
    </label>
  );
}
