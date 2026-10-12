import "server-only";
import { available, carrierOf, carrierTracker, CARRIERS_OFFICIAL, PROVIDER_LABEL, trackingKeys, trackingProvider, type CarrierResult, type Provider } from "./carrier-tracking";
import { TRACKED_STATUSES } from "./imports";
import { db } from "./supabase";
import { newEvents, type TrackInfo } from "./tracking17";
import { registerNumbers, trackNumbers } from "./tracking17-client";

// Seguimiento automático de las guías: las de DHL, FedEx y UPS con la API oficial de cada una (si
// hay clave) y las demás con 17TRACK (que registra la guía una vez). Cada pocas horas guarda el
// estado, la última novedad y la llegada estimada; las novedades nuevas van al historial.

const EVERY_MS = 3 * 3_600_000;
const PER_RUN = 40;
/** DHL gratis: una consulta cada 5 s, así que pocas por vuelta (las demás, en la siguiente) */
const PER_RUN_OF: Record<Provider, number> = { dhl: 6, fedex: 20, ups: 20, track17: PER_RUN };

type Row = {
  id: string; carrier: string | null; tracking_number: string | null; status: string;
  track_registered: string | null; track_event_at: string | null; track_checked_at: string | null;
  /** ya revisada en esta vuelta (si después falla el servicio, no se le pisa el resultado) */
  done?: boolean;
};

export type TrackRun = { ok: true; checked: number; updated: number } | { ok: false; error: string };

const RESET = { track_status: null, track_sub_status: null, track_event: null, track_event_at: null, track_eta: null };

/** Guarda lo que dijo la paquetera y pasa al historial las novedades nuevas. true si hubo novedades. */
async function save(r: Row, info: TrackInfo, now: string): Promise<boolean> {
  const fresh = newEvents(info, r.track_event_at);
  for (const e of fresh) {
    await db().from("import_events").insert({
      import_id: r.id, status: null, by_user: null, at: e.at, kind: "tracking",
      note: `${r.carrier ?? "Paquetera"}: ${e.text}${e.location ? ` (${e.location})` : ""}`,
    });
  }
  await db().from("imports").update({
    track_status: info.status, track_sub_status: info.subStatus,
    track_event: info.latest ? `${info.latest.text}${info.latest.location ? ` · ${info.latest.location}` : ""}` : null,
    track_event_at: info.latest?.at ?? r.track_event_at, track_eta: info.eta, track_checked_at: now, track_error: null,
  }).eq("id", r.id);
  r.done = true;
  return fresh.length > 0;
}

/** DHL, FedEx o UPS: una consulta por guía (sin registrarla antes). */
async function viaCarrier(rows: Row[], tracker: { track: (n: string) => Promise<CarrierResult>; gapMs: number }, now: string): Promise<number> {
  let updated = 0;
  for (const [i, r] of rows.entries()) {
    if (i > 0 && tracker.gapMs) await new Promise((ok) => setTimeout(ok, tracker.gapMs));
    // guía nueva o cambiada: lo de antes ya no corresponde
    if (r.track_registered !== r.tracking_number) {
      await db().from("imports").update({ ...RESET, track_registered: r.tracking_number, track_error: null }).eq("id", r.id);
      r.track_registered = r.tracking_number;
      r.track_event_at = null;
    }
    const res = await tracker.track(r.tracking_number!);
    if (!res.found) {
      await db().from("imports").update({ track_error: res.message, track_checked_at: now }).eq("id", r.id);
      r.done = true;
      continue;
    }
    if (await save(r, res.info, now)) updated++;
  }
  return updated;
}

async function via17track(rows: Row[], key: string, now: string): Promise<number> {
  // 1. registrar las guías nuevas (o cambiadas): lo de antes ya no corresponde
  const toRegister = rows.filter((r) => r.track_registered !== r.tracking_number);
  if (toRegister.length) {
    const reg = await registerNumbers(toRegister.map((r) => r.tracking_number!), key);
    for (const r of toRegister) {
      const failed = reg.failed.find((f) => f.number === r.tracking_number);
      const patch = failed
        ? { ...RESET, track_registered: null, track_error: failed.message, track_checked_at: now }
        : { ...RESET, track_registered: r.tracking_number, track_error: null };
      await db().from("imports").update(patch).eq("id", r.id);
      r.track_registered = failed ? null : r.tracking_number;
      r.track_event_at = null;
    }
  }
  // 2. leer el estado de las registradas
  const ready = rows.filter((r) => r.track_registered === r.tracking_number);
  if (!ready.length) return 0;
  const res = await trackNumbers(ready.map((r) => r.tracking_number!), key);
  let updated = 0;
  for (const r of ready) {
    const info = res.accepted.find((a) => a.number === r.tracking_number);
    if (!info) {
      const rej = res.rejected.find((x) => x.number === r.tracking_number);
      await db().from("imports").update({ track_error: rej?.message ?? "17TRACK todavía no tiene información de esta guía.", track_checked_at: now }).eq("id", r.id);
      r.done = true;
      continue;
    }
    if (await save(r, info, now)) updated++;
  }
  return updated;
}

export async function refreshTracking({ ids, force = false }: { ids?: string[]; force?: boolean } = {}): Promise<TrackRun> {
  const keys = await trackingKeys();
  const has = available(keys);
  if (!Object.values(has).some(Boolean)) {
    return { ok: false, error: "Falta la clave de seguimiento: DHL, FedEx o UPS (gratis) o 17TRACK, en Ajustes → Integraciones." };
  }
  let q = db()
    .from("imports")
    .select("id, carrier, tracking_number, status, track_registered, track_event_at, track_checked_at")
    .in("status", TRACKED_STATUSES);
  if (ids?.length) q = q.in("id", ids);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  const due = ((data ?? []) as Row[])
    .filter((r) => r.tracking_number && (force || !r.track_checked_at || Date.now() - Date.parse(r.track_checked_at) > EVERY_MS))
    .sort((a, b) => (a.track_checked_at ?? "").localeCompare(b.track_checked_at ?? ""));
  if (!due.length) return { ok: true, checked: 0, updated: 0 };

  const groups = new Map<Provider, Row[]>();
  for (const r of due) {
    const p = trackingProvider(r.carrier, has);
    if (p && (groups.get(p)?.length ?? 0) < PER_RUN_OF[p]) groups.set(p, [...(groups.get(p) ?? []), r]);
  }
  if (!groups.size) {
    const c = carrierOf(due[0].carrier);
    const who = c ? PROVIDER_LABEL[c] : due[0].carrier || "esta paquetera";
    return { ok: false, error: c ? `Para guías de ${who} falta la clave de ${who} (gratis) o la de 17TRACK, en Ajustes → Integraciones.` : `Para guías de ${who} hace falta la clave de 17TRACK.` };
  }
  const now = new Date().toISOString();
  let updated = 0;
  let checked = 0;
  const errors: string[] = [];
  // cada servicio por su lado: si uno falla (clave mala, límite), los otros siguen
  for (const p of [...CARRIERS_OFFICIAL, "track17"] as Provider[]) {
    const rows = groups.get(p);
    if (!rows?.length) continue;
    checked += rows.length;
    try {
      updated += p === "track17" ? await via17track(rows, keys.track17!, now) : await viaCarrier(rows, carrierTracker(p, keys), now);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
      const pending = rows.filter((r) => !r.done).map((r) => r.id);
      if (pending.length) await db().from("imports").update({ track_error: msg, track_checked_at: now }).in("id", pending);
    }
  }
  if (errors.length) return { ok: false, error: errors.join(" · ") };
  return { ok: true, checked, updated };
}
