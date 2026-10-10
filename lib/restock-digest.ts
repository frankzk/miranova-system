import { importsDigest, statusInfo, type DigestImport } from "./imports.ts";
import { dayLabel, reorderPlan, shortDate, urgency, type InventoryRow, type ReorderPlan, type Supply } from "./inventory.ts";

// Resumen diario por correo de "qué pedir hoy": agotados, pedir hoy, pedir esta semana, pedidos
// atrasados e importaciones (atrasadas, que llegan esta semana y sin avisar a la bodega).
// Puro (sin red ni base de datos) para probarlo; lo envía app/api/cron/restock-digest.

export type DigestLine = { row: InventoryRow; plan: ReorderPlan };
export type Digest = {
  subject: string;
  html: string;
  text: string;
  counts: { out: number; now: number; soon: number; late: number; imports: number };
  /** nada que pedir, ni pedidos atrasados, ni importaciones que mirar: no hace falta enviarlo */
  empty: boolean;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const u = (n: number) => `${n.toLocaleString("en-US")} u.`;
const rate = (n: number) => (n >= 10 ? String(Math.round(n)) : n.toFixed(1));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Direcciones de correo válidas de una lista separada por comas, punto y coma o espacios. */
export function parseRecipients(v: string | undefined | null): string[] {
  const seen = new Set<string>();
  for (const raw of (v ?? "").split(/[,;\s]+/)) {
    const e = raw.trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) seen.add(e);
  }
  return [...seen];
}

/** Qué hacer con cada producto, en una frase corta. */
function action({ plan: p }: DigestLine, today: string): string {
  const eta = p.open.map((o) => o.eta).filter((e): e is string => Boolean(e)).sort()[0];
  const coming = p.inTransit ? `vienen ${u(p.inTransit)}${eta ? ` (llegada ${dayLabel(eta, today)})` : ""}` : "";
  if (p.level === "out") return p.needsOrder ? `pedir ya ${u(p.qty)}${coming ? `; ${coming}` : ""}` : coming || "reponer";
  if (p.level === "now") return `pedir hoy ${u(p.qty)}${coming ? `; ${coming}` : ""}`;
  const by = dayLabel(p.orderBy!, today);
  return `pedir ${by === "hoy" || by === "mañana" ? by : `antes del ${by}`} ${u(p.qty)}`;
}

function detail({ row: r, plan: p }: DigestLine): string {
  const parts = [`${u(r.stock)} en existencia`];
  if (p.demand > 0) parts.push(`vende ${rate(p.demand)}/día`);
  parts.push(`tarda ${plural(p.lead, "día", "días")}`);
  if (p.gapDays) parts.push(`se agota ${plural(p.gapDays, "día", "días")} antes de que llegue`);
  return parts.join(" · ");
}

