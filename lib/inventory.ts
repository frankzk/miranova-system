// Inventario: cuántos días alcanza cada producto al ritmo de salida actual y qué reponer.
// Datos de la función SQL `inventory_status` (movimientos de Drop + catálogo). Puro, para probarlo.

export type Restock = { at: string; units: number; reason: string };

export type InventoryRow = {
  account_id: string;
  account_name: string;
  external_id: string;
  code: string | null;
  name: string;
  status: string | null;
  image_url: string | null;
  stock: number;
  variants_count: number;
  /** unidades que salieron por pedido / volvieron por devolución */
  out14: number;
  ret14: number;
  out30: number;
  ret30: number;
  last_out_at: string | null;
  first_at: string | null;
  last_restock_at: string | null;
  restocks: Restock[];
  /** pedidos por despachar que llevan el producto */
  pending_orders: number;
  /** salida neta por día, últimos 30 días (el último es hoy) */
  daily: number[];
};

export type StockLevel = "out" | "critical" | "low" | "ok" | "idle";

export const STOCK_LEVEL: Record<StockLevel, { label: string; tone: string; hint: string }> = {
  out: { label: "Agotado", tone: "danger", hint: "Sin existencia y con salidas recientes o pedidos esperando" },
  critical: { label: "Reponer ya", tone: "danger", hint: "Alcanza para menos de 3 días" },
  low: { label: "Reponer pronto", tone: "warning", hint: "Alcanza para menos de 7 días" },
  ok: { label: "Suficiente", tone: "success", hint: "Alcanza para 7 días o más" },
  idle: { label: "Sin movimiento", tone: "neutral", hint: "Tiene existencia pero no salió nada en 14 días" },
};
export const LEVEL_ORDER: StockLevel[] = ["out", "critical", "low", "ok", "idle"];

export const INVENTORY_RULES = { critical: 3, low: 7, highReturns: 0.2, minForReturns: 20 };

/** Salida neta por día (salidas − devoluciones, promedio de 14 días). */
export const perDay = (r: Pick<InventoryRow, "out14" | "ret14">) => Math.max(0, r.out14 - r.ret14) / 14;

/** Días que alcanza la existencia al ritmo actual (null si no sale nada). */
export function daysLeft(r: Pick<InventoryRow, "stock" | "out14" | "ret14">): number | null {
  const d = perDay(r);
  if (d <= 0) return null;
  return Math.max(0, r.stock) / d;
}

export function stockLevel(r: InventoryRow): StockLevel {
  const d = perDay(r);
  if (r.stock <= 0) return d > 0 || r.pending_orders > 0 || r.out30 > 0 ? "out" : "idle";
  if (d <= 0) return "idle";
  const days = r.stock / d;
  if (days < INVENTORY_RULES.critical) return "critical";
  if (days < INVENTORY_RULES.low) return "low";
  return "ok";
}

/** Devoluciones sobre salidas en 30 días (null con poca muestra). */
export function returnRate(r: Pick<InventoryRow, "out30" | "ret30">): number | null {
  return r.out30 >= INVENTORY_RULES.minForReturns ? r.ret30 / r.out30 : null;
}

/** Unidades para cubrir `days` días al ritmo actual, descontando la existencia. */
export function toCover(r: InventoryRow, days = 30): number {
  return Math.max(0, Math.ceil(perDay(r) * days - Math.max(0, r.stock)));
}

/** Orden de "qué reponer": agotados con demanda primero, luego los que menos días tienen. */
export function reorderList(rows: InventoryRow[]): InventoryRow[] {
  const urgency = (r: InventoryRow) => {
    const l = stockLevel(r);
    if (l === "out") return -1_000_000 - perDay(r) * 100 - r.pending_orders;
    return daysLeft(r) ?? Infinity;
  };
  return rows.filter((r) => ["out", "critical", "low"].includes(stockLevel(r))).sort((a, b) => urgency(a) - urgency(b));
}

export type InventoryAlert = { kind: "stockout" | "low_stock" | "returns"; account_id: string; product_key: string; product_name: string; title: string; detail: string; action: string; priority: number };

/** Alertas para Oportunidades: agotados con demanda, por agotarse y devoluciones altas. */
export function inventoryAlerts(rows: InventoryRow[]): InventoryAlert[] {
  const out: InventoryAlert[] = [];
  for (const r of rows) {
    const l = stockLevel(r);
    const d = perDay(r);
    const base = { account_id: r.account_id, product_key: r.external_id, product_name: r.name };
    if (l === "out" && (d > 0 || r.pending_orders > 0)) {
      out.push({
        ...base, kind: "stockout",
        title: "Agotado con demanda",
        detail: `${d.toFixed(1)} u./día en 14 días${r.pending_orders ? ` · ${r.pending_orders} pedidos esperando despacho` : ""}${r.last_restock_at ? ` · última reposición ${r.last_restock_at.slice(0, 10)}` : ""}`,
        action: `reponer ya: unas ${toCover(r, 14)} u. para 14 días; mientras, avisar a las tiendas que lo venden`,
        priority: 100 + d,
      });
    } else if (l === "critical" || l === "low") {
      const days = daysLeft(r)!;
      out.push({
        ...base, kind: "low_stock",
        title: `Se agota en ${days < 1 ? "menos de 1 día" : `${Math.floor(days)} día${Math.floor(days) === 1 ? "" : "s"}`}`,
        detail: `${r.stock} u. en existencia · ${d.toFixed(1)} u./día netas`,
        action: `pedir reposición: unas ${toCover(r, 30)} u. para 30 días`,
        priority: 50 + (INVENTORY_RULES.low - days) * 5,
      });
    }
    const rr = returnRate(r);
    if (rr !== null && rr >= INVENTORY_RULES.highReturns) {
      out.push({
        ...base, kind: "returns",
        title: `Devoluciones altas: ${Math.round(rr * 100)}%`,
        detail: `${r.ret30} de ${r.out30} u. volvieron en 30 días`,
        action: "revisar confirmación de pedidos, promesa del anuncio y calidad del producto",
        priority: 20 + rr * 50,
      });
    }
  }
  return out.sort((a, b) => b.priority - a.priority);
}
