import assert from "node:assert/strict";
import { test } from "node:test";
import { describeAlert } from "./alerts.ts";
import {
  alertingStores, byUrgency, cellText, classifyExclusive, coverText, exclusiveAlerts, idleStoreRow, idleText, insertOp, leadItem, normalizeExclusive,
  privatizedByStore, privatizedOp, stateText, storeContext,
  type ExclusiveIdleRow,
} from "./exclusive-idle.ts";

const HN = "11111111-1111-4111-8111-111111111111";
const SV = "22222222-2222-4222-8222-222222222222";
const GT = "33333333-3333-4333-8333-333333333333";
const NAMES: Record<string, string> = { [HN]: "Drop Honduras", [SV]: "Drop El Salvador", [GT]: "Drop Guatemala" };
const TODAY = "2026-11-03";
const day = (d: number) => new Date(Date.parse(TODAY) - d * 86_400_000).toISOString().slice(0, 10);

const row = (p: Partial<ExclusiveIdleRow>): ExclusiveIdleRow => ({
  account_id: HN, account_name: NAMES[p.account_id ?? HN], today: TODAY, store_id: "s1", store_name: "Tienda", product_external_id: "p1",
  product_name: "Producto", product_code: null, units: 50, since: null, held_days: 30, last_at: null,
  last_day: p.days_since === null || p.days_since === undefined ? null : day(p.days_since),
  days_since: 1, orders_since: 10, n7: 5, n14_before: 14, active_before: 5, store_last_at: null, store_days_since: 1, movements_sync_at: null,
  ...p,
});

// Producción, 3 nov 2026 (exclusive_idle): tienda, producto, unidades, días desde su último pedido,
// pedidos desde que lo privatizó, pedidos en las 2 semanas antes de frenarse, días activos antes, días
// desde el último pedido de la tienda y días que lo lleva apartado (un 0 de menos de un día, como el
// que deja Drop al ajustar una solicitud, no corta el apartado: GREEN PHARMA y Vitalo sí lo vendieron;
// a Trendyhaus le falta guardado el movimiento que lo apartó: cuenta desde el primero con saldo, 15 oct)
const REAL: [string, string, string, number, number | null, number, number, number, number | null, number][] = [
  [SV, "Easy_SV", "BRASIER SIN AROS", 254, 28, 9, 9, 3, 2, 33],
  [SV, "GREEN PHARMA SV", "Drenaje Linfático", 66, 38, 19, 37, 7, 19, 41],
  [SV, "Nexuss LLC SV", "Drenaje Linfático", 3, 1, 46, 14, 5, 1, 36],
  [SV, "Trendyhaus SV", "Bividi Camiseta", 10, 1, 7, 36, 7, 1, 4],
  [SV, "Trendyhaus SV", "Cortador Pastillas", 9, 1, 82, 54, 7, 1, 20],
  [SV, "Velora Store Salvador", "Varicose", 6, 44, 30, 30, 4, 15, 53],
  [SV, "Vitalo Tienda Sv", "Auto Wash Water Gun", 60, 40, 10, 19, 2, 26, 47],
  [SV, "vive store4all", "BRASIER SIN AROS", 199, 8, 54, 11, 2, 8, 32],
  [GT, "Noelia Home GT", "Cinturón sin Hebilla", 36, 1, 26, 61, 7, 1, 5],
  [GT, "Vital Market", "Set de Pelador", 100, 111, 0, 136, 7, 97, 34],
  [HN, "Innova Life", "Auto Wash Water Gun", 49, 0, 234, 93, 7, 0, 34],
  [HN, "Innova Life", "Cinturón sin Hebilla", 31, 0, 90, 41, 7, 0, 26],
  [HN, "Innova Life", "Set de Pelador", 12, 0, 138, 158, 7, 0, 12],
  [HN, "Nutralix", "DRENAJE LINFÁTICO", 288, 4, 4, 59, 2, 4, 12],
  [HN, "Trendyhaus", "DRENAJE LINFÁTICO", 25, 2, 24, 21, 6, 2, 19],
  [HN, "Velora Honduras", "DRENAJE LINFÁTICO", 275, 5, 393, 82, 4, 4, 33],
  [HN, "Velora Honduras", "AutoGrip 360", 157, 42, 30, 2, 1, 4, 67],
  [HN, "ZONAHN", "THYROID SUPPORT", 289, 13, 8, 8, 4, 6, 20],
  [HN, "ZONAHN", "DRENAJE LINFÁTICO", 256, 9, 176, 62, 6, 6, 33],
  [HN, "ZONAHN", "Suplemento Hígado", 236, 9, 14, 14, 5, 6, 20],
  [HN, "ZONAHN", "SommaSleep Spray", 170, 8, 24, 44, 6, 6, 11],
  [HN, "ZONAHN", "Flycleanse", 131, 66, 41, 8, 2, 6, 89],
  [HN, "ZONAHN", "Sovexa Cayenne", 2, 6, 177, 165, 7, 6, 20],
];
const real = REAL.map(([account_id, store_name, product_name, units, days_since, orders_since, n14_before, active_before, store_days_since, held_days]) =>
  row({ account_id, store_id: store_name, store_name, product_external_id: product_name, product_name, units, days_since, orders_since, n14_before, active_before, store_days_since, held_days }));

