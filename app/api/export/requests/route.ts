import { NextResponse, type NextRequest } from "next/server";
import { authorizeRoute } from "@/lib/auth";
import { countryByCode } from "@/lib/countries";
import { formatPhone } from "@/lib/store-contacts";
import {
  clientKind, norm, REQUEST_STATUSES, requestAllocation, demandByProduct, filterRequests, parseRequestFilters, requestProductIndex, requestStatus, requestType, type RequestProduct,
} from "@/lib/store-requests";
import { listRequestProducts, listRequests, requestCountries } from "@/lib/store-requests-data";
import { buildXlsx, XLSX_TYPE, type Cell } from "@/lib/xlsx";

// Solicitudes de tiendas y clientes potenciales en Excel, con los mismos filtros de la página: una
// hoja con una fila por producto de cada solicitud (así se puede filtrar y sumar por producto) y
// otra con lo más pedido.

const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" }).format(new Date(iso));

export async function GET(req: NextRequest) {
  const user = await authorizeRoute("requests", "export");
  if (user instanceof Response) return user;
  const [all, countries, newProducts] = await Promise.all([
    listRequests(), requestCountries(), listRequestProducts().catch((e) => (console.error("solicitudes: productos nuevos", e), [] as RequestProduct[])),
  ]);
  const created = requestProductIndex(newProducts);
  // producto nuevo (no estaba en Drop): con qué producto de Drop se vinculó, o que falta vincularlo
  const inDrop = (name: string): string | null => {
    const p = created.get(norm(name));
    if (!p) return null;
    return p.linked ? `${p.linked.name}${p.linked.account_name ? ` (${p.linked.account_name})` : ""}` : "Producto nuevo, sin vincular";
  };
  const f = parseRequestFilters(Object.fromEntries(req.nextUrl.searchParams));
  const rows = filterRequests(all, f);
  const codes = countries.map((c) => c.code);
  const names = (cs: string[]) => cs.map((c) => countryByCode(c)?.name ?? c).join(", ");

  const list: Cell[][] = rows.flatMap((r) =>
    r.items.map((it, i) => [
      r.requested_at, r.arrival_at, r.store_name, clientKind(r.client_kind ?? "store").label, requestType(r.request_type ?? "product").label, r.owner_name,
      r.contact_phone ? formatPhone(r.contact_phone) : null, r.contact_email ?? null, names(r.countries), r.origin_country, it.product, inDrop(it.product), it.quantity,
      r.items.length > 1 ? `${i + 1} de ${r.items.length}` : null, requestStatus(r.status).label, r.notes, r.created_by_name, day(r.created_at),
      ...codes.map((c) => requestAllocation(it, r.countries)[c] ?? (r.countries.includes(c) ? null : 0)),
      Object.values(requestAllocation(it, r.countries)).reduce((a, b) => a + b, 0),
    ]),
  );
  const demand: Cell[][] = demandByProduct(rows, codes).map((d) => [d.product, inDrop(d.product), d.units,
    ...codes.map((c) => d.country_quantities[c] ?? (d.unallocated > 0 && d.countries.includes(c) ? null : 0)), d.allocated,
    REQUEST_STATUSES.filter((s) => d.statuses[s.id]).map((s) => `${s.label}: ${d.statuses[s.id]}`).join(" · "),
    d.unallocated, d.requests, d.stores, d.prospects, day(d.last)]);

  const book = buildXlsx([
    {
      name: "Solicitudes",
      columns: [
        { header: "Fecha de solicitud", width: 14 }, { header: "Fecha de llegada", width: 14 }, { header: "Tienda o cliente", width: 26 },
        { header: "Quién lo pide", width: 16 }, { header: "Tipo de solicitud", width: 20 },
        { header: "Dueño o contacto", width: 22 }, { header: "Teléfono", width: 16 }, { header: "Correo", width: 26 }, { header: "Países", width: 26 }, { header: "País de origen", width: 16 }, { header: "Producto", width: 40 },
        { header: "Producto nuevo → Drop", width: 32 }, { header: "Cantidad", width: 11 }, { header: "Producto del pedido", width: 12 }, { header: "Estado", width: 12 }, { header: "Notas", width: 40 },
        { header: "Cargada por", width: 18 },
        { header: "Cargada el", width: 12 },
        ...countries.map((c) => ({ header: c.name, width: 13 })), { header: "Total repartido", width: 14 },
      ],
      rows: list,
    },
    {
      name: "Lo más pedido",
      columns: [
        { header: "Producto", width: 40 }, { header: "Producto nuevo → Drop", width: 32 }, { header: "Cantidad", width: 11 },
        ...countries.map((c) => ({ header: c.name, width: 13 })), { header: "Total", width: 12 },
        { header: "Estado", width: 40 }, { header: "Por repartir", width: 12 },
        { header: "Solicitudes", width: 12 }, { header: "Tiendas", width: 10 }, { header: "Clientes potenciales", width: 12 }, { header: "Última", width: 12 },
      ],
      rows: demand,
    },
  ]);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(book), {
    headers: {
      "content-type": XLSX_TYPE,
      "content-disposition": `attachment; filename="solicitudes-miranova-${stamp}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
