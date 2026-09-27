import { redirect } from "next/navigation";
import { IconAlert } from "@/components/icons";
import { currentUser, safeNext } from "@/lib/auth";
import { MIN_PASSWORD } from "@/lib/permissions";
import { userCount } from "@/lib/users";

export const metadata = { title: "Entrar" };
export const dynamic = "force-dynamic";

type SP = Promise<{ error?: string; u?: string; m?: string; next?: string; setup?: string }>;

const LOGIN_ERRORS: Record<string, (m?: string) => string> = {
  invalid: () => "Usuario o contraseña incorrectos.",
  locked: (m) => `Demasiados intentos fallidos. Espera ${m ?? "15"} minutos e inténtalo de nuevo.`,
};

const SETUP_ERRORS: Record<string, string> = {
  panel: "La contraseña actual del panel no es correcta.",
  username: "El usuario debe tener de 3 a 80 caracteres: letras minúsculas, números, punto, guion, guion bajo o un correo.",
  name: "Escribe tu nombre.",
  weak: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres y no contener el usuario.`,
  mismatch: "Las contraseñas no coinciden.",
  exists: "No se pudo crear el usuario. Inténtalo de nuevo.",
};

export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  if (await currentUser()) redirect(safeNext(sp.next));
  const setup = (await userCount()) === 0;
  return setup ? <Setup error={sp.error} /> : <Login sp={sp} />;
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
      <p className="auth-foot">¿Olvidaste tu contraseña? Pídele al dueño que la restablezca desde Usuarios.</p>
    </Card>
  );
}

function Setup({ error }: { error?: string }) {
  const msg = error ? SETUP_ERRORS[error] : null;
  return (
    <Card
      title="Crear el usuario del dueño"
      sub="El panel ahora usa un usuario y una contraseña para cada persona. Crea el tuyo con la contraseña actual del panel; después podrás crear los demás desde Usuarios."
    >
      <form method="post" action="/api/setup">
        <label className="field">
          <span>Contraseña actual del panel</span>
          <input className="input" name="panel_password" type="password" required autoComplete="off" autoFocus />
        </label>
        <label className="field">
          <span>Tu nombre</span>
          <input className="input" name="name" required maxLength={80} autoComplete="name" />
        </label>
        <label className="field">
          <span>Usuario <span className="hint">para entrar, sin espacios (puede ser tu correo)</span></span>
          <input className="input" name="username" required pattern="[a-z0-9._+@\-]{3,80}" autoCapitalize="none" spellCheck={false} autoComplete="username" placeholder="ej. frank o tu correo" />
        </label>
        <label className="field">
          <span>Nueva contraseña <span className="hint">mínimo {MIN_PASSWORD} caracteres</span></span>
          <input className="input" name="password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" />
        </label>
        <label className="field">
          <span>Repite la contraseña</span>
          <input className="input" name="confirm" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" />
        </label>
        {msg && <ErrorLine id="setup-error" text={msg} />}
        <button className="btn btn-primary" type="submit">Crear y entrar</button>
      </form>
    </Card>
  );
}
