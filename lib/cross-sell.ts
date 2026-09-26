// Matriz tienda × producto y venta cruzada. Datos de la función SQL `store_product_matrix`;
// aquí solo se arma la cuadrícula y se buscan oportunidades, para poder probarlo.
// También lo usa la pantalla de Oportunidades (crossSell).

export type MatrixStore = {
  account_id: string;
  store_id: string;
  name: string;
  /** Pedidos distintos en el período (un pedido con dos productos cuenta una vez). */
  orders: number;
  orders90: number;
  /** Productos distintos con pedidos en el período. */
  skus: number;
};
export type MatrixProduct = { account_id: string; product_key: string; name: string; orders: number; orders90: number; stores90: number };
export type MatrixCell = { account_id: string; store_id: string; product_key: string; n: number; n90: number };
export type MatrixData = {
  days: number;
  accounts: { account_id: string; account_name: string; currency: string }[];
  stores: MatrixStore[];
  products: MatrixProduct[];
  cells: MatrixCell[];
};

export const MATRIX_RULES = {
  maxStores: 30,
  maxProducts: 12,
  /** Producto dominante: al menos esta parte de los pedidos de la tienda. */
  dominant: 0.5,
  /** …y solo en tiendas con al menos estos pedidos (1 de 1 no es dominante). */
  dominantMin: 5,
  /** Tienda de volumen alto: pedidos por día en el período… */
  highPerDay: 1,
  /** …o de las primeras N de su cuenta, con al menos estos pedidos. */
  highTop: 5,
  highMinOrders: 10,
  /** Venta cruzada: tiendas que venden el mismo producto principal (sin contar la tienda)… */
  minPeers: 2,
  /** …y parte de ellas que también vende el sugerido. */
  minShare: 0.5,
  perStore: 2,
} as const;

const key = (...xs: string[]) => xs.join("|");

export type GridRow = { store: MatrixStore; cells: number[]; top: number | null; dominant: boolean };
export type Grid = { account_id: string; products: MatrixProduct[]; rows: GridRow[]; moreStores: number; moreProducts: number };

/** Cuadrícula de una cuenta: tiendas principales × productos principales del período. */
export function matrixGrid(data: MatrixData, accountId: string, opts: { stores?: number; products?: number } = {}): Grid {
  const maxS = opts.stores ?? MATRIX_RULES.maxStores;
  const maxP = opts.products ?? MATRIX_RULES.maxProducts;
  const allStores = data.stores.filter((s) => s.account_id === accountId && s.orders > 0).sort((a, b) => b.orders - a.orders);
  const allProducts = data.products.filter((p) => p.account_id === accountId && p.orders > 0).sort((a, b) => b.orders - a.orders);
  const stores = allStores.slice(0, maxS);
  const products = allProducts.slice(0, maxP);
  const mine = data.cells.filter((c) => c.account_id === accountId);
  const n = new Map(mine.map((c) => [key(c.store_id, c.product_key), c.n]));
  // producto principal de cada tienda, entre todos sus productos (no solo las columnas visibles)
  const best = new Map<string, MatrixCell>();
  for (const c of mine) if (c.n > (best.get(c.store_id)?.n ?? 0)) best.set(c.store_id, c);
  const rows = stores.map((store) => {
    const cells = products.map((p) => n.get(key(store.store_id, p.product_key)) ?? 0);
    const b = best.get(store.store_id);
    const top = b ? products.findIndex((p) => p.product_key === b.product_key) : -1;
    return { store, cells, top: top >= 0 ? top : null, dominant: !!b && store.orders >= MATRIX_RULES.dominantMin && b.n / store.orders >= MATRIX_RULES.dominant };
  });
  return { account_id: accountId, products, rows, moreStores: allStores.length - stores.length, moreProducts: allProducts.length - products.length };
}

export type CrossSellItem = {
  kind: "cross_sell" | "single_product";
  account_id: string;
  store_id: string;
  store_name: string;
  /** Producto sugerido (null si no hay uno claro). */
  product_key: string | null;
  product_name: string | null;
  /** Producto principal de la tienda. */
  anchor_key: string;
  anchor_name: string;
  title: string;
  detail: string;
  action: string;
  /** 0–100: más alto, más urgente. */
  priority: number;
};

const clamp = (x: number) => Math.round(Math.max(0, Math.min(100, x)));
const perDay = (n: number, days: number) => {
  const x = n / Math.max(1, days);
  return x >= 10 ? Math.round(x).toString() : x.toFixed(1);
};

