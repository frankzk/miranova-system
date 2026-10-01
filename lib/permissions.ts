// Permisos por usuario: una casilla por sección del panel. Sin base de datos ni Next, para
// usarlo en servidor, en componentes de cliente y en pruebas.

export const PERMISSIONS = [
  { key: "business", label: "Negocio", hint: "Comparación entre países, flujo de tiendas, operación y tasas de entrega" },
  { key: "orders", label: "Órdenes", hint: "Órdenes con datos del cliente, y el aviso de órdenes con problemas" },
  { key: "stores", label: "Tiendas", hint: "Salud de tiendas, ficha de cada tienda, contactos y seguimientos (solo ver)" },
  { key: "stores_edit", label: "Editar tiendas", hint: "Guardar contactos y grupos de WhatsApp, y registrar seguimientos" },
  { key: "products", label: "Productos", hint: "Catálogo, rendimiento, inventario y tienda × producto" },
  { key: "photos", label: "Fotos", hint: "Subir y borrar fotos y videos reales de productos (verlas y descargarlas va con Productos)" },
  { key: "opportunities", label: "Oportunidades", hint: "Lista de a quién contactar y qué proponerle" },
  { key: "money", label: "Dinero", hint: "Página Dinero y liquidaciones: lo pendiente de liquidar y lo ya liquidado" },
  { key: "export", label: "Exportar", hint: "Descargar órdenes y catálogo en CSV" },
  { key: "accounts", label: "Cuentas", hint: "Cuentas de Drop y Dropi: accesos, sincronización y mantenimiento" },
  { key: "users", label: "Usuarios", hint: "Crear usuarios, cambiar sus permisos y restablecer contraseñas" },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS: Permission[] = PERMISSIONS.map((p) => p.key);

export const isPermission = (v: unknown): v is Permission => typeof v === "string" && (PERMISSION_KEYS as string[]).includes(v);

export const permissionLabel = (p: Permission) => PERMISSIONS.find((x) => x.key === p)?.label ?? p;

/** Lo mínimo de un usuario para decidir qué puede hacer. */
export type Grantee = { is_owner: boolean; permissions: readonly string[] };

/** El dueño puede todo; los demás, lo que tengan marcado. */
export function can(u: Grantee | null | undefined, p: Permission): boolean {
  if (!u) return false;
  return u.is_owner || u.permissions.includes(p);
}

/** Permisos efectivos (el dueño los tiene todos), en el orden de PERMISSIONS. */
export function effectivePermissions(u: Grantee): Permission[] {
  return PERMISSION_KEYS.filter((p) => can(u, p));
}

/** Mapa de booleanos para pasar a componentes de cliente (sin exponer nada más del usuario). */
export type PermissionFlags = Record<Permission, boolean>;
export function permissionFlags(u: Grantee | null | undefined): PermissionFlags {
  return Object.fromEntries(PERMISSION_KEYS.map((p) => [p, can(u, p)])) as PermissionFlags;
}

/** Limpia una lista recibida de un formulario: solo claves conocidas, sin repetir, en orden. */
export function normalizePermissions(values: readonly unknown[]): Permission[] {
  const set = new Set(values.filter(isPermission));
  // editar tiendas sin poder verlas no tiene sentido
  if (set.has("stores_edit")) set.add("stores");
  // subir fotos sin ver productos tampoco
  if (set.has("photos")) set.add("products");
  return PERMISSION_KEYS.filter((p) => set.has(p));
}

/**
 * Quién puede otorgar qué: un usuario con permiso de Usuarios solo puede dar permisos que él
 * mismo tiene (el dueño, todos). Devuelve los que pidió y no puede otorgar.
 */
export function ungrantable(actor: Grantee, requested: readonly Permission[]): Permission[] {
  return requested.filter((p) => !can(actor, p));
}

/** Página de inicio de un usuario: Inicio es para todos. */
export const HOME = "/";

/** Usuario: minúsculas, números, punto, guion, guion bajo, "+" y "@" (sirve un correo); de 3 a 80. */
export const USERNAME_RE = /^[a-z0-9._+@-]{3,80}$/;
export const normalizeUsername = (s: string) => s.trim().toLowerCase();

export const MIN_PASSWORD = 8;

/** Reglas mínimas de contraseña; devuelve el problema o null si sirve. */
export function passwordProblem(pw: string, username?: string): string | null {
  if (pw.length < MIN_PASSWORD) return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
  if (pw.length > 200) return "La contraseña es demasiado larga.";
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return "La contraseña no puede contener el usuario.";
  if (/^(.)\1+$/.test(pw)) return "La contraseña no puede ser un mismo carácter repetido.";
  return null;
}

/** Ruta interna segura para volver después de entrar ("/..." pero no "//" ni "/\\"). */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\u0000-\u001f\\]/.test(next)) return fallback;
  if (next.startsWith("/api/") || next.startsWith("/login")) return fallback;
  return next.slice(0, 500);
}
