// Panel lateral de una tienda (?ficha=<cuenta>:<tienda>), compartido por Salud de tiendas,
// Tiendas nuevas y Tienda × producto: contacto y seguimiento sin salir del listado.
import { Suspense } from "react";
import { Drawer, DrawerClose } from "@/components/client";
import { StoreDrawer } from "@/components/store-drawer";
import { DrawerSkeleton } from "@/components/store-drawer-link";
import { storeContactView, type StoreContactView } from "@/lib/contacts";
import { fmtMoney } from "@/lib/format";
import { storeDetail, type StoreDetail } from "@/lib/store-detail";
import { classify, opportunities, type StoreRow } from "@/lib/stores";
import { addFollowup, updateFollowup } from "./[account]/[store]/actions";
import { linkStore, mergeContacts, saveContact, unlinkStore } from "./[account]/[store]/contact-actions";
// estilos de contacto y seguimiento (los mismos de la ficha)
import "./[account]/[store]/store-detail.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `ficha=<cuenta>:<tienda>` (storeKey) → la tienda del panel lateral. */
export function parseFicha(v: string | undefined) {
  if (!v || v.length > 300) return null;
  const accountId = v.slice(0, 36);
  const storeId = v.slice(37);
  return UUID.test(accountId) && v[36] === ":" && storeId ? { accountId, storeId } : null;
}

export type DrawerData = Promise<[StoreDetail | null, StoreContactView]>;

/** Pide ya los datos del panel, para que corran en paralelo con los de la lista. */
export function loadDrawer(ficha: { accountId: string; storeId: string } | null): DrawerData | null {
  if (!ficha) return null;
  const data: DrawerData = Promise.all([storeDetail(ficha.accountId, ficha.storeId), storeContactView(ficha.accountId, ficha.storeId)]);
  // si la lista falla antes de llegar al panel, que ese error no quede sin atender
  data.catch(() => {});
  return data;
}

type Props = {
  ficha: { accountId: string; storeId: string };
  data: DrawerData;
  /** Nombre para el panel "cargando" (si ya se conoce). */
  name?: string | null;
  /** Fila de Salud de tiendas: estado y "qué hacer" (null fuera de ese listado). */
  row?: StoreRow | null;
  typical?: number | null;
  closeHref: string;
  me: string;
  canOrders: boolean;
  canEdit: boolean;
  /** Sección propia de la pantalla que abre el panel (p. ej. hábitos de compra en Tienda × producto). */
  extra?: React.ReactNode;
};

export function StoreDrawerSlot({ ficha, ...rest }: Props) {
  return (
    // key: al pasar de una tienda a otra se vuelve a mostrar la carga
    <Suspense key={`${ficha.accountId}:${ficha.storeId}`} fallback={<DrawerSkeleton name={rest.name ?? rest.row?.name} />}>
      <StoreDrawerPanel {...rest} />
    </Suspense>
  );
}

/** Carga la ficha y el contacto de la tienda (lo único que el panel necesita). */
async function StoreDrawerPanel({ data, name, row, typical, closeHref, me, canOrders, canEdit, extra }: Omit<Props, "ficha">) {
  const [d, contact] = await data;
  if (!d) {
    // una tienda sin ningún pedido (p. ej. privatizó stock antes de empezar a vender): sin ficha,
    // pero la sección propia de la pantalla se puede ver igual
    if (!extra) return null;
    return (
      <Drawer closeHref={closeHref} label={`Tienda ${name ?? ""}`.trim()}>
        <div className="drawer-head sheet-head">
          <div className="grow">
            <h2 className="sheet-title">{name ?? "Tienda"}</h2>
            <p className="sheet-sub">Todavía no tiene pedidos</p>
          </div>
          <DrawerClose href={closeHref} />
        </div>
        <div className="drawer-body sheet-body sd-drawer">{extra}</div>
      </Drawer>
    );
  }
  return (
    <Drawer closeHref={closeHref} label={`Tienda ${d.store.name}`}>
      <StoreDrawer
        d={d}
        contact={contact}
        health={row ? classify(row) : null}
        ops={row ? opportunities(row, typical, (n) => fmtMoney(n, row.currency, { compact: true })) : []}
        closeHref={closeHref}
        me={me}
        canOrders={canOrders}
        extra={extra}
        actions={canEdit ? { contact: { save: saveContact, link: linkStore, unlink: unlinkStore, merge: mergeContacts }, followup: { add: addFollowup, update: updateFollowup } } : null}
      />
    </Drawer>
  );
}
