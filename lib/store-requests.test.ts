import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanRequest, demandByProduct, filterRequests, isDay, isOverdue, matchesRequest, parseRequestFilters, requestItems, storeSuggestions, type StoreRequest,
} from "./store-requests.ts";

const ALLOWED = ["HN", "GT", "SV", "CR"];

test("solicitud válida: limpia espacios, ordena los países y acepta 1,500", () => {
  const r = cleanRequest(
    { store_name: "  Tienda   X ", owner_name: " Ana López ", countries: ["cr", "HN", "HN"], items: [{ product: " Drenaje en gotas ", quantity: "1,500" }], notes: "  " },
    ALLOWED,
    "2026-10-23",
  );
  assert.deepEqual(r, {
    ok: true,
    row: {
      store_name: "Tienda X", owner_name: "Ana López", countries: ["HN", "CR"], product: "Drenaje en gotas", quantity: 1500,
      items: [{ product: "Drenaje en gotas", quantity: 1500 }], notes: null,
      requested_at: "2026-10-23", arrival_at: null, origin_country: null,
    },
  });
});

test("los cuatro países a la vez", () => {
  const r = cleanRequest({ store_name: "T", items: [{ product: "P", quantity: "500" }], countries: ["SV", "GT", "CR", "HN"] }, ALLOWED);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.row.countries, ["HN", "GT", "SV", "CR"]);
});

test("faltantes y valores inválidos devuelven un mensaje claro", () => {
  const base = { store_name: "T", items: [{ product: "P", quantity: "10" }], countries: ["HN"] };
  assert.deepEqual(cleanRequest({ ...base, store_name: " " }, ALLOWED), { ok: false, msg: "Escribe el nombre de la tienda." });
  assert.deepEqual(cleanRequest({ ...base, items: [{ product: "", quantity: "" }] }, ALLOWED), { ok: false, msg: "Escribe qué producto pide." });
  assert.deepEqual(cleanRequest({ ...base, items: [] }, ALLOWED), { ok: false, msg: "Escribe qué producto pide." });
  for (const quantity of ["", "0", "-5", "2.5", "diez"]) {
    assert.equal(cleanRequest({ ...base, items: [{ product: "P", quantity }] }, ALLOWED).ok, false, quantity);
  }
  assert.deepEqual(cleanRequest({ ...base, countries: [] }, ALLOWED), { ok: false, msg: "Marca al menos un país." });
  assert.deepEqual(cleanRequest({ ...base, countries: ["HN", "MX"] }, ALLOWED), { ok: false, msg: "País no válido: MX." });
  assert.equal(cleanRequest({ ...base, items: [{ product: "P", quantity: "20000000" }] }, ALLOWED).ok, false);
});

test("búsqueda sin importar mayúsculas ni tildes", () => {
  const r = { store_name: "Vital Market", owner_name: "José Pérez", product: "Drenaje Linfático en Gotas", notes: null };
  assert.ok(matchesRequest(r, "linfatico"));
  assert.ok(matchesRequest(r, "jose"));
  assert.ok(matchesRequest(r, "VITAL"));
  assert.ok(matchesRequest(r, ""));
  assert.ok(!matchesRequest(r, "colágeno"));
});

const req = (p: Partial<StoreRequest>): StoreRequest => ({
  id: "x", store_name: "Tienda", owner_name: null, countries: ["HN"], product: "Drenaje", quantity: 100, items: [], notes: null,
  requested_at: "2026-10-01", arrival_at: null, origin_country: null,
  status: "pending", created_by: null, created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z", ...p,
});

test("lo más pedido: suma por producto aunque se escriba distinto, con tiendas y países", () => {
  const d = demandByProduct(
    [
      req({ product: "Drenaje en gotas", quantity: 500, store_name: "Tienda X", countries: ["HN"] }),
      req({ product: "drenaje en GOTAS ", quantity: 300, store_name: "tienda x", countries: ["CR", "GT"], created_at: "2026-10-05T10:00:00Z" }),
      req({ product: "Colágeno", quantity: 1000, store_name: "Otra", countries: ["SV"] }),
      req({ product: "Drenaje en gotas", quantity: 200, store_name: "Vital", countries: ["HN"] }),
    ],
    ALLOWED,
  );
  assert.deepEqual(d.map((x) => [x.product, x.units, x.requests, x.stores, x.countries.join(",")]), [
    ["drenaje en GOTAS ", 1000, 3, 2, "HN,GT,CR"],
    ["Colágeno", 1000, 1, 1, "SV"],
  ]);
  assert.equal(d[0].last, "2026-10-05T10:00:00Z");
});

test("sugerencias de tiendas: una por nombre, dueño más reciente y sus países", () => {
  const s = storeSuggestions([
    { name: "Vital Market", person: "Ana", country: "HN", last_at: "2026-09-01", orders90: 50 },
    { name: "vital market", person: "Ana María", country: "GT", last_at: "2026-10-01", orders90: 30 },
    { name: "Pequeña", person: null, country: "SV", last_at: null, orders90: 2 },
    { name: " ", person: "X", country: "HN", last_at: null, orders90: 999 },
  ]);
  assert.deepEqual(s, [
    { name: "Vital Market", owner: "Ana María", countries: ["HN", "GT"] },
    { name: "Pequeña", owner: null, countries: ["SV"] },
  ]);
});

