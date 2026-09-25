import Link from "next/link";
import { requireLogin } from "@/lib/auth";
import { listAccounts } from "@/lib/accounts";
import { COUNTRIES, PLATFORMS, countryByCode } from "@/lib/countries";
import { fmtDate } from "@/lib/format";
import { chooseRef, createAccount, deleteAccount, resetDiscovery, syncNow, toggleAccount, updatePassword } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const platformName = (id: string) => PLATFORMS.find((p) => p.id === id)?.name ?? id;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; ok?: string }>;
}) {
  await requireLogin();
  const { msg, ok } = await searchParams;
  const accounts = await listAccounts();

  return (
    <main className="wrap" style={{ maxWidth: 980 }}>
      <div className="top">
        <div>
          <h1>Ajustes · Cuentas</h1>
          <div className="sub">Cada cuenta (plataforma + país) se sincroniza sola cada 10 minutos.</div>
        </div>
        <Link className="btn" href="/">← Pedidos</Link>
      </div>

      {msg && <div className={ok === "1" ? "notice" : "notice error-box"}>{msg}</div>}

      <section className="card" style={{ marginBottom: 16 }}>
        {accounts.length === 0 ? (
          <div className="empty">Aún no hay cuentas. Agrega la primera abajo.</div>
        ) : (
          accounts.map((a) => {
            const available = a.debug?.available_accounts ?? [];
            const needsChoice = !a.platform_ref && available.length > 1;
            return (
              <div key={a.id} className="account">
                <div className="account-head">
                  <div>
                    <strong>{a.name}</strong>{" "}
                    <span className="chip">{platformName(a.platform)}</span>{" "}
                    <span className="chip">{countryByCode(a.country)?.name ?? a.country} · {a.currency}</span>{" "}
                    {!a.enabled && <span className="chip pending">Pausada</span>}
                    <div className="small">
                      {a.login_email}
                      {a.platform_ref_name && <> · cuenta: <strong>{a.platform_ref_name}</strong></>}
                      {" · "}{a.order_count} pedidos
                    </div>
                  </div>
                  <div className="row-actions">
                    <form action={syncNow}>
                      <input type="hidden" name="id" value={a.id} />
                      <button className="btn primary" type="submit" disabled={!a.enabled}>Sincronizar ahora</button>
                    </form>
                    <form action={toggleAccount}>
                      <input type="hidden" name="id" value={a.id} />
                      <button className="btn" type="submit">{a.enabled ? "Pausar" : "Activar"}</button>
                    </form>
                  </div>
                </div>

                <div className={`status ${a.last_sync_ok === false ? "bad" : a.last_sync_ok ? "good" : ""}`}>
                  {a.last_sync_at
                    ? <>{a.last_sync_ok ? "✓" : "✗"} {fmtDate(a.last_sync_at)} — {a.last_sync_msg}</>
                    : "Sin sincronizar todavía"}
                </div>

                {(needsChoice || available.length > 1) && (
                  <form action={chooseRef} className="inline-form">
                    <input type="hidden" name="id" value={a.id} />
                    <label>
                      {needsChoice ? "Este correo tiene varias cuentas. ¿Cuál es esta?" : "Cuenta dentro de este correo"}
                      <select name="ref" defaultValue={a.platform_ref ?? ""} required>
                        <option value="" disabled>Elegir…</option>
                        {available.map((x) => <option key={x.ref} value={x.ref}>{x.name}</option>)}
                      </select>
                    </label>
                    <button className="btn" type="submit">Usar esta cuenta</button>
                  </form>
                )}

                <details>
                  <summary>Más opciones</summary>
                  <form action={updatePassword} className="inline-form">
                    <input type="hidden" name="id" value={a.id} />
                    <label>Correo<input name="email" type="email" defaultValue={a.login_email} /></label>
                    <label>Nueva contraseña<input name="password" type="password" autoComplete="new-password" placeholder="(sin cambios)" /></label>
                    <button className="btn" type="submit">Guardar acceso</button>
                  </form>
                  <form action={resetDiscovery} className="inline-form">
                    <input type="hidden" name="id" value={a.id} />
                    <span className="small">Ruta de órdenes: <code>{a.orders_path ?? "sin descubrir"}</code></span>
                    <button className="btn" type="submit">Volver a detectar</button>
                  </form>
                  {a.debug?.probe ? (
                    <details className="raw" style={{ padding: 0 }}>
                      <summary className="small">Diagnóstico técnico</summary>
                      <pre>{JSON.stringify(a.debug.probe, null, 2)}</pre>
                    </details>
                  ) : null}
                  <form action={deleteAccount} className="inline-form">
                    <input type="hidden" name="id" value={a.id} />
                    <label>Escribe ELIMINAR para borrar la cuenta y sus pedidos<input name="confirm" autoComplete="off" /></label>
                    <button className="btn danger" type="submit">Eliminar</button>
                  </form>
                </details>
              </div>
            );
          })
        )}
      </section>

      <section className="card" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>Agregar cuenta</h2>
        <form action={createAccount} className="grid-form">
          <label>
            Plataforma
            <select name="platform" defaultValue="soydrop">
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.ready ? "" : " (próximamente)"}</option>
              ))}
            </select>
          </label>
          <label>
            País
            <select name="country" defaultValue="HN">
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.currency})</option>)}
            </select>
          </label>
          <label>
            Nombre (opcional)
            <input name="name" placeholder="Ej. Drop Honduras" />
          </label>
          <label>
            Correo de la plataforma
            <input name="email" type="email" required autoComplete="off" />
          </label>
          <label>
            Contraseña de la plataforma
            <input name="password" type="password" required autoComplete="new-password" />
          </label>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button className="btn primary" type="submit">Guardar y conectar</button>
          </div>
        </form>
        <p className="small" style={{ marginTop: 12 }}>
          La contraseña se guarda cifrada (AES-256) y solo el servidor puede descifrarla para iniciar sesión en la
          plataforma. Al guardar se hace la primera sincronización, puede tardar hasta un minuto.
        </p>
      </section>
    </main>
  );
}
