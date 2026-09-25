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

test("lee el formato real de las órdenes de Drop (/orders)", () => {
  const payload = {
    data: [
      {
        id: "6a2e154c1ab389e503ac0871",
        seller: { name: "TiendaPrueba", lastName: "Juan Pérez" },
        vendor: { name: "MIRANOVA" },
        address: { cityId: "C1", stateId: "S1", street: "Barrio X, casa azul", referencePoint: "Frente al parque" },
        payment: { cod: true, paid: false, codAmount: 1769.01, vendorCodAmount: 957, dropCodAmount: 957 },
        shopify: { orderId: "7084389368065", orderNumber: "113032" },
        customer: { name: "Norma", lastName: "García", email: "cliente@example.com", phone: "97764814", phoneAreaCode: "504" },
        shipping: {
          shipmentNumber: "FD34972132", trackingUrl: "https://tracking.example/FD1", labelUrl: "https://x/label.pdf",
          shippingCost: 89, shipmentStatusDescription: "Entregado",
        },
        orderInfo: {
          note: null, status: "4", createdAt: "2026-09-25T22:52:00.000Z", orderNumber: "1790373164131",
          instructions: "Llamar antes", statusTimeline: [{ label: "Entregado", status: "4", occurredAt: "2026-09-27T10:00:00Z" }],
        },
        courierSnapshot: { name: "Forza", courierType: "NEXT_DAY" },
        vendorEstimatedNetProfit: 868,
        productSnapshots: [
          { sku: "8668450", quantity: 3, productName: "PRODUCTO EXCLUSIVO DLG", sellerPrice: 1769.01, vendorPrice: 957, productImage: "https://img/x.png", variantName: null },
        ],
      },
      { id: "b", orderInfo: { orderNumber: "2", status: "pending_correction", createdAt: "2026-09-25T10:00:00Z" }, productSnapshots: [], shipping: {}, payment: {} },
    ],
  };
  const [a, b] = extractOrders(payload, { currency: "HNL", geo: { S1: "Copán", C1: "Nueva Arcadia" } });
  assert.equal(a.external_id, "1790373164131");
  assert.equal(a.customer_name, "Norma García");
  assert.equal(a.customer_phone, "504 97764814");
  assert.equal(a.department, "Copán");
  assert.equal(a.city, "Nueva Arcadia");
  assert.equal(a.address, "Barrio X, casa azul");
  assert.equal(a.reference_point, "Frente al parque");
  assert.equal(a.notes, "Llamar antes");
  assert.equal(a.dropshipper, "TiendaPrueba");
  assert.equal(a.carrier, "Forza");
  assert.equal(a.shopify_order, "113032");
  assert.equal(a.status, "Entregado");
  assert.equal(a.status_code, "4");
  assert.equal(a.tracking_number, "FD34972132");
  assert.equal(a.total, 1769.01);
  assert.equal(a.vendor_amount, 957);
  assert.equal(a.vendor_net, 868);
  assert.equal(a.ordered_at, "2026-09-25T22:52:00.000Z");
  assert.equal(a.items.length, 1);
  assert.deepEqual(
    { n: a.items[0].product_name, q: a.items[0].quantity, p: a.items[0].price, v: a.items[0].vendor_price, sku: a.items[0].sku },
    { n: "PRODUCTO EXCLUSIVO DLG", q: 3, p: 1769.01, v: 957, sku: "8668450" },
  );
  assert.equal(b.external_id, "2");
  assert.equal(b.status, "Verificar");
});
