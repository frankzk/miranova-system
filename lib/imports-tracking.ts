import "server-only";
import { TRACKED_STATUSES } from "./imports";
import { integrationKey } from "./integrations";
import { db } from "./supabase";
import { newEvents, type TrackInfo } from "./tracking17";
import { registerNumbers, trackNumbers } from "./tracking17-client";
import { isDhl } from "./tracking-dhl";
import { DHL_GAP_MS, dhlTrack } from "./tracking-dhl-client";

// Seguimiento automático de las guías: las de DHL con su API oficial (si hay clave de DHL) y las
// demás con 17TRACK (que registra la guía una vez). Cada pocas horas guarda el estado, la última
// novedad y la llegada estimada; las novedades nuevas van al historial.

const EVERY_MS = 3 * 3_600_000;
const PER_RUN = 40;
/** DHL gratis: una consulta cada 5 s, así que pocas por vuelta (las demás, en la siguiente) */
const DHL_PER_RUN = 6;

type Row = {
  id: string; carrier: string | null; tracking_number: string | null; status: string;
  track_registered: string | null; track_event_at: string | null; track_checked_at: string | null;
  /** ya revisada en esta vuelta (si después falla el servicio, no se le pisa el resultado) */
  done?: boolean;
};

export type TrackRun = { ok: true; checked: number; updated: number } | { ok: false; error: string };

/** Quién sigue esta guía: DHL directo (si es DHL y hay clave) o 17TRACK. */
export function trackingProvider(carrier: string | null, keys: { dhl: boolean; track17: boolean }): "dhl" | "track17" | null {
  if (keys.dhl && isDhl(carrier)) return "dhl";
  return keys.track17 ? "track17" : null;
}

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

async function viaDhl(rows: Row[], key: string, now: string): Promise<number> {
  let updated = 0;
  for (const [i, r] of rows.entries()) {
    if (i > 0 && DHL_GAP_MS) await new Promise((ok) => setTimeout(ok, DHL_GAP_MS));
    // guía nueva o cambiada: lo de antes ya no corresponde (DHL no necesita registrarla)
    if (r.track_registered !== r.tracking_number) {
      await db().from("imports").update({ ...RESET, track_registered: r.tracking_number, track_error: null }).eq("id", r.id);
      r.track_registered = r.tracking_number;
      r.track_event_at = null;
    }
    const res = await dhlTrack(r.tracking_number!, key);
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
  const [dhlKey, k17] = await Promise.all([integrationKey("dhl"), integrationKey("track17")]);
  if (!dhlKey && !k17) return { ok: false, error: "Falta la clave de seguimiento: DHL (gratis) o 17TRACK, en Ajustes → Integraciones." };
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

  const keys = { dhl: Boolean(dhlKey), track17: Boolean(k17) };
  const dhlRows = due.filter((r) => trackingProvider(r.carrier, keys) === "dhl").slice(0, DHL_PER_RUN);
  const rows17 = due.filter((r) => trackingProvider(r.carrier, keys) === "track17").slice(0, PER_RUN);
  if (!dhlRows.length && !rows17.length) {
    const carrier = due[0].carrier || "esta paquetera";
    return { ok: false, error: `Para guías de ${carrier} hace falta la clave de 17TRACK (la de DHL solo sirve para guías DHL).` };
  }
  const now = new Date().toISOString();
  let updated = 0;
  const errors: string[] = [];
  // cada servicio por su lado: si uno falla (clave mala, límite), el otro sigue
  for (const [rows, run] of [
    [dhlRows, () => viaDhl(dhlRows, dhlKey!, now)],
    [rows17, () => via17track(rows17, k17!, now)],
  ] as const) {
    if (!rows.length) continue;
    try {
      updated += await run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
      const pending = rows.filter((r) => !r.done).map((r) => r.id);
      if (pending.length) await db().from("imports").update({ track_error: msg, track_checked_at: now }).in("id", pending);
    }
  }
  if (errors.length) return { ok: false, error: errors.join(" · ") };
  return { ok: true, checked: dhlRows.length + rows17.length, updated };
}
