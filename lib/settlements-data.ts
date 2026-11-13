import "server-only";
import { db } from "./supabase";
import type { Company } from "./reconciliation";
import type { Settlement } from "./settlements";

export type SettlementExempt = { id: string; entry_id: string; reason: string; created_by: string; created_at: string };
export type SettlementSource = { id: string; name: string; settlements_sync_at: string | null; settlements_msg: string | null };

const FIELDS =
  "id,company,source,account_id,external_id,reference,confirmation,operation,country,requested_at,requested_on,status,status_label," +
  "failure_reason,currency,amount_cents,usd_rate,usd_amount_cents,bank,bank_account,evidence,boxful_id,linked_by,linked_at," +
  "reviewed_by,reviewed_at,review_note,shipments:raw->shipments_count";

const missing = (e: { code?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "42703");

// Paginar de verdad (como bankData): el tope del API no debe esconder liquidaciones viejas con su PDF.
async function allSettlements(company: Company): Promise<{ data: unknown[] | null; error: { code?: string; message: string } | null }> {
  const rows: unknown[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await db()
      .from("settlements")
      .select(FIELDS)
      .eq("company", company)
      .order("requested_at", { ascending: false })
      .order("id")
      .range(start, start + 999);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) return { data: rows, error: null };
  }
}

/** Liquidaciones de la empresa (las más nuevas primero), comprobantes marcados "no es liquidación" y las cuentas que las traen. */
export async function settlementData(company: Company): Promise<{
  settlements: Settlement[];
  exempt: SettlementExempt[];
  sources: SettlementSource[];
  ready: boolean;
}> {
  const [s, ex, acc] = await Promise.all([
    allSettlements(company),
    db().from("settlement_exempt_entries").select("id,entry_id,reason,created_by,created_at").eq("company", company).is("revoked_at", null),
    db().from("accounts").select("id,name,settlements_sync_at,settlements_msg").in("platform", ["soydrop", "boxful"]).eq("catalog_only", false).eq("enabled", true).order("name"),
  ]);
  // sin la migración todavía: la conciliación de siempre sigue funcionando
  if (missing(s.error) || missing(ex.error)) return { settlements: [], exempt: [], sources: [], ready: false };
  if (s.error) throw s.error;
  if (ex.error) throw ex.error;
  const settlements = ((s.data ?? []) as unknown as Settlement[]).map((r) => ({
    ...r,
    amount_cents: Number(r.amount_cents),
    usd_rate: r.usd_rate === null ? null : Number(r.usd_rate),
    usd_amount_cents: r.usd_amount_cents === null ? null : Number(r.usd_amount_cents),
    evidence: Array.isArray(r.evidence) ? r.evidence.filter((u): u is string => typeof u === "string") : [],
    shipments: typeof r.shipments === "number" ? r.shipments : null,
  }));
  return {
    settlements,
    exempt: (ex.data ?? []) as SettlementExempt[],
    sources: missing(acc.error) ? [] : ((acc.data ?? []) as SettlementSource[]),
    ready: true,
  };
}
