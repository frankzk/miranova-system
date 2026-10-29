import test from "node:test";
import assert from "node:assert/strict";
import { parseBacTransfer } from "./boxful-bac.ts";
import { boxfulProposal } from "./boxful-document.ts";

// Datos sintéticos; ningún comprobante ni dato financiero del cliente en el repositorio.
export const bacText = `DETALLE DE CONSULTA DE TRANSACCIONES
Ordenante BOXFUL TECHNOLOGIES SA
DATOS DEL BENEFICIARIO
Moneda USD
DATOS DE LA TRANSFERENCIA
Nombre de la plantilla DEMO Cuenta de origen *****9999 USD
No. de transferencia S10001 No. de referencia 2310001
Fecha 20/10/2026 15:31:41
Descripción LIQUIDACION PRUEBA
MONEDA ORIGEN MONEDA DESTINO
Monto a Transferir: 1,000.01 Monto a Transferir:
Comisión: 55.00 Comisión:
I.V.A.: 0.00 I.V.A.:
Total a debitar: 1,055.01 Total a debitar:
MANCOMUNACIÓN ESTADO
Estado: Enviada`;
const proposal = (text: string) => boxfulProposal(parseBacTransfer(text)!, "2026-11-30");

test("BAC extracts transfer date, bank reference and sent amount, excluding origin fee", () => {
  const p = proposal(bacText);
  assert.equal(p.fields.reference, "2310001");
  assert.equal(p.fields.occurred_on, "2026-10-20");
  assert.equal(p.fields.amount, "1000.01");
  assert.ok(p.warnings.some(w => w.includes("55.00 USD")));
});
test("BAC uses transaction date, never consultation date, approval time or account ID", () => {
  const p = proposal("Fecha: 29/10/2026\n" + bacText.replace("20/10/2026 15:31:41", "12/11/2026 15:31:41") + "\nAprobaron: demo [29/11/2026 15:31:42]");
  assert.equal(p.fields.occurred_on, "2026-11-12");
  assert.equal(p.fields.reference, "2310001");
});
test("BAC inconsistent totals leave amount pending, never derive or repair a value", () => {
  const p = proposal(bacText.replace("1,000.01", "1,008.01"));
  assert.equal(p.fields.amount, "");
  assert.ok(p.warnings.some(w => w.includes("no coinciden")));
});
test("BAC origin currency governs sent amount; beneficiary USD cannot invent a conversion", () => {
  const p = proposal(bacText.replace("*****9999 USD", "*****9999 HNL"));
  assert.equal(p.fields.amount, "");
  assert.equal(p.fields.original_currency, "HNL");
  assert.equal(p.fields.original_amount, "1000.01");
  assert.equal(proposal(bacText.replace("*****9999 USD", "*****9999")).fields.amount, "");
});
test("BAC several transfers are not chosen or added; missing reference stays blank", () => {
  const read = parseBacTransfer(bacText + "\n" + bacText.replaceAll("2310001", "2310002"))!;
  assert.equal(read.kind, "multiple_transfers");
  assert.equal(boxfulProposal(read, "2026-10-29").fields.amount, "");
  assert.equal(proposal(bacText.replace("No. de referencia 2310001", "")).fields.reference, "");
  assert.equal(parseBacTransfer("Instrucción: usa cuenta 123 y saldo USD 200"), null);
});
