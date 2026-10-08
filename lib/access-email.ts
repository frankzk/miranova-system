// Correo con el acceso al panel (usuario + contraseña temporal) al crear un usuario o
// restablecer su contraseña. Puro, para probarlo; lo envían las acciones de Ajustes → Usuarios.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function accessEmail({ kind, name, username, password, loginUrl }: {
  kind: "new" | "reset";
  name: string;
  username: string;
  password: string;
  loginUrl: string;
}): { subject: string; html: string; text: string } {
  const first = name.trim().split(/\s+/)[0] || name;
  const subject = kind === "new" ? "Tu acceso al panel de Miranova" : "Tu nueva contraseña temporal de Miranova";
  const intro = kind === "new" ? "Ya tienes acceso al panel de Miranova." : "Se restableció tu contraseña del panel de Miranova.";
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0a2540">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="background:#ffffff;border:1px solid #e3e8ee;border-radius:10px;padding:24px">
<p style="margin:0 0 12px;font-size:15px">Hola ${esc(first)}:</p>
<p style="margin:0 0 16px;font-size:15px;color:#425466">${intro} Entra con estos datos:</p>
<table role="presentation" style="border-collapse:collapse;font-size:14px;margin:0 0 16px">
<tr><td style="padding:4px 16px 4px 0;color:#5f6b7a">Usuario</td><td style="padding:4px 0;font-weight:600">${esc(username)}</td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#5f6b7a">Contraseña temporal</td><td style="padding:4px 0;font-weight:600;font-family:ui-monospace,Menlo,Consolas,monospace">${esc(password)}</td></tr>
</table>
<p style="margin:0 0 20px;font-size:14px;color:#425466">Al entrar te pedirá elegir una contraseña nueva.</p>
<a href="${esc(loginUrl)}" style="display:inline-block;background:#635bff;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:8px">Entrar al panel</a>
</div>
<p style="margin:16px 0 0;font-size:12px;color:#8792a2">Si no esperabas este correo, avísale al dueño del panel.</p>
</div></body></html>`;
  const text = [
    `Hola ${first}:`,
    "",
    `${intro} Entra con estos datos:`,
    `Usuario: ${username}`,
    `Contraseña temporal: ${password}`,
    "",
    "Al entrar te pedirá elegir una contraseña nueva.",
    `Entrar al panel: ${loginUrl}`,
  ].join("\n");
  return { subject, html, text };
}
