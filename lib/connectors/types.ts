export type PlatformAccount = { ref: string; name: string };

/** Sesión serializable: se guarda cifrada y se reutiliza entre sincronizaciones. */
export type Session = { token?: string; cookie?: string; obtainedAt: number };

export type LoginResult = { identity: string; accounts: PlatformAccount[]; cookie?: string };

export type OrdersPage = { url: string; payload: unknown };

export type ProbeAttempt = { path: string; status: number; orders: number; sample: string };

export interface Connector {
  /** Inicia sesión con correo y contraseña y devuelve las cuentas disponibles. */
  login(email: string, password: string): Promise<LoginResult>;
  /** Elige una cuenta dentro del login y devuelve la sesión para usar la API. */
  selectAccount(login: LoginResult, ref: string): Promise<Session>;
  /** Busca qué ruta de la API devuelve las órdenes (se guarda en la cuenta). */
  discoverOrdersPath(session: Session): Promise<{ path: string | null; attempts: ProbeAttempt[] }>;
  /** Descarga una página de órdenes. Lanza SessionExpired si la sesión caducó. */
  fetchOrders(session: Session, path: string, page: number): Promise<OrdersPage>;
}

export class SessionExpired extends Error {
  constructor() {
    super("La sesión caducó");
  }
}

export class PlatformError extends Error {}
