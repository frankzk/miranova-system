"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadProductStores, type ProductStoresResult } from "@/app/(app)/products/store-actions";
import { SideSheet } from "./side-sheet";

const DAYS = [7, 30, 90];
const fmt = (n: number) => n.toLocaleString("es");

function ago(iso: string) {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (d <= 0) return "hoy";
  if (d === 1) return "ayer";
  return `hace ${d} días`;
}

/**
 * "Vendido" de un producto del catálogo: las unidades y en cuántas tiendas; al tocarlo, un panel con
 * esas tiendas (unidades, pedidos, parte de la venta y última venta), en 7, 30 o 90 días.
 */
export function ProductStores({ productId, name, units, stores, sub, compact }: {
  productId: string;
  name: string;
  units: number;
  stores: number | null;
  /** cuenta y código, para el encabezado del panel */
  sub?: string;
  /** versión corta para el teléfono (dentro de la celda del producto) */
  compact?: boolean;
}) {
  const label = stores ? `${stores} ${stores === 1 ? "tienda" : "tiendas"}` : null;
  return (
    <SideSheet
      triggerClass={compact ? "ps-trigger ps-compact" : "ps-trigger"}
      triggerLabel={`Ver qué tiendas venden ${name}`}
      trigger={
        compact ? (
          <>{fmt(units)} u. vendidas{label && <> · {label}</>}</>
        ) : (
          <>
            <span className="ps-units">{fmt(units)} u.</span>
            {label && <span className="ps-stores">{label}</span>}
          </>
        )
      }
      title={name}
      sub={sub ? `Tiendas que lo venden · ${sub}` : "Tiendas que lo venden"}
    >
      <Panel productId={productId} />
    </SideSheet>
  );
}

function Panel({ productId }: { productId: string }) {
  const [days, setDays] = useState(30);
  const [res, setRes] = useState<ProductStoresResult | null>(null);

  useEffect(() => {
    let alive = true;
    setRes(null);
    loadProductStores(productId, days)
      .then((r) => alive && setRes(r))
      .catch(() => alive && setRes({ ok: false, msg: "No se pudieron leer las tiendas. Inténtalo de nuevo." }));
    return () => {
      alive = false;
    };
  }, [productId, days]);

  return (
    <div className="ps-panel">
      <div className="segmented" role="group" aria-label="Período">
        {DAYS.map((d) => (
          <button key={d} type="button" aria-pressed={d === days} data-on={d === days || undefined} onClick={() => setDays(d)}>
            {d} días
          </button>
        ))}
      </div>
      {!res ? (
        <p className="muted ps-loading" role="status">Buscando las tiendas…</p>
      ) : !res.ok ? (
        <p className="im-msg" data-ok="false" role="alert">{res.msg}</p>
      ) : res.data.stores.length === 0 ? (
        <div className="ps-empty">
          <p>Ninguna tienda lo vendió en los últimos {res.days} días.</p>
          {res.days < 90 && <button type="button" className="btn btn-sm" onClick={() => setDays(90)}>Ver 90 días</button>}
        </div>
      ) : (
        <>
          <p className="ps-summary">
            <b>{fmt(res.data.units)} u.</b> en {fmt(res.data.orders)} {res.data.orders === 1 ? "pedido" : "pedidos"} ·{" "}
            <b>{res.data.stores.length}</b> {res.data.stores.length === 1 ? "tienda" : "tiendas"} · últimos {res.days} días
          </p>
          <ol className="ps-list">
            {res.data.stores.map((s) => {
              const share = res.data.units ? s.units / res.data.units : 0;
              const href = res.hrefs?.[s.store_id];
              return (
                <li key={s.store_id}>
                  <div className="ps-name">
                    {href ? <Link href={href} className="strong">{s.name}</Link> : <span className="strong">{s.name}</span>}
                    <span className="sub">Última venta {ago(s.last_at)}</span>
                  </div>
                  <div className="ps-nums">
                    <span className="strong">{fmt(s.units)} u.</span>
                    <span className="sub">{fmt(s.orders)} {s.orders === 1 ? "pedido" : "pedidos"} · {Math.round(share * 100)}%</span>
                  </div>
                  <span className="ps-bar" aria-hidden><i style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} /></span>
                </li>
              );
            })}
          </ol>
          <p className="muted im-small">Unidades de pedidos no cancelados que incluyen el producto. El % es la parte de las unidades que vendió cada tienda.</p>
        </>
      )}
    </div>
  );
}