const item = (store: string, product: string) => classifyExclusive(real.find((r) => r.store_name === store && r.product_name === product)!);

test("un día completo sin pedidos = dejó de pautar; ayer u hoy = al día; 7 días = durmiendo", () => {
  assert.equal(classifyExclusive(row({ days_since: 0 })).state, "ok");
  // el último pedido fue ayer: hoy todavía puede llegar otro, no avisa
  assert.equal(classifyExclusive(row({ days_since: 1 })).state, "ok");
  const two = classifyExclusive(row({ days_since: 2 }));
  assert.equal(two.state, "stopped");
  assert.equal(two.idle_days, 1);
  assert.equal(idleText(two), "1 día sin pedidos");
  assert.equal(classifyExclusive(row({ days_since: 7 })).state, "stopped");
  assert.equal(classifyExclusive(row({ days_since: 8 })).state, "sleeping");
});

test("lo que no estrenó: 3 días de gracia y después durmiendo, contando desde que lo privatizó", () => {
  const fresh = classifyExclusive(row({ orders_since: 0, held_days: 2, days_since: 40 }));
  assert.equal(fresh.state, "fresh");
  assert.equal(fresh.alert, false);
  const asleep = classifyExclusive(row({ orders_since: 0, held_days: 3, days_since: 40 }));
  assert.equal(asleep.state, "sleeping");
  assert.equal(asleep.never, true);
  assert.equal(asleep.alert, true);
  assert.equal(idleText(asleep), "no lo vende desde que lo privatizó hace 3 días");
  // nunca tuvo pedidos de ese producto
  assert.equal(classifyExclusive(row({ orders_since: 0, held_days: 10, days_since: null })).state, "sleeping");
});

test("prioridad: contactar hoy solo si lo vendía seguido; durmiendo según lo apartado; menos de 5 u. no avisa", () => {
  assert.equal(item("Trendyhaus", "DRENAJE LINFÁTICO").priority, 1);
  assert.equal(item("Velora Honduras", "DRENAJE LINFÁTICO").priority, 1);
  // Nutralix pedía en 2 de los 7 días antes de frenarse: esta semana, no hoy
  assert.equal(item("Nutralix", "DRENAJE LINFÁTICO").priority, 2);
  assert.equal(item("Easy_SV", "BRASIER SIN AROS").priority, 2);
  assert.equal(item("Velora Store Salvador", "Varicose").priority, 3);
  const few = item("ZONAHN", "Sovexa Cayenne");
  assert.equal(few.state, "stopped");
  assert.equal(few.alert, false);
  assert.equal(few.priority, null);
});

test("cuánto le alcanzaba al ritmo que llevaba antes de frenarse", () => {
  assert.equal(item("Trendyhaus", "DRENAJE LINFÁTICO").cover, 17);
  assert.equal(coverText(item("Trendyhaus", "DRENAJE LINFÁTICO")), "le alcanzaba para ~17 días");
  assert.equal(item("Nutralix", "DRENAJE LINFÁTICO").cover, 68);
  assert.equal(classifyExclusive(row({ n14_before: 0 })).cover, null);
  assert.equal(coverText(classifyExclusive(row({ n14_before: 0 }))), null);
  // 2 u. a casi 12 pedidos/día: no "~0 días"
  assert.equal(coverText(item("ZONAHN", "Sovexa Cayenne")), "le alcanzaba para menos de un día");
  assert.equal(coverText(classifyExclusive(row({ units: 1, n14_before: 14 }))), "le alcanzaba para ~1 día");
});

test("lo que sí vendió y Drop re-apartó en segundos no sale como 'sin estrenar'", () => {
  const by = privatizedByStore(real);
  const green = [...by.values()].find((s) => s.store_name === "GREEN PHARMA SV")!;
  assert.equal(green.worst!.never, false);
  assert.equal(cellText(green), "66 u. · 37 días sin pedidos");
  assert.match(privatizedOp(green)!.action, /moverlo o liberar/);
  const vitalo = [...by.values()].find((s) => s.store_name === "Vitalo Tienda Sv")!;
  assert.equal(cellText(vitalo), "60 u. · 39 días sin pedidos");
});

