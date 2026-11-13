// Liquidaciones de Drop: lo que el proveedor pide retirar de su billetera y Drop (Boxful Technologies)
// le transfiere a Mercury. La API no es pública; por ahora se resume lo que devuelve la billetera
// ("/balance-movements") para ver dónde vienen las solicitudes de liquidación. Sin base de datos, para probarlo.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** La lista de movimientos de una página de la billetera (data.movements u otra lista conocida). */
export function movementList(json: unknown): Obj[] {
  const find = (node: unknown, depth: number): unknown[] | null => {
    if (Array.isArray(node)) return node;
    if (!isObj(node) || depth > 3) return null;
    for (const [k, v] of Object.entries(node)) if (/^(movements|items|results|docs|rows|records|data)$/i.test(k) && Array.isArray(v)) return v;
    for (const v of Object.values(node)) {
      const r = find(v, depth + 1);
      if (r) return r;
    }
    return null;
  };
  return (find(json, 0) ?? []).filter(isObj);
}

/** Nombre del tipo de movimiento ("settlement_credit", …). */
export function movementType(m: Obj): string {
  const t = m.requestType ?? m.type ?? m.kind;
  if (isObj(t)) return String(t.name ?? t.label ?? "sin_tipo");
  return typeof t === "string" && t ? t : "sin_tipo";
}

export type MovementSummary = {
  pages: number;
  total: number;
  /** Lo que acompaña a la lista (paginación, saldo), sin la lista. */
  meta: string;
  /** Por tipo: cuántos, su etiqueta y un ejemplo completo (recortado). */
  types: Record<string, { label: string; count: number; sample: string }>;
};

/** Resume las páginas de movimientos: qué tipos hay y un ejemplo de cada uno. */
export function summarizeMovements(pages: unknown[], sampleChars = 2500): MovementSummary {
  const types: MovementSummary["types"] = {};
  let total = 0;
  for (const page of pages) {
    for (const m of movementList(page)) {
      total++;
      const name = movementType(m);
      const t = m.requestType;
      const slot = (types[name] ??= { label: isObj(t) && typeof t.label === "string" ? t.label : "", count: 0, sample: JSON.stringify(m).slice(0, sampleChars) });
      slot.count++;
    }
  }
  const first = pages[0];
  const meta = (JSON.stringify(stripLists(first)) ?? "").slice(0, 1500);
  return { pages: pages.length, total, meta, types };
}

function stripLists(node: unknown, depth = 0): unknown {
  if (Array.isArray(node)) return `[${node.length}]`;
  if (!isObj(node) || depth > 3) return node;
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, stripLists(v, depth + 1)]));
}
