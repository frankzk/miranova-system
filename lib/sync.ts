import "server-only";
import { getAccount, updateAccount, type Account } from "./accounts";
import { connectorFor, PlatformError, SessionExpired, type Session } from "./connectors";
import { SOYDROP_PAGE_SIZE } from "./connectors/soydrop";
import { decrypt, encrypt } from "./crypto";
import { db } from "./supabase";
import { extractOrders } from "./normalize";
import { ingestPayload } from "./store";

const FIRST_SYNC_PAGES = 40; // primera vez: traer historial reciente
const REGULAR_PAGES = 4; // luego: solo lo más nuevo

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

export async function syncAccount(accountId: string): Promise<SyncResult> {
  const acc = await getAccount(accountId);
  if (!acc) return { ok: false, message: "Cuenta no encontrada", saved: 0 };

  const c = connectorFor(acc.platform);
  const ctx = { id: acc.id, currency: acc.currency, timezone: acc.timezone };
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

    let path = acc.orders_path;
    if (!path) {
      const probe = await withSession(async (s) => {
        const r = await c.discoverOrdersPath(s);
        // si todas las rutas dieron 401/403, la sesión no sirve: forzar re-login una vez
        if (!r.path && r.attempts.every((a) => a.status === 401 || a.status === 403)) throw new SessionExpired();
        return r;
      });
      const fresh = (await getAccount(acc.id))!;
      await updateAccount(acc.id, { orders_path: probe.path, debug: { ...(fresh.debug ?? {}), probe: probe.attempts } });
      if (!probe.path) {
        throw new PlatformError(
          "Inicié sesión, pero aún no encuentro dónde entrega Drop las órdenes. Ya quedó el diagnóstico guardado para ajustarlo.",
        );
      }
      path = probe.path;
    }

    const maxPages = acc.last_sync_at ? REGULAR_PAGES : FIRST_SYNC_PAGES;
    for (let page = 1; page <= maxPages; page++) {
      const res = await withSession((s) => c.fetchOrders(s, path!, page));
      const found = extractOrders(res.payload).length;
      if (found === 0) break;
      saved += await ingestPayload(res.payload, "sync", res.url, ctx);
      if (found < SOYDROP_PAGE_SIZE) break;
    }

    const message = `${saved} pedidos actualizados`;
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
  for (const a of data) {
    if (a.platform !== "soydrop") continue; // Dropi: próximamente
    out[a.name] = await syncAccount(a.id);
  }
  return out;
}