test("estado de la tienda cuando nada avisa: el del producto con más unidades, sin decir 'Al día' de lo que no se vende", () => {
  const store = (rows: Partial<ExclusiveIdleRow>[]) =>
    [...privatizedByStore(rows.map((r, i) => row({ store_id: "x", product_external_id: `p${i}`, product_name: `P${i}`, ...r }))).values()][0];
  // 3 u. sin pedidos hace 4 días: no avisa, pero tampoco está al día
  const few = store([{ units: 3, days_since: 5 }]);
  assert.equal(few.worst, null);
  assert.equal(leadItem(few).state, "stopped");
  assert.equal(stateText(few), "Dejó de pautar (no avisa: menos de 5 u.)");
  assert.equal(stateText(store([{ units: 60, orders_since: 0, held_days: 1 }])), "Recién privatizado");
  // 2 u. sueltas no tapan 36 u. que se venden
  assert.equal(stateText(store([{ units: 36, days_since: 0 }, { units: 2, days_since: 6 }])), "Al día");
  const innova = [...privatizedByStore(real).values()].find((s) => s.store_name === "Innova Life")!;
  assert.equal(stateText(innova), "Al día");
  const zona = [...privatizedByStore(real).values()].find((s) => s.store_name === "ZONAHN")!;
  assert.equal(leadItem(zona), zona.worst);
  assert.equal(stateText(zona), "Durmiendo");
});

test("pestaña de lo privatizado: la más urgente primero; las que no avisan, al final", () => {
  const list = alertingStores(privatizedByStore(real));
  const rows = [...list].reverse().map((x) => ({ account_id: x.account_id, store_id: x.store_id, name: x.store_name }));
  const other = { account_id: HN, store_id: "otra", name: "Otra" };
  assert.deepEqual(byUrgency([other, ...rows], list).map((r) => r.name), [...list.map((x) => x.store_name), "Otra"]);
});

test("datos reales: 10 tiendas y 2,512 u. privatizadas sin pedidos; las que dejaron de pautar primero", () => {
  const by = privatizedByStore(real);
  const list = alertingStores(by);
  assert.equal(list.length, 10);
  assert.equal(list.reduce((t, s) => t + s.alerts.length, 0), 15);
  assert.equal(list.reduce((t, s) => t + s.idle_units, 0), 2512);
  assert.deepEqual(list.slice(0, 3).map((s) => s.store_name), ["Velora Honduras", "Trendyhaus", "Nutralix"]);
  // al día: no avisan
  for (const name of ["Innova Life", "Noelia Home GT", "Trendyhaus SV", "Nexuss LLC SV"]) {
    assert.equal([...by.values()].find((s) => s.store_name === name)!.worst, null, name);
  }
});

test("tienda con varios productos: suma lo que no se mueve y avisa por el más urgente", () => {
  const by = privatizedByStore(real);
  const zona = [...by.values()].find((s) => s.store_name === "ZONAHN")!;
  assert.equal(zona.items.length, 6);
  assert.equal(zona.alerts.length, 5);
  assert.equal(zona.idle_units, 1082);
  assert.equal(zona.worst!.product_name, "THYROID SUPPORT");
  assert.equal(cellText(zona), "5 prod. · 1,082 u. sin pedidos");
  assert.equal(privatizedOp(zona)!.text, "Privatizado durmiendo: THYROID SUPPORT (289 u.), 12 días sin pedidos · y 4 productos más sin pedidos (793 u.)");

  const velora = [...by.values()].find((s) => s.store_name === "Velora Honduras")!;
  assert.equal(velora.worst!.state, "stopped");
  assert.equal(velora.idle_units, 432);
  const op = privatizedOp(velora)!;
  assert.equal(op.priority, 1);
  assert.equal(op.text, "Dejó de pautar su privatizado: DRENAJE LINFÁTICO (275 u.), 4 días sin pedidos · y 1 producto más sin pedidos (157 u.)");
  assert.match(op.action, /reactivarla/);
});