test("filtros de la URL: pestaña, país y búsqueda", () => {
  const rows = [
    req({ id: "a", status: "pending", countries: ["HN"], store_name: "Vital" }),
    req({ id: "b", status: "in_progress", countries: ["HN", "GT"], product: "Colágeno" }),
    req({ id: "c", status: "done", countries: ["GT"] }),
    req({ id: "d", status: "dropped", countries: ["SV"] }),
  ];
  const ids = (sp: Record<string, string>) => filterRequests(rows, parseRequestFilters(sp)).map((r) => r.id).join("");
  assert.equal(ids({}), "ab"); // por defecto, las abiertas
  assert.equal(ids({ v: "todas" }), "abcd");
  assert.equal(ids({ v: "atendidas" }), "c");
  assert.equal(ids({ v: "descartadas" }), "d");
  assert.equal(ids({ v: "todas", c: "gt" }), "bc");
  assert.equal(ids({ c: "HN", q: "colageno" }), "b");
  assert.equal(ids({ v: "otra" }), "ab");
  assert.equal(parseRequestFilters({ c: "Honduras" }).country, undefined);
});

test("fechas y origen: solicitud por defecto hoy, no futura; llegada no antes de la solicitud", () => {
  const base = { store_name: "T", items: [{ product: "P", quantity: "10" }], countries: ["HN"] };
  const today = "2026-10-23";
  const ok = cleanRequest({ ...base, requested_at: "2026-10-20", arrival_at: "2026-11-15", origin_country: "  China  " }, ALLOWED, today);
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && [ok.row.requested_at, ok.row.arrival_at, ok.row.origin_country], ["2026-10-20", "2026-11-15", "China"]);
  assert.deepEqual(cleanRequest({ ...base, requested_at: "2026-10-24" }, ALLOWED, today), { ok: false, msg: "La fecha de solicitud no puede ser futura." });
  assert.deepEqual(cleanRequest({ ...base, requested_at: "2026-02-30" }, ALLOWED, today), { ok: false, msg: "La fecha de solicitud no es válida." });
  assert.deepEqual(cleanRequest({ ...base, requested_at: "2026-10-20", arrival_at: "2026-10-19" }, ALLOWED, today), {
    ok: false, msg: "La fecha de llegada no puede ser anterior a la solicitud.",
  });
  assert.equal(cleanRequest({ ...base, arrival_at: "mañana" }, ALLOWED, today).ok, false);
  assert.ok(isDay("2028-02-29") && !isDay("2026-02-29") && !isDay("2026-1-5"));
  // vencida: abierta y con la llegada ya pasada
  assert.equal(isOverdue({ status: "pending", arrival_at: "2026-10-22" }, today), true);
  assert.equal(isOverdue({ status: "done", arrival_at: "2026-10-22" }, today), false);
  assert.equal(isOverdue({ status: "in_progress", arrival_at: today }, today), false);
  assert.equal(isOverdue({ status: "pending", arrival_at: null }, today), false);
});

test("varios productos en una solicitud: filas vacías fuera, el mismo producto se suma, total y resumen", () => {
  const r = cleanRequest(
    {
      store_name: "ZONAHN", countries: ["HN"],
      items: [
        { product: "SommaSleep Spray", quantity: "400" },
        { product: "", quantity: "" },
        { product: "Drenaje en gotas", quantity: "1,000" },
        { product: "sommasleep  spray", quantity: "100" },
      ],
    },
    ALLOWED, "2026-10-23",
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.row.items, [{ product: "SommaSleep Spray", quantity: 500 }, { product: "Drenaje en gotas", quantity: 1000 }]);
  assert.deepEqual([r.row.product, r.row.quantity], ["SommaSleep Spray", 1500]);
  const bad = (items: { product?: string; quantity?: string }[]) => {
    const x = cleanRequest({ store_name: "T", countries: ["HN"], items }, ALLOWED, "2026-10-23");
    return x.ok ? "ok" : x.msg;
  };
  assert.equal(bad([{ product: "A", quantity: "10" }, { product: "", quantity: "5" }]), "Escribe el producto de la fila 2.");
  assert.equal(bad([{ product: "A", quantity: "10" }, { product: "B", quantity: "" }]), "La cantidad de “B” debe ser un número entero mayor que cero.");
  assert.match(bad(Array.from({ length: 31 }, (_, i) => ({ product: `P${i}`, quantity: "1" }))), /máximo 30/);
});

test("lo más pedido cuenta cada producto del pedido; la búsqueda encuentra cualquiera", () => {
  const rows = [
    req({ store_name: "ZONAHN", items: [{ product: "SommaSleep", quantity: 400 }, { product: "Drenaje", quantity: 100 }], product: "SommaSleep", quantity: 500 }),
    req({ store_name: "Vital", items: [{ product: "drenaje", quantity: 300 }], product: "drenaje", quantity: 300 }),
    req({ store_name: "Vieja", items: [], product: "Colágeno", quantity: 50 }),
  ];
  assert.deepEqual(demandByProduct(rows, ALLOWED).map((d) => [d.product, d.units, d.requests, d.stores]), [
    // mismas unidades: primero el pedido por más solicitudes
    ["Drenaje", 400, 2, 2],
    ["SommaSleep", 400, 1, 1],
    ["Colágeno", 50, 1, 1],
  ]);
  assert.ok(matchesRequest(rows[0], "drenaje"));
  assert.deepEqual(requestItems(rows[2]), [{ product: "Colágeno", quantity: 50 }]);
});
