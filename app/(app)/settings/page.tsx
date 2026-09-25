import { SubmitButton } from "@/components/submit-button";
import { IconAlert, IconCheck, IconChevronDown, IconPlus, IconRefresh } from "@/components/icons";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { COUNTRIES, PLATFORMS, countryByCode } from "@/lib/countries";
import { fmtAgo, fmtDate, fmtInt } from "@/lib/format";
import {
  chooseRef, createAccount, deleteAccount, loadHistory, reprocess, resetDiscovery, syncNow, toggleAccount, updatePassword,
} from "./actions";

export const metadata = { title: "Cuentas" };
export const maxDuration = 300;

const platformName = (id: string) => PLATFORMS.find((p) => p.id === id)?.name ?? id;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ msg?: string; ok?: string }> }) {
  const { msg, ok } = await searchParams;
  const accounts = await listAccounts();

  return (
    <div className="page page-narrow">
      <PageHead
        title="Cuentas"
        sub="Cada cuenta (plataforma + país) se sincroniza sola cada 10 minutos."
        actions={accounts.length > 0 && <a className="btn" href="#nueva"><IconPlus /> Agregar cuenta</a>}
      />

      {msg && (
        <div className="banner" data-tone={ok === "1" ? "success" : "danger"} role="status">
          {ok === "1" ? <IconCheck /> : <IconAlert />}
          <span>{msg}</span>
        </div>
      )}

      {accounts.length > 0 && (
        <div className="accounts">
          {accounts.map((a) => {
            const available = a.debug?.available_accounts ?? [];
            const needsChoice = !a.platform_ref && available.length > 1;
            const tone = !a.enabled ? "neutral" : a.last_sync_ok === false ? "danger" : a.last_sync_ok ? "success" : "warning";
            return (
              <section key={a.id} className="panel account" aria-labelledby={`acc-${a.id}`}>
                <div className="account-top">
                  <div>
                    <h2 className="account-title" id={`acc-${a.id}`}>
                      {a.name}
                      {!a.enabled && <span className="pill">Pausada</span>}
                    </h2>
                    <p className="account-meta">
                      {platformName(a.platform)} · {countryByCode(a.country)?.name ?? a.country} · {a.currency}
                      {a.platform_ref_name && <> · cuenta <strong style={{ color: "var(--ink-2)", fontWeight: 550 }}>{a.platform_ref_name}</strong></>}
                      {" · "}{fmtInt(a.order_count)} órdenes
                    </p>
                  </div>
                  <div className="account-actions">
                    <form action={toggleAccount}>
                      <input type="hidden" name="id" value={a.id} />
                      <SubmitButton pending="…">{a.enabled ? "Pausar" : "Activar"}</SubmitButton>
                    </form>
                    <form action={syncNow}>
                      <input type="hidden" name="id" value={a.id} />
                      <SubmitButton className="btn btn-primary" disabled={!a.enabled} pending="Sincronizando…">
                        <IconRefresh /> Sincronizar
                      </SubmitButton>
                    </form>
                  </div>
                </div>

                <div className="account-status" data-tone={tone === "danger" ? "danger" : undefined}>
                  <span className="dot" data-tone={tone} aria-hidden />
                  <span>
                    {a.last_sync_at ? (
                      <>
                        <strong style={{ fontWeight: 550 }}>{a.last_sync_ok ? "Sincronizada" : "No se pudo sincronizar"}</strong>{" "}
                        <span title={fmtDate(a.last_sync_at, a.timezone)}>{fmtAgo(a.last_sync_at)}</span> — {a.last_sync_msg}
                      </>
                    ) : "Aún no se ha sincronizado."}
                    {a.backfill_cursor && <> · Cargando historial (va en {a.backfill_cursor.slice(0, 10)}).</>}
                  </span>
                </div>

                {(needsChoice || available.length > 1) && (
                  <form action={chooseRef} className="inline-form" style={{ marginTop: 12 }}>
                    <input type="hidden" name="id" value={a.id} />
                    <label className="field">
                      <span>{needsChoice ? "Este correo tiene varias cuentas. ¿Cuál es esta?" : "Cuenta dentro de este correo"}</span>
                      <select className="select" name="ref" defaultValue={a.platform_ref ?? ""} required>
                        <option value="" disabled>Elegir…</option>
                        {available.map((x) => <option key={x.ref} value={x.ref}>{x.name}</option>)}
                      </select>
                    </label>
                    <SubmitButton pending="Conectando…">Usar esta cuenta</SubmitButton>
                  </form>
                )}

                <details className="account-more">
                  <summary>Más opciones <IconChevronDown /></summary>
                  <div className="rows">
                    <form action={updatePassword} className="inline-form">
                      <input type="hidden" name="id" value={a.id} />
                      <label className="field">
                        <span>Correo de acceso</span>
                        <input className="input" name="email" type="email" defaultValue={a.login_email} autoComplete="off" />
                      </label>
                      <label className="field">
                        <span>Nueva contraseña</span>
                        <input className="input" name="password" type="password" autoComplete="new-password" placeholder="Sin cambios" />
                      </label>
                      <SubmitButton pending="Conectando…">Guardar acceso</SubmitButton>
                    </form>

                    <div className="inline-form" style={{ justifyContent: "space-between" }}>
                      <p className="muted" style={{ fontSize: "var(--t-sm)", flex: "1 1 260px" }}>
                        {a.backfill_cursor ? "El historial se está cargando por meses." : "Historial completo cargado."} Puedes volver a traerlo
                        si faltan órdenes antiguas.
                      </p>
                      <form action={loadHistory}>
                        <input type="hidden" name="id" value={a.id} />
                        <SubmitButton pending="Cargando…">Volver a cargar historial</SubmitButton>
                      </form>
                    </div>

                    <div className="inline-form" style={{ justifyContent: "space-between" }}>
                      <p className="muted" style={{ fontSize: "var(--t-sm)", flex: "1 1 260px" }}>
                        Ruta de órdenes detectada: <code>{a.orders_path ?? "sin detectar"}</code>
                      </p>
                      <form action={resetDiscovery}>
                        <input type="hidden" name="id" value={a.id} />
                        <SubmitButton pending="Detectando…">Volver a detectar</SubmitButton>
                      </form>
                    </div>

                    {a.debug?.probe ? (
                      <details className="raw" style={{ marginTop: 0 }}>
                        <summary>Diagnóstico técnico de la conexión</summary>
                        <pre>{JSON.stringify(a.debug.probe, null, 2)}</pre>
                      </details>
                    ) : null}

                    <form action={deleteAccount} className="inline-form">
                      <input type="hidden" name="id" value={a.id} />
                      <label className="field">
                        <span>Eliminar cuenta <span className="hint">Borra también sus {fmtInt(a.order_count)} órdenes. Escribe ELIMINAR para confirmar.</span></span>
                        <input className="input" name="confirm" autoComplete="off" placeholder="ELIMINAR" />
                      </label>
                      <SubmitButton className="btn btn-danger" pending="Eliminando…">Eliminar</SubmitButton>
                    </form>
                  </div>
                </details>
              </section>
            );
          })}
        </div>
      )}

      <section className="panel" id="nueva" style={{ scrollMarginTop: 24 }}>
        <div className="panel-head">
          <h2>{accounts.length ? "Agregar cuenta" : "Conecta tu primera cuenta"}</h2>
        </div>
        <form action={createAccount} className="panel-body">
          <div className="form-grid">
            <label className="field">
              <span>Plataforma</span>
              <select className="select" name="platform" defaultValue="soydrop">
                {PLATFORMS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.ready ? "" : " · próximamente"}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>País</span>
              <select className="select" name="country" defaultValue="HN">
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.currency})</option>)}
              </select>
            </label>
            <label className="field full">
              <span>Nombre <span className="hint">Opcional. Por defecto: plataforma + país, ej. “Drop Honduras”.</span></span>
              <input className="input" name="name" placeholder="Drop Honduras" />
            </label>
            <label className="field">
              <span>Correo de la plataforma</span>
              <input className="input" name="email" type="email" required autoComplete="off" />
            </label>
            <label className="field">
              <span>Contraseña de la plataforma</span>
              <input className="input" name="password" type="password" required autoComplete="new-password" />
            </label>
          </div>
          <div className="form-actions">
            <p>La contraseña se guarda cifrada (AES-256) y solo el servidor la usa para iniciar sesión. La primera sincronización puede tardar hasta un minuto.</p>
            <SubmitButton className="btn btn-primary" pending="Conectando con la plataforma…">Guardar y conectar</SubmitButton>
          </div>
        </form>
      </section>

      {accounts.length > 0 && (
        <section className="panel" style={{ marginTop: 20 }}>
          <div className="panel-head"><h2>Mantenimiento</h2></div>
          <div className="panel-body inline-form" style={{ justifyContent: "space-between" }}>
            <p className="muted" style={{ fontSize: "var(--t-sm)", flex: "1 1 320px" }}>
              Vuelve a leer todas las órdenes guardadas con el formato actual, sin descargarlas de nuevo. Úsalo tras una
              actualización del sistema si algún campo salía vacío.
            </p>
            <form action={reprocess}>
              <SubmitButton pending="Procesando…">Volver a leer órdenes</SubmitButton>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}
