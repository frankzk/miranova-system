import { NextResponse } from "next/server";
import { authorizeRoute } from "@/lib/auth";
import { countryByCode } from "@/lib/countries";
import { allocationLabel, costKindLabel, landedCosts, marginOf, statusInfo, trackingUrl, transportLabel } from "@/lib/imports";
import { getImport, salePrices } from "@/lib/imports-data";
import { can } from "@/lib/permissions";
import { buildXlsx, XLSX_TYPE, type Cell, type Sheet } from "@/lib/xlsx";

// Una importación en Excel: resumen, productos (con su costo final por unidad y margen),
// costos y pagos. Costos, precios y pagos solo con permiso de Dinero.

const r2 = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeRoute("imports");
  if (user instanceof Response) return user;
  const detail = await getImport((await params).id);
  if (!detail) return NextResponse.json({ error: "No existe" }, { status: 404 });
  const { imp, items, costs, payments } = detail;
  const money = can(user, "money");
  const prices = await salePrices(items);
  const landed = landedCosts(items, costs);
  const byItem = new Map(landed.items.map((r) => [r.id, r]));
  const paid = payments.reduce((t, p) => t + p.amount, 0);

  const summary: Cell[][] = [
    ["Código", imp.code],
    ["Estado", statusInfo(imp.status).label],
    ["Proveedor", imp.supplier],
    ["Origen", imp.origin],
    ["Destino", countryByCode(imp.dest_country)?.name ?? imp.dest_country],
    ["Transporte", transportLabel(imp.transport)],
    ["Empresa", imp.carrier],
    ["Guía", imp.tracking_number],
    ["Seguimiento", trackingUrl(imp.carrier, imp.tracking_number, imp.tracking_url)],
    ["Fecha del pedido", imp.ordered_at],
    ["Llegada estimada", imp.eta],
    ["Llegó", imp.arrived_at],
    ["Reportada a la bodega", imp.reported_at ? imp.reported_at.slice(0, 10) : "No"],
    ["Unidades", landed.totals.units],
    ...(money
      ? ([
          ["Costo de productos (USD)", r2(landed.totals.product)],
          ["Envío (USD)", r2(landed.totals.shipping)],
          ["Importación (USD)", r2(landed.totals.import)],
          ["Adicionales (USD)", r2(landed.totals.other)],
          ["Costo total (USD)", r2(landed.totals.total)],
          ["Pagado (USD)", r2(paid)],
          ["Falta pagar (USD)", r2(Math.max(0, landed.totals.total - paid))],
        ] as Cell[][])
      : []),
    ["Notas", imp.notes],
  ];

  const itemRows = items.map((i): Cell[] => {
    const lc = byItem.get(i.id)!;
    const price = prices.get(i.id) ?? null;
    const m = marginOf(lc.unit, price, i.qty);
    return [
      i.name, i.sku, i.product_external_id ? "Catálogo" : "Nuevo", i.qty, i.unit_weight_kg,
      ...(money
        ? [r2(i.unit_cost), r2(lc.unitParts.shipping), r2(lc.unitParts.import), r2(lc.unitParts.other), r2(lc.unit), r2(lc.total), r2(price), r2(m?.unit), m ? Math.round(m.pct * 1000) / 10 : null, r2(m?.total)]
        : []),
    ];
  });

  const sheets: Sheet[] = [
    { name: "Resumen", columns: [{ header: "Dato", width: 26 }, { header: "Valor", width: 48 }], rows: summary },
    {
      name: "Productos",
      columns: [
        { header: "Producto", width: 40 }, { header: "SKU", width: 16 }, { header: "Origen", width: 10 }, { header: "Cantidad", width: 10 }, { header: "Peso por unidad (kg)", width: 12 },
        ...(money
          ? [
              { header: "Costo proveedor por unidad (USD)", width: 14 }, { header: "Envío por unidad (USD)", width: 12 }, { header: "Importación por unidad (USD)", width: 13 },
              { header: "Adicionales por unidad (USD)", width: 13 }, { header: "Costo final por unidad (USD)", width: 14 }, { header: "Costo total de la línea (USD)", width: 14 },
              { header: "Precio de venta (USD)", width: 12 }, { header: "Margen por unidad (USD)", width: 12 }, { header: "Margen (%)", width: 10 }, { header: "Ganancia total (USD)", width: 13 },
            ]
          : []),
      ],
      rows: itemRows,
    },
  ];
  if (money) {
    sheets.push(
      {
        name: "Costos",
        columns: [{ header: "Tipo", width: 14 }, { header: "Nombre", width: 32 }, { header: "Monto (USD)", width: 12 }, { header: "Reparto", width: 16 }, { header: "Producto", width: 32 }],
        rows: costs.map((c) => [costKindLabel(c.kind), c.label, r2(c.amount), allocationLabel(c.allocation), c.item_id ? items.find((i) => i.id === c.item_id)?.name ?? null : null]),
      },
      {
        name: "Pagos",
        columns: [{ header: "Fecha", width: 12 }, { header: "Método", width: 16 }, { header: "Monto (USD)", width: 12 }, { header: "Nota", width: 36 }],
        rows: payments.map((p) => [p.paid_at, p.method, r2(p.amount), p.note]),
      },
    );
  }

  const book = buildXlsx(sheets);
  return new NextResponse(Buffer.from(book), {
    headers: {
      "content-type": XLSX_TYPE,
      "content-disposition": `attachment; filename="${imp.code}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
