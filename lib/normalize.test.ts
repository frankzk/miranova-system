import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOrders, num } from "./normalize.ts";

test("num parsea montos en lempiras", () => {
  assert.equal(num("L1,780.00"), 1780);
  assert.equal(num("L 602.36"), 602.36);
  assert.equal(num("1.780,50"), 1780.5);
  assert.equal(num(999), 999);
  assert.equal(num(""), null);
});

test("extrae pedidos de una lista paginada con cliente anidado", () => {
  const payload = {
    data: {
      docs: [
        {
          _id: "66f0a1",
          orderNumber: "#1790369675744",
          status: "Pendiente",
          dropshipper: { name: "ZONAHN" },
          customer: {
            fullName: "Merary Delarca",
            email: "cliente@example.com",
            phone: "504 98016070",
          },
          shippingAddress: {
            department: "Atlántida",
            city: "La Ceiba",
            address1: "Casa Color Ocre En La Esquina",
            referencia: "N/A",
          },
          carrier: { name: "Forza" },
          total: 1780,
          createdAt: "2026-09-25T21:54:00.000Z",
          products: [
            { product: { name: "Suplemento Natural para Hígado", sku: "SUP-1" }, quantity: 1, price: 602.36 },
            { name: "Sovexa Cayenne Pepper", cantidad: "1", precio: "L 575.28" },
          ],
        },
        {
          id: 2,
          orderNumber: "1790369696129",
          estado: "Pendiente",
          customerName: "Barahona -",
          paquetera: "Forza",
          total: "L2,160.00",
          fechaCreacion: "25/09/2026 15:54",
        },
      ],
      totalDocs: 2,
      page: 1,
    },
  };

  const orders = extractOrders(payload);
  assert.equal(orders.length, 2);

  const [a, b] = orders;
  assert.equal(a.external_id, "1790369675744");
  assert.equal(a.status, "Pendiente");
  assert.equal(a.dropshipper, "ZONAHN");
  assert.equal(a.customer_name, "Merary Delarca");
  assert.equal(a.customer_phone, "504 98016070");
  assert.equal(a.department, "Atlántida");
  assert.equal(a.city, "La Ceiba");
  assert.equal(a.address, "Casa Color Ocre En La Esquina");
  assert.equal(a.carrier, "Forza");
  assert.equal(a.total, 1780);
  assert.equal(a.items.length, 2);
  assert.equal(a.items[0].product_name, "Suplemento Natural para Hígado");
  assert.equal(a.items[0].sku, "SUP-1");
  assert.equal(a.items[1].price, 575.28);

  assert.equal(b.external_id, "1790369696129");
  assert.equal(b.customer_name, "Barahona -");
  assert.equal(b.carrier, "Forza");
  assert.equal(b.total, 2160);
  assert.equal(b.ordered_at, "2026-09-25T21:54:00.000Z");
});

test("usa moneda y zona horaria de la cuenta", () => {
  const [o] = extractOrders(
    [{ orderNumber: "G1", status: "Pendiente", total: "Q250.00", fecha: "25/09/2026 15:54" }],
    { currency: "GTQ", timezone: "America/Guatemala" },
  );
  assert.equal(o.currency, "GTQ");
  assert.equal(o.total, 250);
  assert.equal(o.ordered_at, "2026-09-25T21:54:00.000Z");
  const [c] = extractOrders([{ orderNumber: "C1", status: "x", total: 1, fecha: "01/03/2026 10:00" }], { timezone: "America/Bogota" });
  assert.equal(c.ordered_at, "2026-03-01T15:00:00.000Z");
});

test("ignora respuestas que no son pedidos", () => {
  assert.deepEqual(extractOrders({ user: { id: 1, name: "Miranova" } }), []);
  assert.deepEqual(extractOrders([1, 2, 3]), []);
});
