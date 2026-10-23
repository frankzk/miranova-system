import { NextResponse, type NextRequest } from "next/server";
import { authorizeRoute } from "@/lib/auth";
import { inLabView, LAB_DESTINATIONS, LAB_VIEWS, labStatus, labTotals, matchesLab } from "@/lib/lab-purchases";
import { listLabPurchases } from "@/lib/lab-purchases-data";
import { can } from "@/lib/permissions";
import { buildXlsx, XLSX_TYPE, type Cell } from "@/lib/xlsx";

// Compras › Laboratorios en Excel, con los filtros de la página y las columnas de la planilla:
// estado, producto, fechas, cajas, cantidades, reparto por cuenta y montos (estos, solo con Dinero).

export async function GET(req: NextRequest) {
  const user = await authorizeRoute("imports", "export");
  if (user instanceof Response) return user;
  const money = can(user, "money");
  const sp = req.nextUrl.searchParams;
  const view = LAB_VIEWS.find((v) => v.id === sp.get("v")) ?? LAB_VIEWS[0];
  const q = sp.get("q")?.trim().slice(0, 120) || undefined;
  const rows = (await listLabPurchases()).filter((r) => inLabView(r, view) && matchesLab(r, q));

  const list: Cell[][] = rows.map((r) => {
    const t = labTotals(r);
    return [
      labStatus(r.status).label, r.product, r.lab_name, r.requested_at, r.shipped_at, r.arrived_at, r.boxes,
      r.qty_requested, r.qty_courtesy, t.total,
      ...LAB_DESTINATIONS.map((d) => r.distribution[d.id] ?? 0),
      t.distributed,
      ...(money ? [r.unit_price_gtq, t.amount_gtq, r.fx_gtq_per_usd, t.amount_usd] : []),
      r.notes,
    ];
  });

  const book = buildXlsx([
    {
      name: "Laboratorios",
      columns: [
        { header: "Estado", width: 14 }, { header: "Producto", width: 36 }, { header: "Laboratorio", width: 22 },
        { header: "Fecha de solicitud", width: 14 }, { header: "Fecha de traslado", width: 14 }, { header: "Fecha de llegada a Drop", width: 14 },
        { header: "Nro. de cajas", width: 10 }, { header: "Cantidad solicitada", width: 12 }, { header: "Cortesía", width: 10 },
        { header: "Solicitada + cortesía", width: 13 },
        ...LAB_DESTINATIONS.map((d) => ({ header: `Cantidad ${d.label}`, width: 12 })),
        { header: "Total unid. distribuidas", width: 13 },
        ...(money
          ? [{ header: "Precio unit. (Q)", width: 12 }, { header: "Monto total (Q)", width: 14 }, { header: "Tipo de cambio (Q por USD)", width: 12 }, { header: "Monto (USD)", width: 13 }]
          : []),
        { header: "Notas", width: 36 },
      ],
      rows: list,
    },
  ]);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(book), {
    headers: {
      "content-type": XLSX_TYPE,
      "content-disposition": `attachment; filename="laboratorios-miranova-${stamp}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
