import { groupOf } from "./status.ts";

export type DeliveryOrder = { id: string; account_id: string | null; carrier: string | null; status_code: string | null };
export type DeliveryAccount = { id: string; country: string };
export type DeliveryCounts = {
  total: number; delivered: number; failed: number; cancelled: number;
  dispatch: number; transit: number; problem: number; unknown: number;
};
export type DeliveryRow = DeliveryCounts & { country: string; carrier: string };
export const emptyDeliveryCounts = (): DeliveryCounts => ({ total: 0, delivered: 0, failed: 0, cancelled: 0, dispatch: 0, transit: 0, problem: 0, unknown: 0 });

/** Only terminal delivery outcomes enter the default denominator. Unknown states never do. */
export function completedOrders(row: DeliveryCounts, includeCancelled = false): number {
  return row.delivered + row.failed + (includeCancelled ? row.cancelled : 0);
}
export function deliveryRate(row: DeliveryCounts, includeCancelled = false): number | null {
  const completed = completedOrders(row, includeCancelled);
  return completed ? row.delivered / completed : null;
}
/** Progress across every selected order, including open, cancelled and unknown states. */
export function totalDeliveryRate(row: DeliveryCounts): number | null {
  return row.total ? row.delivered / row.total : null;
}
export const openOrders = (row: DeliveryCounts) => row.dispatch + row.transit + row.problem;

export function summarizeDeliveries(orders: DeliveryOrder[], accounts: DeliveryAccount[]) {
  const countryByAccount = new Map(accounts.map((a) => [a.id, a.country]));
  const groups = new Map<string, DeliveryRow>();
  const total = emptyDeliveryCounts();
  for (const order of orders) {
    const country = countryByAccount.get(order.account_id ?? "");
    // The same account allowlist is enforced in the data query and the aggregation.
    if (!country) continue;
    const carrier = order.carrier?.trim() || "Sin transportadora";
    const key = JSON.stringify([country, carrier]);
    const row = groups.get(key) ?? { country, carrier, ...emptyDeliveryCounts() };
    const group = groupOf(order.status_code) ?? "unknown";
    row.total++; row[group]++;
    total.total++; total[group]++;
    groups.set(key, row);
  }
  // Volume, not apparent success on tiny samples, determines the initial order.
  const rows = [...groups.values()].sort((a, b) => a.country.localeCompare(b.country) || b.total - a.total || a.carrier.localeCompare(b.carrier));
  return { rows, total };
}

/** Keyset pagination: also works when the API caps a page below the requested limit. */
export async function readDeliveryPages(fetchPage: (after?: string) => Promise<DeliveryOrder[]>): Promise<DeliveryOrder[]> {
  const orders: DeliveryOrder[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    if (!page.length) return orders;
    const last = page[page.length - 1].id;
    if (cursor !== undefined && last <= cursor) throw new Error("La consulta de entregas no avanzó");
    orders.push(...page);
    cursor = last;
  }
}
