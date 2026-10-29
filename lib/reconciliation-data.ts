import "server-only";
import { db } from "./supabase";
import type {
  BankAudit,
  BankEntry,
  BankMatch,
  Company,
} from "./reconciliation";

// Paginar de verdad: el límite por defecto del API no debe ocultar pendientes.
async function allRows<T>(table: string, company: Company): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await db()
      .from(table)
      .select("*")
      .eq("company", company)
      .order("id")
      .range(start, start + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}

export async function bankData(company: Company) {
  const [entries, matches, auditResult, users] = await Promise.all([
    allRows<BankEntry>("bank_entries", company),
    allRows<BankMatch>("bank_matches", company),
    db()
      .from("bank_audit")
      .select("*")
      .eq("company", company)
      .order("created_at", { ascending: false })
      .limit(100),
    db().from("app_users").select("id,name"),
  ]);
  if (auditResult.error) throw auditResult.error;
  if (users.error) throw users.error;
  return {
    entries: entries
      .map((e) => ({
        ...e,
        amount_cents: Number(e.amount_cents),
        original_amount_cents: Number(e.original_amount_cents),
      }))
      .sort(
        (a, b) =>
          b.occurred_on.localeCompare(a.occurred_on) ||
          b.created_at.localeCompare(a.created_at),
      ),
    matches: matches
      .map((m) => ({ ...m, fee_cents: Number(m.fee_cents) }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    audit: (auditResult.data ?? []) as BankAudit[],
    names: Object.fromEntries(
      (users.data ?? []).map((u) => [u.id, u.name]),
    ) as Record<string, string>,
  };
}

export function bankError(error: { code?: string; message: string }): string {
  if (error.code === "23505")
    return "Ya existe esa referencia o PDF, o uno de los movimientos ya fue conciliado. Actualiza la página antes de intentarlo otra vez.";
  if (error.code === "42P01" || error.code === "PGRST205")
    return "Falta aplicar la migración de conciliación bancaria.";
  if (error.code === "P0001") return error.message;
  return "No se pudo guardar la operación. Actualiza la página e inténtalo de nuevo.";
}
