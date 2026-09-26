// Tipos del registro de simulaciones para desarrollo local (MIRANOVA_FIXTURES=1).
/* eslint-disable @typescript-eslint/no-explicit-any */

export type Row = Record<string, any>;

/** Datos sintéticos compartidos (ver lib/dev-fixtures.ts). */
export type FixtureCtx = {
  ORDERS: Row[];
  ACCOUNTS: Row[];
  CATALOG: Row[];
  DAY: number;
  /** Grupo operativo del estado (dispatch, transit, delivered, problem, failed, cancelled). */
  groupOf: (code: string | null | undefined) => string | null;
  /** ID de tienda como en order_facts/line_facts: aquí siempre "name:<dropshipper>". */
  storeId: (o: Row) => string;
  /** Clave de producto como en line_facts (product_key): aquí "name:<nombre>". */
  productKey: (item: Row) => string;
  /** Fecha local YYYY-MM-DD de un instante en la zona de la cuenta. */
  localDay: (iso: string, tz: string) => string;
};

/** Cada módulo simula sus funciones RPC y, si hace falta, tablas propias en memoria. */
export type FixtureModule = {
  rpc?: Record<string, (args: Row, ctx: FixtureCtx) => unknown>;
  tables?: Record<string, Row[]>;
};
