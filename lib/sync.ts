import "server-only";
import { getAccount, updateAccount, type Account } from "./accounts";
import { connectorFor, PlatformError, SessionExpired, type Session } from "./connectors";
import { SOYDROP_PAGE_SIZE, SOYDROP_PRODUCTS_PAGE_SIZE } from "./connectors/soydrop";
import { extractProducts } from "./products";
import { decrypt, encrypt } from "./crypto";
import { db } from "./supabase";
import { extractOrders } from "./normalize";
import { GROUPS } from "./status";
import { ingestPayload, saveProducts, type AccountCtx } from "./store";

const DAY = 86_400_000;
const RECENT_DAYS = 45; // cada sync revisa estas órdenes (para actualizar sus estados)
const WINDOW_DAYS = 30; // el historial se baja por ventanas de un mes
const HISTORY_LIMIT_DAYS = 548; // no ir más atrás de ~18 meses
const MAX_PAGES_PER_WINDOW = 60;
const MAX_PRODUCT_PAGES = 50;
const TIME_BUDGET_MS = 240_000; // la función tiene 300 s; dejamos margen
const GEO_MAX_AGE_MS = 7 * DAY;
const OPEN_REFRESH_EVERY_MS = 6 * 3_600_000; // pedidos abiertos fuera de la ventana reciente
const OPEN_REFRESH_MAX_DAYS = 120;

/** Estados que aún pueden cambiar (por despachar, en tránsito, con problemas). */
const OPEN_CODES = GROUPS.filter((g) => ["dispatch", "transit", "problem"].includes(g.id)).flatMap((g) => g.codes);

/** Pedido abierto más antiguo que ya quedó fuera de la ventana reciente (si lo hay). */
async function oldestStaleOpenOrder(accountId: string, before: Date, floor: Date): Promise<Date | null> {
  const { data, error } = await db()
    .from("orders")
    .select("ordered_at")
    .eq("account_id", accountId)
    .in("status_code", OPEN_CODES)
    .lt("ordered_at", before.toISOString())
    .gte("ordered_at", floor.toISOString())
    .order("ordered_at")
    .limit(1);
  if (error) throw error;
  return data[0]?.ordered_at ? new Date(data[0].ordered_at) : null;
}

/**
 * Inicia sesión y elige la cuenta. Si el correo tiene varias cuentas y aún no
 * se eligió una, guarda la lista para que el usuario la escoja en Ajustes.
 */
async function freshSession(acc: Account): Promise<Session> {
  const c = connectorFor(acc.platform);
  const login = await c.login(acc.login_email, decrypt(acc.password_enc));

  let ref = acc.platform_ref;
  const debug = { ...(acc.debug ?? {}), available_accounts: login.accounts };
  if (!ref) {
    if (login.accounts.length === 1) ref = login.accounts[0].ref;
    else {
      await updateAccount(acc.id, { debug });
      throw new PlatformError(
        login.accounts.length
          ? `Este correo tiene ${login.accounts.length} cuentas en la plataforma: elige cuál sincronizar.`
          : "La plataforma no devolvió ninguna cuenta para este correo.",
      );
    }
  }
  if (login.accounts.length && !login.accounts.some((a) => a.ref === ref)) {
    throw new PlatformError("La cuenta elegida ya no aparece en este login: vuelve a elegirla en Ajustes.");
  }

  const session = await c.selectAccount(login, ref);
  await updateAccount(acc.id, {
    platform_ref: ref,
    platform_ref_name: login.accounts.find((a) => a.ref === ref)?.name ?? acc.platform_ref_name,
    session_enc: encrypt(JSON.stringify(session)),
    debug,
  });
  return session;
}

async function loadSession(acc: Account): Promise<Session> {
  if (acc.session_enc) {
    try {
      return JSON.parse(decrypt(acc.session_enc)) as Session;
    } catch {
      /* sesión ilegible: iniciar de nuevo */
    }
  }
  return freshSession(acc);
}

export type SyncResult = { ok: boolean; message: string; saved: number };

