"use server";

import { authorizeAction } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { productStores, type ProductStores } from "@/lib/queries";
import { storeHref } from "@/lib/store-links";
import { db } from "@/lib/supabase";

// Productos → Catálogo: al abrir "Vendido", las tiendas que venden el producto.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_STORE_DAYS = [7, 30, 90] as const;

export type ProductStoresResult =
  | { ok: true; days: number; data: ProductStores; hrefs: Record<string, string> | null }
  | { ok: false; msg: string };

export async function loadProductStores(productId: string, days: number): Promise<ProductStoresResult> {
  const auth = await authorizeAction("products");
  if (!auth.ok) return { ok: false, msg: auth.msg };
  if (!UUID.test(productId)) return { ok: false, msg: "Ese producto ya no existe." };
  const d = (PRODUCT_STORE_DAYS as readonly number[]).includes(days) ? days : 30;
  const { data: p, error } = await db().from("products").select("account_id, external_id, sku, name").eq("id", productId).maybeSingle();
  if (error) return { ok: false, msg: `No se pudo leer el producto: ${error.message}` };
  if (!p) return { ok: false, msg: "Ese producto ya no existe." };
  const prod = p as { account_id: string; external_id: string; sku: string | null; name: string };
  try {
    const data = await productStores(prod, d);
    // la ficha de la tienda solo para quien puede ver Tiendas
    const hrefs = can(auth.user, "stores") ? Object.fromEntries(data.stores.map((s) => [s.store_id, storeHref(prod.account_id, s.store_id)])) : null;
    return { ok: true, days: d, data, hrefs };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : "No se pudieron leer las tiendas." };
  }
}
