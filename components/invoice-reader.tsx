"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { readInvoiceDocument } from "@/app/(app)/imports/actions";
import { unitUsd, type Proposal } from "@/lib/invoice";
import type { ImportFormState } from "./import-forms";
import { useSheet } from "./side-sheet";
import { StickyForm } from "./sticky-form";
import { SubmitButton } from "./submit-button";

type Action = (prev: ImportFormState, form: FormData) => Promise<ImportFormState>;
type Read = { ok: true; proposal: Proposal; model: string; existing: number } | { ok: false; msg: string };
type Row = { include: boolean; name: string; sku: string; qty: string; price: string; link: boolean; match: Proposal["lines"][number]["match"] };
type Charge = { include: boolean; label: string; kind: "shipping" | "import" | "other"; amount: string };

const num = (s: string) => {
  const v = Number(s.replace(/[,\s]/g, ""));
  return Number.isFinite(v) ? v : NaN;
};
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const KIND: Record<Charge["kind"], string> = { shipping: "Envío", import: "Importación", other: "Adicional" };

/**
 * Lee el documento con IA al abrirse y muestra la propuesta para revisarla: qué productos agregar
 * (enlazados a Drop si coinciden), cantidades, precios pasados a USD y cargos como costos.
 */
export function InvoiceReader({ docId, docName, importId, money, action }: { docId: string; docName: string; importId: string; money: boolean; action: Action }) {
  const [read, setRead] = useState<Read | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [rate, setRate] = useState("1");
  const [state, run] = useActionState(action, null);
  const started = useRef(false);
  const sheet = useSheet();

  async function go() {
    setRead(null);
    let r: Read;
    try {
      r = await readInvoiceDocument(docId);
    } catch {
      r = { ok: false, msg: "No se pudo leer el documento. Revisa la conexión e inténtalo de nuevo." };
    }
    if (r.ok) {
      setRows(r.proposal.lines.map((l) => ({
        include: true, name: l.match?.name ?? l.description, sku: l.sku ?? "", qty: String(Math.round(l.quantity)),
        price: l.unit_price !== null ? String(l.unit_price) : l.line_total !== null && l.quantity > 0 ? String(Math.round((l.line_total / l.quantity) * 10000) / 10000) : "",
        link: Boolean(l.match), match: l.match,
      })));
      setCharges(r.proposal.charges.map((c) => ({ include: true, label: c.label, kind: c.kind, amount: String(c.amount) })));
    }
    setRead(r);
  }
  useEffect(() => {
    if (started.current) return; // una sola lectura (cuesta)
    started.current = true;
    go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (state?.ok) sheet?.close();
  }, [state, sheet]);

  const currency = read?.ok ? (read.proposal.currency ?? "USD").toUpperCase() : "USD";
  const foreign = currency !== "USD";
  const r = foreign ? num(rate) : 1;
  const payload = useMemo(() => JSON.stringify({
    source: docName,
    lines: rows.filter((x) => x.include).map((x) => ({
      name: x.name, sku: x.sku || null, qty: num(x.qty),
      unit_cost: money && x.price ? unitUsd({ unit_price: num(x.price), line_total: null, quantity: num(x.qty) }, r) : null,
      account_id: x.link && x.match ? x.match.account_id : null, external_id: x.link && x.match ? x.match.external_id : null,
    })),
    charges: money ? charges.filter((c) => c.include).map((c) => ({ label: c.label, kind: c.kind, amount: Math.round((num(c.amount) / r) * 100) / 100 })) : [],
  }), [rows, charges, r, money, docName]);
  const nLines = rows.filter((x) => x.include).length;
  const nCharges = money ? charges.filter((c) => c.include).length : 0;
  const totalUsd = money
    ? rows.filter((x) => x.include).reduce((t, x) => t + (num(x.qty) || 0) * (unitUsd({ unit_price: num(x.price), line_total: null, quantity: num(x.qty) }, r) ?? 0), 0)
      + charges.filter((c) => c.include).reduce((t, c) => t + (num(c.amount) || 0) / (r || 1), 0)
    : 0;
  const badRate = foreign && money && !(r > 0);
  const set = (i: number, patch: Partial<Row>) => setRows((cur) => cur.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const setC = (i: number, patch: Partial<Charge>) => setCharges((cur) => cur.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  if (!read) {
    return (
      <div className="im-ai-wait" role="status">
        <span className="spinner" aria-hidden /> Leyendo <b>{docName}</b> con IA… puede tardar hasta un minuto.
      </div>
    );
  }
  if (!read.ok) {
    return (
      <div className="im-form">
        <p className="im-msg" data-ok="false" role="alert">{read.msg}</p>
        <button type="button" className="btn" onClick={go}>Intentar de nuevo</button>
      </div>
    );
  }
  const p = read.proposal;
  return (
    <StickyForm state={state} action={run} className="im-form im-ai">
      <input type="hidden" name="id" value={importId} />
      <input type="hidden" name="payload" value={payload} />
      <p className="im-ai-meta">
        {[p.supplier, p.invoice_number && `N.º ${p.invoice_number}`, p.invoice_date, currency].filter(Boolean).join(" · ")}
        <span className="sub"> · leída con IA, revisa antes de agregar</span>
      </p>
      {p.notes && <p className="im-notes">{p.notes}</p>}
      {read.existing > 0 && <p className="im-warn">La importación ya tiene {read.existing} {read.existing === 1 ? "producto" : "productos"}: estos se agregan aparte. Desmarca los que ya estén.</p>}
      {foreign && money && (
        <label className="field im-ai-rate">
          <span>Tipo de cambio <span className="hint">la factura está en {currency}; todo se registra en USD</span></span>
          <span className="im-inline">1 USD = <input className="input" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" aria-label={`${currency} por cada dólar`} /> {currency}</span>
        </label>
      )}
      {rows.length === 0 ? (
        <p className="muted im-small">No encontró productos en el documento.</p>
      ) : (
        <ul className="im-ai-lines">
          {rows.map((x, i) => {
            const u = money && x.price ? unitUsd({ unit_price: num(x.price), line_total: null, quantity: num(x.qty) }, r) : null;
            return (
              <li key={i} data-off={!x.include || undefined}>
                <label className="im-ai-check"><input type="checkbox" checked={x.include} onChange={(e) => set(i, { include: e.target.checked })} aria-label={`Agregar ${x.name}`} /></label>
                <div className="im-ai-main">
                  <input className="input" value={x.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Nombre del producto" disabled={x.link && Boolean(x.match)} />
                  <div className="im-ai-sub">
                    {x.match ? (
                      <label><input type="checkbox" checked={x.link} onChange={(e) => set(i, { link: e.target.checked, name: e.target.checked ? x.match!.name : x.name })} /> Es <b>{x.match.name}</b> de Drop</label>
                    ) : (
                      <span>Producto nuevo{x.sku && ` · SKU ${x.sku}`}</span>
                    )}
                  </div>
                </div>
                <label className="field"><span>Cantidad</span><input className="input" value={x.qty} onChange={(e) => set(i, { qty: e.target.value })} inputMode="numeric" /></label>
                {money && (
                  <label className="field">
                    <span>Precio ({currency})</span>
                    <input className="input" value={x.price} onChange={(e) => set(i, { price: e.target.value })} inputMode="decimal" />
                    {foreign && u !== null && <span className="hint">{usd(u)} c/u</span>}
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {money && charges.length > 0 && (
        <div className="im-ai-charges">
          <b>Cargos de la factura</b>
          {charges.map((c, i) => (
            <label key={i} className="im-ai-charge" data-off={!c.include || undefined}>
              <input type="checkbox" checked={c.include} onChange={(e) => setC(i, { include: e.target.checked })} />
              <span className="tag">{KIND[c.kind]}</span>
              <span className="grow">{c.label}</span>
              <input className="input" value={c.amount} onChange={(e) => setC(i, { amount: e.target.value })} inputMode="decimal" aria-label={`Monto de ${c.label} en ${currency}`} />
              <span className="sub">{currency}</span>
            </label>
          ))}
          <span className="hint">Se agregan como costos: el envío se reparte por unidades y el resto por valor (puedes cambiarlo después).</span>
        </div>
      )}
      {money && (nLines > 0 || nCharges > 0) && !badRate && <p className="im-ai-total">Total a agregar: <b>{usd(totalUsd)}</b>{p.total !== null && foreign && <span className="sub"> · factura: {p.total.toLocaleString("en-US")} {currency}</span>}</p>}
      {badRate && <p className="im-msg" data-ok="false">Escribe el tipo de cambio para pasar los precios a USD.</p>}
      {state && !state.ok && <p className="im-msg" data-ok="false" role="alert">{state.msg}</p>}
      <SubmitButton className="btn btn-primary" pending="Agregando…" disabled={badRate || (nLines === 0 && nCharges === 0)}>
        Agregar {[nLines && `${nLines} ${nLines === 1 ? "producto" : "productos"}`, nCharges && `${nCharges} ${nCharges === 1 ? "costo" : "costos"}`].filter(Boolean).join(" y ") || "nada"}
      </SubmitButton>
      <p className="im-pop-hint">Leída con {read.model}. La IA puede equivocarse: revisa cantidades y precios con la factura.</p>
    </StickyForm>
  );
}
