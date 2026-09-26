export type PlatformAccount = { ref: string; name: string };

/** Sesión serializable: se guarda cifrada y se reutiliza entre sincronizaciones. */
export type Session = { token?: string; cookie?: string; obtainedAt: number };

export type LoginResult = { identity: string; accounts: PlatformAccount[]; cookie?: string };

/** `rows`: filas crudas de la página (si difiere de las órdenes extraídas, p. ej. una fila por producto). */
export type OrdersPage = { url: string; payload: unknown; rows?: number };

export type DateRange = { from: Date; to: Date };

export type ProbeAttempt = { path: string; status: number; orders: number; sample: string };

export interface Connector {
  /** Tamaño de página de órdenes: una página más corta es la última. */
  pageSize?: number;
  /** Inicia sesión con correo y contraseña (y clave 2FA si la hay) y devuelve las cuentas disponibles. */
  login(email: string, password: string, opts?: { totpSecret?: string }): Promise<LoginResult>;
  /** Elige una cuenta dentro del login y devuelve la sesión para usar la API. */
  selectAccount(login: LoginResult, ref: string): Promise<Session>;
  /** Busca qué ruta de la API devuelve las órdenes (se guarda en la cuenta). */
  discoverOrdersPath(session: Session): Promise<{ path: string | null; attempts: ProbeAttempt[] }>;
  /** Descarga una página de órdenes (opcionalmente por rango de fechas de creación). Lanza SessionExpired si la sesión caducó. */
  fetchOrders(session: Session, path: string, page: number, range?: DateRange): Promise<OrdersPage>;
  /** Diccionario id → nombre de departamentos/ciudades (si la plataforma usa ids). */
  fetchGeo?(session: Session): Promise<Record<string, string> | null>;
  /** Busca la ruta del catálogo de productos del proveedor. */
  discoverProductsPath?(session: Session): Promise<{ path: string | null; attempts: ProbeAttempt[] }>;
  /** Descarga una página del catálogo de productos. */
  fetchProducts?(session: Session, path: string, page: number): Promise<OrdersPage>;
}

export class SessionExpired extends Error {
  constructor() {
    super("La sesión caducó");
  }
}

export class PlatformError extends Error {}