test("una sola tienda y producto: texto, celda y contexto de la tienda", () => {
  const by = privatizedByStore(real);
  const easy = [...by.values()].find((s) => s.store_name === "Easy_SV")!;
  assert.equal(privatizedOp(easy)!.text, "Privatizado durmiendo: BRASIER SIN AROS (254 u.), 27 días sin pedidos");
  assert.equal(cellText(easy), "254 u. · 27 días sin pedidos");
  // vende otras cosas pero el brasier no: justo lo que la salud de la tienda no muestra
  assert.equal(storeContext(easy, easy.worst!), "la tienda vendió otros productos hasta hace 2 días");
  assert.equal(storeContext({ store_days_since: 0 }, easy.worst!), "la tienda sigue vendiendo otros productos");
  // pausó todo: su último pedido fue de este producto
  const trendy = [...by.values()].find((s) => s.store_name === "Trendyhaus")!;
  assert.equal(storeContext(trendy, trendy.worst!), "la tienda no tiene pedidos hace 2 días");
  const vital = [...by.values()].find((s) => s.store_name === "Vital Market")!;
  assert.equal(storeContext(vital, vital.worst!), "la tienda no tiene pedidos hace 97 días");
  const green = [...by.values()].find((s) => s.store_name === "GREEN PHARMA SV")!;
  assert.equal(storeContext(green, green.worst!), "la tienda vendió otros productos hasta hace 19 días");
  assert.equal(storeContext({ store_days_since: null }, green.worst!), "la tienda no tiene pedidos en 6 meses");
  assert.equal(cellText(vital), "100 u. · sin estrenar");
  // al día: solo las unidades (el estado va en la etiqueta)
  const innova = [...by.values()].find((s) => s.store_name === "Innova Life")!;
  assert.equal(cellText(innova), "3 prod. · 92 u.");
  assert.equal(cellText([...by.values()].find((s) => s.store_name === "Noelia Home GT")!), "36 u.");
  assert.match(privatizedOp(vital)!.action, /liberar el stock/);
});

test("Inicio: un aviso por cuenta, rojo si alguna que lo vendía seguido dejó de pautar", () => {
  const accounts = [HN, SV, GT].map((id) => ({ id, name: NAMES[id], country: "", currency: "USD" }));
  const alerts = exclusiveAlerts(privatizedByStore(real), accounts);
  assert.deepEqual(alerts.map((a) => [a.account, a.severity]), [["Drop Honduras", 1], ["Drop El Salvador", 2], ["Drop Guatemala", 2]]);
  const hn = describeAlert(alerts[0]);
  assert.equal(hn.tone, "danger");
  assert.equal(hn.title, "Drop Honduras: 3 tiendas dejaron de pautar su producto privatizado");
  assert.equal(hn.detail, "1,827 u. privatizadas sin pedidos en 4 tiendas: Velora Honduras, Trendyhaus, Nutralix y 1 más.");
  assert.match(decodeURIComponent(hn.href), /next=\/stores\?px=1/);
  const sv = describeAlert(alerts[1]);
  assert.equal(sv.title, "Drop El Salvador: 5 tiendas con su producto privatizado durmiendo");
  // sin permiso de Tiendas: sin enlace
  assert.equal(describeAlert(alerts[0], undefined, { money: true, orders: true, products: true, stores: false }).href, "");
});

test("normaliza enteros que llegan como texto", () => {
  const [r] = normalizeExclusive([{ ...row({}), units: "12" as unknown as number, days_since: "3" as unknown as number, held_days: null }]);
  assert.equal(r.units, 12);
  assert.equal(r.days_since, 3);
  assert.equal(r.held_days, null);
});

test("el aviso de lo privatizado no le quita el primer lugar a una caída de la tienda", () => {
  const ops = [{ kind: "volume", priority: 1 }, { kind: "winner", priority: 2 }, { kind: "ticket", priority: 3 }];
  assert.deepEqual(insertOp(ops, { kind: "exclusive", priority: 1 }).map((o) => o.kind), ["volume", "exclusive", "winner", "ticket"]);
  assert.deepEqual(insertOp(ops, { kind: "exclusive", priority: 3 }).map((o) => o.kind), ["volume", "winner", "ticket", "exclusive"]);
  assert.deepEqual(insertOp([], { kind: "exclusive", priority: 2 }).map((o) => o.kind), ["exclusive"]);
  assert.equal(insertOp(ops, null), ops);
});

test("tienda sin pedidos en 60 días: fila sin ventas con su último pedido", () => {
  const vital = [...privatizedByStore(real).values()].find((s) => s.store_name === "Vital Market")!;
  const r = idleStoreRow(vital, "GTQ");
  assert.equal(r.name, "Vital Market");
  assert.equal(r.d7, 0);
  assert.equal(r.days_since, 97);
  assert.equal(r.daily.length, 14);
});