/**
 * Venta cruzada para tiendas de volumen alto: productos que nunca vendieron (90 días) y que sí venden
 * la mayoría de las tiendas con su mismo producto principal. Además, tiendas que venden un solo producto
 * y mueven volumen ("ofrecer un segundo producto").
 */
export function crossSell(data: MatrixData): CrossSellItem[] {
  const R = MATRIX_RULES;
  const out: CrossSellItem[] = [];
  const productName = new Map(data.products.map((p) => [key(p.account_id, p.product_key), p.name]));
  const productOrders = new Map(data.products.map((p) => [key(p.account_id, p.product_key), p.orders90]));
  // productos vendidos en 90 días por tienda
  const sold = new Map<string, Map<string, MatrixCell>>();
  for (const c of data.cells) {
    if (c.n90 <= 0) continue;
    const k = key(c.account_id, c.store_id);
    if (!sold.has(k)) sold.set(k, new Map());
    sold.get(k)!.set(c.product_key, c);
  }

  for (const acc of new Set(data.stores.map((s) => s.account_id))) {
    const stores = data.stores.filter((s) => s.account_id === acc).sort((a, b) => b.orders - a.orders);
    const high = stores.filter((s, i) => s.orders >= R.highMinOrders && (s.orders / data.days >= R.highPerDay || i < R.highTop));
    for (const s of high) {
      const mine = sold.get(key(acc, s.store_id));
      if (!mine?.size) continue;
      // producto principal: el de más pedidos en el período (o en 90 días)
      const anchor = [...mine.values()].sort((a, b) => b.n - a.n || b.n90 - a.n90)[0];
      const anchorName = productName.get(key(acc, anchor.product_key)) ?? anchor.product_key;
      const peers = stores.filter((o) => o.store_id !== s.store_id && sold.get(key(acc, o.store_id))?.has(anchor.product_key));
      const candidates = new Map<string, number>();
      for (const o of peers) {
        for (const pk of sold.get(key(acc, o.store_id))!.keys()) if (!mine.has(pk)) candidates.set(pk, (candidates.get(pk) ?? 0) + 1);
      }
      const ranked = peers.length < R.minPeers ? [] : [...candidates]
        .filter(([, with_]) => with_ >= R.minPeers && with_ / peers.length >= R.minShare)
        .sort((a, b) => b[1] - a[1] || (productOrders.get(key(acc, b[0])) ?? 0) - (productOrders.get(key(acc, a[0])) ?? 0))
        .slice(0, R.perStore);
      const pace = perDay(s.orders, data.days);

      if (s.skus === 1 && s.orders / data.days >= R.highPerDay) {
        const best = ranked[0];
        // sin coincidencias entre tiendas: el producto con más pedidos de la cuenta que no vende
        const fallback = best ? null : data.products
          .filter((p) => p.account_id === acc && !mine.has(p.product_key) && p.orders90 > 0)
          .sort((a, b) => b.orders90 - a.orders90)[0];
        const pk = best?.[0] ?? fallback?.product_key ?? null;
        const pname = pk ? productName.get(key(acc, pk)) ?? pk : null;
        out.push({
          kind: "single_product", account_id: acc, store_id: s.store_id, store_name: s.name,
          product_key: pk, product_name: pname, anchor_key: anchor.product_key, anchor_name: anchorName,
          title: `📦 ${s.name} vende solo 1 producto y mueve ${pace} pedidos/día`,
          detail: `Todo su volumen depende de ${anchorName}`,
          action: pname ? `Ofrecer un segundo producto: ${pname}` : "Ofrecer un segundo producto del catálogo",
          priority: clamp(55 + Math.min(35, (s.orders / data.days) * 3)),
        });
      }
      for (const [pk, with_] of ranked) {
        const pname = productName.get(key(acc, pk)) ?? pk;
        out.push({
          kind: "cross_sell", account_id: acc, store_id: s.store_id, store_name: s.name,
          product_key: pk, product_name: pname, anchor_key: anchor.product_key, anchor_name: anchorName,
          title: `${s.name} vende mucho ${anchorName} pero nunca probó ${pname}`,
          detail: `${with_} de ${peers.length} tiendas que venden ${anchorName} también venden ${pname} · ${s.name} mueve ${pace} pedidos/día`,
          action: `Proponerle ${pname} con el creativo y la oferta de las tiendas que ya lo venden`,
          priority: clamp(40 + (with_ / peers.length) * 30 + Math.min(20, (s.orders / data.days) * 2)),
        });
      }
    }
  }
  return out.sort((a, b) => b.priority - a.priority);
}
