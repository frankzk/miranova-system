import { IconAlert } from "@/components/icons";

export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden>M</span>
          <span className="brand-name">Miranova</span>
        </div>
        <h1>Entrar al panel</h1>
        <p>Órdenes, despachos y dinero de todas tus cuentas.</p>
        <form method="post" action="/api/login">
          <label className="field">
            <span>Contraseña</span>
            <input
              className="input"
              id="password"
              name="password"
              type="password"
              autoFocus
              required
              autoComplete="current-password"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
            />
          </label>
          {error && (
            <div className="form-error" id="login-error" role="alert">
              <IconAlert /> Contraseña incorrecta. Inténtalo de nuevo.
            </div>
          )}
          <button className="btn btn-primary" type="submit">Entrar</button>
        </form>
      </div>
    </main>
  );
}
