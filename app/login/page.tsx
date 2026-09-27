import { redirect } from "next/navigation";
import { IconAlert } from "@/components/icons";
import { currentUser, safeNext } from "@/lib/auth";

export const metadata = { title: "Entrar" };
export const dynamic = "force-dynamic";

type SP = Promise<{ error?: string; u?: string; m?: string; next?: string }>;

const LOGIN_ERRORS: Record<string, (m?: string) => string> = {
  invalid: () => "Usuario o contraseña incorrectos.",
  locked: (m) => `Demasiados intentos fallidos. Espera ${m ?? "15"} minutos e inténtalo de nuevo.`,
};


export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  if (await currentUser()) redirect(safeNext(sp.next));
  return <Login sp={sp} />;
}

function Card({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden>M</span>
          <span className="brand-name">Miranova</span>
        </div>
        <h1>{title}</h1>
        <p>{sub}</p>
        {children}
      </div>
    </main>
  );
}

function ErrorLine({ id, text }: { id: string; text: string }) {
  return (
    <div className="form-error" id={id} role="alert">
      <IconAlert /> {text}
    </div>
  );
}

function Login({ sp }: { sp: Awaited<SP> }) {
  const error = sp.error && LOGIN_ERRORS[sp.error] ? LOGIN_ERRORS[sp.error](sp.m?.replace(/\D/g, "").slice(0, 3)) : null;
  return (
    <Card title="Entrar al panel" sub="Órdenes, tiendas y productos de todas tus cuentas.">
      <form method="post" action="/api/login">
        <input type="hidden" name="next" value={safeNext(sp.next)} />
        <label className="field">
          <span>Usuario</span>
          <input
            className="input"
            id="username"
            name="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            defaultValue={sp.u?.slice(0, 80) ?? ""}
            autoFocus={!sp.u}
            required
          />
        </label>
        <label className="field">
          <span>Contraseña</span>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            autoFocus={!!sp.u}
            required
            autoComplete="current-password"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
          />
        </label>
        {error && <ErrorLine id="login-error" text={error} />}
        <button className="btn btn-primary" type="submit">Entrar</button>
      </form>
      <p className="auth-foot">Los usuarios los crea el dueño dentro del panel, en Ajustes → Usuarios. ¿Olvidaste tu contraseña? Pídele que la restablezca.</p>
    </Card>
  );
}

