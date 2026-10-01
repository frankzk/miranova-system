import "server-only";
import { db } from "./supabase";
import { memo } from "./memo";
import { readDeliveryPages, summarizeDeliveries, type DeliveryAccount } from "./delivery-rates";

export async function deliveryStats(accounts: DeliveryAccount[], from: Date, to: Date) {
  if (!accounts.length || from > to) return summarizeDeliveries([], accounts);
  const ids = accounts.map((a) => a.id).sort();
  // A moving "now" must not defeat the one-minute cache. Never cache individual customer data.
  const key = JSON.stringify(["delivery-rates", ids, from.toISOString(), Math.floor(to.getTime() / 60_000)]);
  return memo(key, 60_000, async () => {
    const signal = AbortSignal.timeout(25_000);
    const orders = await readDeliveryPages(async (after) => {
      let q = db().from("orders").select("id, account_id, carrier, status_code")
        .in("account_id", ids).gte("ordered_at", from.toISOString()).lte("ordered_at", to.toISOString())
        .order("id").limit(1000).abortSignal(signal);
      if (after) q = q.gt("id", after);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    });
    return summarizeDeliveries(orders, accounts);
  });
}