export function restockDigest(rows: InventoryRow[], supply: Supply, today: string, link: string, imports: DigestImport[] = [], countryName: (c: string) => string = (c) => c): Digest {
  const lines = rows
    .map((row) => ({ row, plan: reorderPlan(row, supply, today) }))
    .sort((a, b) => urgency(a.plan) - urgency(b.plan) || b.plan.demand - a.plan.demand);
  const out = lines.filter((l) => l.plan.level === "out" && (l.plan.demand > 0 || l.row.pending_orders > 0));
  const now = lines.filter((l) => l.plan.level === "now");
  const soon = lines.filter((l) => l.plan.level === "soon");
  // las importaciones atrasadas van en su propia sección (una vez por importación, no por producto)
  const late = lines.flatMap((l) => l.plan.open.filter((o) => o.status === "late" && !o.import).map((o) => ({ ...l, order: o })));
  const imp = importsDigest(imports, today);
  const impCount = new Set([...imp.late, ...imp.week, ...imp.unreported].map((i) => i.id)).size;
  const counts = { out: out.length, now: now.length, soon: soon.length, late: late.length, imports: impCount };
  const restockEmpty = !out.length && !now.length && !soon.length && !late.length;
  const empty = restockEmpty && !impCount;

  const head = [
    counts.out && plural(counts.out, "agotado", "agotados"),
    counts.now && `${counts.now} para pedir hoy`,
    counts.soon && `${counts.soon} esta semana`,
    counts.late && plural(counts.late, "pedido atrasado", "pedidos atrasados"),
    imp.late.length && plural(imp.late.length, "importación atrasada", "importaciones atrasadas"),
    imp.week.length && `${plural(imp.week.length, "importación llega", "importaciones llegan")} esta semana`,
    imp.unreported.length && `${imp.unreported.length} sin avisar a la bodega`,
  ].filter(Boolean).join(", ");
  const date = shortDate(today);
  const subject = empty ? `Inventario al día · ${date}` : restockEmpty ? `Importaciones · ${head}` : `Qué pedir hoy · ${head}`;
  const impItem = (i: DigestImport, act: string) => ({
    name: `${i.code}${i.supplier ? ` · ${i.supplier}` : ""}`,
    account: countryName(i.dest_country),
    act,
    meta: [`${u(i.units)}`, statusInfo(i.status).label, i.reported_at ? "bodega avisada" : "falta avisar a la bodega"].join(" · "),
  });

  const sections: { title: string; tone: string; items: { name: string; account: string; act: string; meta: string }[] }[] = [
    { title: "Agotados", tone: "#e5424d", items: out.map((l) => ({ name: l.row.name, account: l.row.account_name, act: action(l, today), meta: detail(l) })) },
    { title: "Pedir hoy", tone: "#e5424d", items: now.map((l) => ({ name: l.row.name, account: l.row.account_name, act: action(l, today), meta: detail(l) })) },
    { title: "Pedir esta semana", tone: "#e5850b", items: soon.map((l) => ({ name: l.row.name, account: l.row.account_name, act: action(l, today), meta: detail(l) })) },
    {
      title: "Pedidos atrasados", tone: "#e5850b",
      items: late.map((l) => ({
        name: l.row.name, account: l.row.account_name,
        act: `${u(l.order.units)} sin llegar`,
        meta: `pedido el ${shortDate(l.order.ordered_at)}${l.order.eta ? ` · llegaba el ${shortDate(l.order.eta)}` : ""}${l.order.note ? ` · ${l.order.note}` : ""}`,
      })),
    },
    { title: "Importaciones atrasadas", tone: "#e5850b", items: imp.late.map((i) => impItem(i, `llegaba el ${shortDate(i.eta!)}`)) },
    { title: "Importaciones que llegan esta semana", tone: "#0570de", items: imp.week.map((i) => impItem(i, `llega ${dayLabel(i.eta!, today)}`)) },
    {
      title: "Sin avisar a la bodega", tone: "#e5424d",
      items: imp.unreported.map((i) => impItem(i, `avisar a la bodega por WhatsApp (llega ${i.eta! < today ? "con retraso" : dayLabel(i.eta!, today)})`)),
    },
  ].filter((s) => s.items.length > 0);

  const url = `${link.replace(/\/$/, "")}/products/inventory`;
  const impUrl = `${link.replace(/\/$/, "")}/imports`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0a2540">
<div style="max-width:640px;margin:0 auto;padding:24px 16px">
<p style="margin:0 0 4px;font-size:13px;color:#5f6b7a">Miranova · Inventario · ${esc(date)}</p>
<h1 style="margin:0 0 6px;font-size:22px;line-height:1.3">${empty ? "Todo al día" : restockEmpty ? "Importaciones" : "Qué pedir hoy"}</h1>
<p style="margin:0 0 20px;font-size:14px;color:#425466">${empty ? "Ningún producto llegó a su punto de pedido." : esc(head)}.${restockEmpty ? "" : " Las cantidades cubren lo que tarda en llegar, un colchón y 30 días de venta."}</p>
${sections.map((s) => `<div style="background:#ffffff;border:1px solid #e3e8ee;border-radius:10px;margin:0 0 16px;overflow:hidden">
<p style="margin:0;padding:12px 16px;font-size:14px;font-weight:600;border-bottom:1px solid #e3e8ee"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${s.tone};margin-right:8px"></span>${esc(s.title)} · ${s.items.length}</p>
${s.items.map((it, i) => `<div style="padding:12px 16px;${i ? "border-top:1px solid #eef1f4;" : ""}">
<p style="margin:0;font-size:14px;font-weight:600">${esc(it.name)}</p>
<p style="margin:2px 0 0;font-size:14px;color:#0a2540"><strong>${esc(it.act)}</strong> <span style="color:#5f6b7a">· ${esc(it.account)}</span></p>
<p style="margin:2px 0 0;font-size:13px;color:#5f6b7a">${esc(it.meta)}</p>
</div>`).join("\n")}
</div>`).join("\n")}
<p style="margin:20px 0 8px"><a href="${esc(url)}" style="display:inline-block;background:#635bff;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:8px">Abrir Inventario</a>${impCount ? ` <a href="${esc(impUrl)}" style="display:inline-block;margin-left:8px;color:#635bff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 4px">Ver importaciones</a>` : ""}</p>
<p style="margin:16px 0 0;font-size:12px;color:#8792a2">Al pedir, marca “Ya lo pedí” en el panel: el producto deja de aparecer aquí mientras viene en camino.</p>
</div></body></html>`;

  const text = [
    `${empty ? "Todo al día" : restockEmpty ? "Importaciones" : "Qué pedir hoy"} · ${date}`,
    empty ? "Ningún producto llegó a su punto de pedido." : head,
    "",
    ...sections.flatMap((s) => [`${s.title.toUpperCase()} (${s.items.length})`, ...s.items.map((it) => `- ${it.name} (${it.account}): ${it.act}${it.act.endsWith(".") ? "" : "."} ${it.meta}`), ""]),
    `Abrir Inventario: ${url}`,
    ...(impCount ? [`Ver importaciones: ${impUrl}`] : []),
    "Al pedir, marca “Ya lo pedí” en el panel.",
  ].join("\n");

  return { subject, html, text, counts, empty };
}
