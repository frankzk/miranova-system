"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth";
import { cleanProfitProduct, type MarketInput } from "@/lib/profit";
import { marketAccounts } from "@/lib/profit-data";
import { db } from "@/lib/supabase";

// Rentabilidad: guardar y borrar fichas de costos, y vincular productos de la plataforma a una ficha.

export type ProfitFormState = { ok: boolean; msg: string } | null;

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (msg: string): ProfitFormState => ({ ok: false, msg });
const GONE = "Esa ficha ya no existe.";

function refresh() {
  revalidatePath("/profit");
  revalidatePath("/profit/costs");
}

/** Productos de la plataforma que ya están en otra ficha: "X (Drop Honduras) ya está en la ficha de Y". */
async function linkConflicts(links: { account_id: string; product_key: string }[], self: string | null, accountName: (id: string) => string): Promise<string | null> {
  if (!links.length) return null;
  const { data, error } = await db()
    .from("profit_links")
    .select("account_id, product_key, product_id")
    .in("product_key", links.map((l) => l.product_key));
  if (error) return `No se pudo revisar los productos vinculados: ${error.message}`;
  const taken = ((data ?? []) as { account_id: string; product_key: string; product_id: string }[])
    .filter((r) => r.product_id !== self && links.some((l) => l.account_id === r.account_id && l.product_key === r.product_key));
  if (!taken.length) return null;
  const { data: owners } = await db().from("profit_products").select("id, name").in("id", [...new Set(taken.map((t) => t.product_id))]);
  const owner = new Map(((owners ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));
  const t = taken[0];
  return `El producto elegido en ${accountName(t.account_id)} ya está en la ficha de ${owner.get(t.product_id) ?? "otro producto"}. Quítalo de esa ficha o elige otro.`;
}

/** Ficha nueva o editada: costos comunes, cada cuenta (traslado, precios, cantidad) y los productos vinculados. */
export async function saveProfitProduct(_prev: ProfitFormState, form: FormData): Promise<ProfitFormState> {
  const auth = await authorizeAction("profit");
  if (!auth.ok) return auth;
  const id = field(form, "id");
  if (id && !UUID.test(id)) return fail(GONE);
  const accounts = await marketAccounts();
  const markets: Record<string, MarketInput> = {};
  for (const a of accounts) {
    markets[a.id] = {
      carrier: field(form, `m_${a.id}_carrier`),
      transfer_cost: field(form, `m_${a.id}_transfer`),
      price_community: field(form, `m_${a.id}_pc`),
      price_users: field(form, `m_${a.id}_pu`),
      qty_in: field(form, `m_${a.id}_qty`),
    };
  }
  // el producto elegido en cada cuenta y los demás que se dejaron marcados, como "cuenta|product_key"
  const links = [
    ...accounts.map((a) => (field(form, `link_${a.id}`) ? `${a.id}|${field(form, `link_${a.id}`)}` : "")).filter(Boolean),
    ...form.getAll("links_extra").map(String),
  ];
  const c = cleanProfitProduct(
    {
      name: field(form, "name"),
      cost_currency: field(form, "cost_currency"),
      fx_gtq_per_usd: field(form, "fx_gtq_per_usd"),
      unit_cost: field(form, "unit_cost"),
      import_cost: field(form, "import_cost"),
      pickup_cost: field(form, "pickup_cost"),
      notes: field(form, "notes"),
      markets,
      links,
    },
    accounts,
  );
  if (!c.ok) return fail(c.msg);
  const nameOf = (aid: string) => accounts.find((a) => a.id === aid)?.name ?? "otra cuenta";
  const conflict = await linkConflicts(c.links, id || null, nameOf);
  if (conflict) return fail(conflict);

  const now = new Date().toISOString();
  let productId = id;
  if (id) {
    const { data, error } = await db().from("profit_products").update({ ...c.row, updated_at: now }).eq("id", id).select("id");
    if (error) return fail(error.code === "23505" ? `Ya hay una ficha llamada ${c.row.name}.` : `No se pudo guardar: ${error.message}`);
    if (!data?.length) return fail(GONE);
  } else {
    const { data, error } = await db().from("profit_products").insert({ ...c.row, created_by: auth.user.id, created_at: now, updated_at: now }).select("id").single();
    if (error) return fail(error.code === "23505" ? `Ya hay una ficha llamada ${c.row.name}: búscala en la lista y edítala.` : `No se pudo guardar: ${error.message}`);
    productId = (data as { id: string }).id;
  }

  // cuentas y vínculos: se reemplazan por lo del formulario
  const delM = await db().from("profit_markets").delete().eq("product_id", productId);
  if (delM.error) return fail(`No se pudo guardar las cuentas: ${delM.error.message}`);
  if (c.markets.length) {
    const { error } = await db().from("profit_markets").insert(c.markets.map((m) => ({ ...m, product_id: productId })));
    if (error) return fail(`No se pudo guardar las cuentas: ${error.message}`);
  }
  const delL = await db().from("profit_links").delete().eq("product_id", productId);
  if (delL.error) return fail(`No se pudo guardar los productos vinculados: ${delL.error.message}`);
  if (c.links.length) {
    const { error } = await db().from("profit_links").insert(c.links.map((l) => ({ ...l, product_id: productId, created_at: now })));
    if (error) return fail(error.code === "23505" ? "Uno de los productos elegidos se acaba de vincular a otra ficha. Vuelve a abrir la ficha." : `No se pudo guardar los productos vinculados: ${error.message}`);
  }
  refresh();
  const missingCost = c.row.unit_cost === null ? " Falta el costo: hasta cargarlo no entra en la utilidad." : "";
  return { ok: true, msg: `${id ? "Guardado" : `Ficha de ${c.row.name} creada`}.${missingCost}` };
}

export async function deleteProfitProduct(_prev: ProfitFormState, form: FormData): Promise<ProfitFormState> {
  const auth = await authorizeAction("profit");
  if (!auth.ok) return auth;
  const id = field(form, "id");
  if (!UUID.test(id)) return fail(GONE);
  const { error } = await db().from("profit_products").delete().eq("id", id);
  if (error) return fail(`No se pudo borrar: ${error.message}`);
  refresh();
  return { ok: true, msg: "Ficha borrada." };
}

/** Desde "Entregados sin ficha": este producto de la plataforma es el de una ficha que ya existe. */
export async function linkToProfitProduct(_prev: ProfitFormState, form: FormData): Promise<ProfitFormState> {
  const auth = await authorizeAction("profit");
  if (!auth.ok) return auth;
  const productId = field(form, "product_id");
  const account_id = field(form, "account_id");
  const product_key = field(form, "product_key");
  if (!UUID.test(productId)) return fail("Elige la ficha.");
  if (!UUID.test(account_id) || !product_key || product_key.length > 200) return fail("Ese producto ya no está.");
  const { data: p } = await db().from("profit_products").select("name").eq("id", productId).maybeSingle();
  if (!p) return fail(GONE);
  const { error } = await db().from("profit_links").insert({ account_id, product_key, product_id: productId, created_at: new Date().toISOString() });
  if (error) return fail(error.code === "23505" ? "Ese producto ya está en otra ficha." : `No se pudo vincular: ${error.message}`);
  refresh();
  return { ok: true, msg: `Vinculado a ${(p as { name: string }).name}.` };
}
