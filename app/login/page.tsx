export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <form className="card login" method="post" action="/api/login">
      <h1>Miranova · Pedidos Drop</h1>
      <label htmlFor="password" className="sub">Contraseña del panel</label>
      <input id="password" name="password" type="password" autoFocus required />
      {error && <div className="error">Contraseña incorrecta</div>}
      <button className="btn primary" type="submit">Entrar</button>
    </form>
  );
}