export async function syncAccount(accountId: string, deadline = Date.now() + TIME_BUDGET_MS): Promise<SyncResult> {
  const acc = await getAccount(accountId);
  if (!acc) return { ok: false, message: "Cuenta no encontrada", saved: 0 };

  const c = connectorFor(acc.platform);
  let saved = 0;

  try {
    let session = await loadSession(acc);
    let relogged = false;

    const withSession = async <T>(fn: (s: Session) => Promise<T>): Promise<T> => {
      try {
        return await fn(session);
      } catch (e) {
        if (!(e instanceof SessionExpired) || relogged) throw e;
        relogged = true;
        session = await freshSession((await getAccount(acc.id))!);
        return fn(session);
      }
    };

    // 1. ruta de órdenes (se descubre una vez)
    let path = acc.orders_path;
    if (!path) {
      const probe = await withSession(async (s) => {
        const r = await c.discoverOrdersPath(s);
        if (!r.path && r.attempts.every((a) => a.status === 401 || a.status === 403)) throw new SessionExpired();
        return r;
      });
      const fresh = (await getAccount(acc.id))!;
      await updateAccount(acc.id, { orders_path: probe.path, debug: { ...(fresh.debug ?? {}), probe: probe.attempts } });
      if (!probe.path) {
        throw new PlatformError(
          "Inicié sesión, pero aún no encuentro dónde entrega la plataforma las órdenes. Ya quedó el diagnóstico guardado para ajustarlo.",
        );
      }
      path = probe.path;
    }

    // 2. nombres de departamentos/ciudades (se refrescan cada semana)
    let geo = acc.geo?.map ?? null;
    const geoAge = acc.geo?.at ? Date.now() - Date.parse(acc.geo.at) : Infinity;
    if (c.fetchGeo && (!geo || geoAge > GEO_MAX_AGE_MS)) {
      const fetched = await withSession((s) => c.fetchGeo!(s)).catch(() => null);
      if (fetched) {
        geo = fetched;
        await updateAccount(acc.id, { geo: { map: fetched, at: new Date().toISOString() } });
      }
    }

    const ctx: AccountCtx = { id: acc.id, currency: acc.currency, timezone: acc.timezone, geo };

    /** Baja todas las páginas de un rango de fechas. Devuelve cuántas órdenes había. */
    const syncRange = async (from: Date, to: Date): Promise<number> => {
      let count = 0;
      for (let page = 1; page <= MAX_PAGES_PER_WINDOW; page++) {
        const res = await withSession((s) => c.fetchOrders(s, path!, page, { from, to }));
        const found = extractOrders(res.payload).length;
        if (found === 0) break;
        count += found;
        saved += await ingestPayload(res.payload, "sync", res.url, ctx);
        if (found < SOYDROP_PAGE_SIZE) break;
      }
      return count;
    };

    // 3. órdenes recientes: nuevas + cambios de estado
    const now = new Date();
    const recentFrom = new Date(now.getTime() - RECENT_DAYS * DAY);
    await syncRange(recentFrom, new Date(now.getTime() + DAY));

    // 3a. pedidos abiertos más antiguos que la ventana reciente: sin esto su estado
    // (y su liquidación) quedaría congelado. Se revisan cada pocas horas.
    const lastOpenRefresh = acc.open_refresh_at ? Date.parse(acc.open_refresh_at) : 0;
    if (now.getTime() - lastOpenRefresh > OPEN_REFRESH_EVERY_MS) {
      const oldest = await oldestStaleOpenOrder(acc.id, recentFrom, new Date(now.getTime() - OPEN_REFRESH_MAX_DAYS * DAY));
      if (oldest) await syncRange(new Date(oldest.getTime() - 60_000), recentFrom);
      await updateAccount(acc.id, { open_refresh_at: new Date().toISOString() });
    }

    // 3b. catálogo de productos (todas las páginas). Un fallo aquí no detiene las órdenes.
    let productsNote = "";
    if (c.fetchProducts && c.discoverProductsPath) {
      try {
        let ppath = acc.products_path;
        if (!ppath) {
          const probe = await withSession((s) => c.discoverProductsPath!(s));
          const fresh = (await getAccount(acc.id))!;
          await updateAccount(acc.id, { products_path: probe.path, debug: { ...(fresh.debug ?? {}), products_probe: probe.attempts } });
          if (!probe.path) throw new PlatformError("no encontré la ruta del catálogo");
          ppath = probe.path;
        }
        let total = 0;
        for (let page = 1; page <= MAX_PRODUCT_PAGES; page++) {
          const res = await withSession((s) => c.fetchProducts!(s, ppath!, page));
          const items = extractProducts(res.payload);
          if (items.length === 0) break;
          total += await saveProducts(acc.id, acc.currency, items);
          if (items.length < SOYDROP_PRODUCTS_PAGE_SIZE) break;
        }
        productsNote = ` · ${total} productos`;
        await updateAccount(acc.id, { products_sync_at: new Date().toISOString(), products_sync_msg: `${total} productos actualizados` });
      } catch (e) {
        if (e instanceof SessionExpired) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        productsNote = " · productos: error";
        await updateAccount(acc.id, { products_sync_msg: `No se pudo sincronizar el catálogo: ${msg}` });
      }
    }

    // 4. historial, hacia atrás por meses, retomando donde quedó la vez anterior
    let cursor = acc.backfill_cursor ? new Date(acc.backfill_cursor) : null;
    let emptyWindows = 0;
    const floor = now.getTime() - HISTORY_LIMIT_DAYS * DAY;
    while (cursor && Date.now() < deadline) {
      const from = new Date(cursor.getTime() - WINDOW_DAYS * DAY);
      const n = await syncRange(from, cursor);
      emptyWindows = n === 0 ? emptyWindows + 1 : 0;
      cursor = emptyWindows >= 2 || from.getTime() <= floor ? null : from;
      await updateAccount(acc.id, { backfill_cursor: cursor?.toISOString() ?? null });
    }

    const message = cursor
      ? `${saved} pedidos actualizados${productsNote} · cargando historial (hasta ${cursor.toISOString().slice(0, 10)}), continúa en la próxima sincronización`
      : `${saved} pedidos actualizados${productsNote}`;
    await updateAccount(acc.id, { last_sync_at: new Date().toISOString(), last_sync_ok: true, last_sync_msg: message });
    return { ok: true, message, saved };
  } catch (e) {
    const message = e instanceof PlatformError || e instanceof SessionExpired
      ? e.message
      : `Error inesperado: ${e instanceof Error ? e.message : String(e)}`;
    console.error(`sync ${acc.name}`, e);
    await updateAccount(acc.id, { last_sync_at: new Date().toISOString(), last_sync_ok: false, last_sync_msg: message });
    return { ok: false, message, saved };
  }
}

export async function syncAll(): Promise<Record<string, SyncResult>> {
  const { data, error } = await db().from("accounts").select("id, name, platform").eq("enabled", true);
  if (error) throw error;
  const out: Record<string, SyncResult> = {};
  const deadline = Date.now() + TIME_BUDGET_MS; // un solo presupuesto para todas las cuentas
  for (const a of data) {
    if (a.platform !== "soydrop") continue; // Dropi: próximamente
    out[a.name] = await syncAccount(a.id, deadline);
  }
  return out;
}
