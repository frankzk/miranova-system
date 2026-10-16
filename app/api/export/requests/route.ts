import { NextResponse, type NextRequest } from "next/server";
import { authorizeRoute } from "@/lib/auth";
import { countryByCode } from "@/lib/countries";
import { demandByProduct, filterRequests, parseRequestFilters, requestStatus } from "@/lib/store-requests";
import { listRequests, requestCountries } from "@/lib/store-requests-data";
import { buildXlsx, XLSX_TYPE, type Cell } from "@/lib/xlsx";

// Solicitudes de tiendas en Excel, con los mismos filtros de la página: una hoja con cada
// solicitud y otra con lo más pedido (suma por producto).

const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" }).format(new Date(iso));

export async function GET(req: NextRequest) {
  const user = await authorizeRoute("requests", "export");
  if (user instanceof Response) return user;
  const [all, countries] = await Promise.all([listRequests(), requestCountries()]);
  const f = parseRequestFilters(Object.fromEntries(req.nextUrl.searchParams));
  const rows = filterRequests(all, f);
  const codes = countries.map((c) => c.code);
  const names = (cs: string[]) => cs.map((c) => countryByCode(c)?.name ?? c).join(", ");

  const list: Cell[][] = rows.map((r) => [
    day(r.created_at), r.store_name, r.owner_name, names(r.countries), r.product, r.quantity, requestStatus(r.status).label, r.notes, r.created_by_name,
  ]);
  const demand: Cell[][] = demandByProduct(rows, codes).map((d) => [d.product, d.units, d.requests, d.stores, names(d.countries), day(d.last)]);

  const book = buildXlsx([
    {
      name: "Solicitudes",
      columns: [
        { header: "Fecha", width: 12 }, { header: "Tienda", width: 26 }, { header: "Dueño", width: 22 }, { header: "Países", width: 26 },
        { header: "Producto", width: 40 }, { header: "Cantidad", width: 11 }, { header: "Estado", width: 12 }, { header: "Notas", width: 40 },
        { header: "Cargada por", width: 18 },
      ],
      rows: list,
    },
    {
      name: "Lo más pedido",
      columns: [
        { header: "Producto", width: 40 }, { header: "Unidades", width: 11 }, { header: "Solicitudes", width: 12 }, { header: "Tiendas", width: 10 },
        { header: "Países", width: 30 }, { header: "Última", width: 12 },
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
