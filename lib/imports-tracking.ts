import "server-only";
import { integrationKey } from "./integrations";
import { db } from "./supabase";
import { newEvents } from "./tracking17";
import { registerNumbers, trackNumbers } from "./tracking17-client";

// Seguimiento automático de las guías con 17TRACK: registra la guía una vez y, cada pocas horas,
// guarda el estado, la última novedad y la llegada estimada; las novedades nuevas van al historial.

/** Desde que está lista para enviar hasta que llega a la bodega. */
const TRACKED = ["ready", "transit", "customs", "released", "to_warehouse"];
const EVERY_MS = 3 * 3_600_000;
const PER_RUN = 40;

type Row = {
  id: string; carrier: string | null; tracking_number: string | null; status: string;
  track_registered: string | null; track_event_at: string | null; track_checked_at: string | null;
};

export type TrackRun = { ok: true; checked: number; updated: number } | { ok: false; error: string };

export async function refreshTracking({ ids, force = false }: { ids?: string[]; force?: boolean } = {}): Promise<TrackRun> {
  const key = await integrationKey("track17");
  if (!key) return { ok: false, error: "Falta la clave de 17TRACK (Ajustes → Integraciones)." };
  let q = db()
    .from("imports")
    .select("id, carrier, tracking_number, status, track_registered, track_event_at, track_checked_at")
    .in("status", TRACKED);
  if (ids?.length) q = q.in("id", ids);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  const due = ((data ?? []) as Row[])
    .filter((r) => r.tracking_number && (force || !r.track_checked_at || Date.now() - Date.parse(r.track_checked_at) > EVERY_MS))
    .sort((a, b) => (a.track_checked_at ?? "").localeCompare(b.track_checked_at ?? ""))
    .slice(0, PER_RUN);
  if (!due.length) return { ok: true, checked: 0, updated: 0 };
  const now = new Date().toISOString();

  try {
    // 1. registrar las guías nuevas (o cambiadas): lo de antes ya no corresponde
    const toRegister = due.filter((r) => r.track_registered !== r.tracking_number);
    if (toRegister.length) {
      const reg = await registerNumbers(toRegister.map((r) => r.tracking_number!), key);
      for (const r of toRegister) {
        const failed = reg.failed.find((f) => f.number === r.tracking_number);
        const patch = failed
          ? { track_registered: null, track_status: null, track_sub_status: null, track_event: null, track_event_at: null, track_eta: null, track_error: failed.message, track_checked_at: now }
          : { track_registered: r.tracking_number, track_status: null, track_sub_status: null, track_event: null, track_event_at: null, track_eta: null, track_error: null };
        await db().from("imports").update(patch).eq("id", r.id);
        r.track_registered = failed ? null : r.tracking_number;
        r.track_event_at = null;
      }
    }
    // 2. leer el estado de las registradas
    const ready = due.filter((r) => r.track_registered === r.tracking_number);
    if (!ready.length) return { ok: true, checked: due.length, updated: 0 };
    const res = await trackNumbers(ready.map((r) => r.tracking_number!), key);
    let updated = 0;
    for (const r of ready) {
      const info = res.accepted.find((a) => a.number === r.tracking_number);
      if (!info) {
        const rej = res.rejected.find((x) => x.number === r.tracking_number);
        await db().from("imports").update({ track_error: rej?.message ?? "17TRACK todavía no tiene información de esta guía.", track_checked_at: now }).eq("id", r.id);
        continue;
      }
      const fresh = newEvents(info, r.track_event_at);
      for (const e of fresh) {
        await db().from("import_events").insert({
          import_id: r.id, status: null, by_user: null, at: e.at,
          note: `${r.carrier ?? "Paquetera"}: ${e.text}${e.location ? ` (${e.location})` : ""}`,
        });
      }
      await db().from("imports").update({
        track_status: info.status, track_sub_status: info.subStatus,
        track_event: info.latest ? `${info.latest.text}${info.latest.location ? ` · ${info.latest.location}` : ""}` : null,
        track_event_at: info.latest?.at ?? r.track_event_at, track_eta: info.eta, track_checked_at: now, track_error: null,
      }).eq("id", r.id);
      if (fresh.length) updated++;
    }
    return { ok: true, checked: due.length, updated };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db().from("imports").update({ track_error: msg, track_checked_at: now }).in("id", due.map((r) => r.id));
    return { ok: false, error: msg };
  }
}
