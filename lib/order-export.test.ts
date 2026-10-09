import { test } from "node:test";
import assert from "node:assert/strict";
import { orderExportRows, sortableDate } from "./order-export.ts";
import { buildXlsx } from "./xlsx.ts";

const order = {
  external_id: "1791375897055", shopify_order: "1201", ordered_at: "2026-10-07T12:24:00Z", status: "Pendiente", dropshipper: "Ahorro Total",
  customer_name: "Ana", customer_phone: "504 9999", customer_email: null, department: "Cortés", city: "San Pedro Sula", address: "Col. Centro",
  reference_point: null, notes: null, carrier: "Forza", tracking_number: "FD1", tracking_url: null, cod: true, total: 1450, vendor_amount: 720.5,
  paid: false, currency: "HNL", accounts: { name: "Drop Honduras", country: "HN", timezone: "America/Tegucigalpa" },
  order_items: [
    { product_name: "Vascu Glow", quantity: 2, price: 1450, vendor_price: "720.5" as unknown as number, sku: "V1", image_url: null, position: 0 },
    { product_name: "Regalo", quantity: 1, price: 0, vendor_price: 0, sku: null, image_url: null, position: 1 },
  ],
};

test("fecha ordenable en la hora de la cuenta", () => {
  assert.equal(sortableDate("2026-10-07T12:24:00Z", "America/Tegucigalpa"), "2026-10-07 06:24");
  assert.equal(sortableDate("2026-10-07T12:24:00Z", "America/Guatemala"), "2026-10-07 06:24");
  assert.equal(sortableDate(null), null);
});

test("una fila por producto, montos como números", () => {
  const { columns, rows } = orderExportRows([order], { paidCol: true });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, columns.length);
  const col = (h: string) => columns.findIndex((c) => c.header === h);
  assert.equal(rows[0][col("Fecha")], "2026-10-07 06:24");
  assert.equal(rows[0][col("Cantidad")], 2);
  assert.equal(rows[0][col("Precio proveedor")], 720.5); // texto numérico → número
  assert.equal(rows[1][col("Producto")], "Regalo");
  assert.equal(rows[0][col("Pago")], "Contra entrega");
  assert.equal(rows[0][col("Liquidada")], "No");
});

test("sin permiso de Dinero no va la columna Liquidada", () => {
  const { columns, rows } = orderExportRows([order], { paidCol: false });
  assert.equal(columns.some((c) => c.header === "Liquidada"), false);
  assert.equal(rows[0].length, columns.length);
});

test("orden sin productos: una fila igual", () => {
  const { rows } = orderExportRows([{ ...order, order_items: [] }], { paidCol: false });
  assert.equal(rows.length, 1);
});

test("arma un .xlsx válido (ZIP con la hoja)", () => {
  const { columns, rows } = orderExportRows([order], { paidCol: true });
  const book = buildXlsx([{ name: "Órdenes", columns, rows }]);
  assert.equal(book[0], 0x50); // "PK"
  assert.equal(book[1], 0x4b);
  const text = new TextDecoder().decode(book);
  assert.ok(text.includes("xl/worksheets/sheet1.xml"));
  assert.ok(text.includes("<v>720.5</v>"));
});
