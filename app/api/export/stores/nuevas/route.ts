import { NextResponse, type NextRequest } from "next/server";
import { authorizeRoute } from "@/lib/auth";
import { listAccounts } from "@/lib/accounts";
import { contactKey, contactsByStore, storeProfiles } from "@/lib/contacts";
import { todayIn } from "@/lib/format";
import { getScope } from "@/lib/scope";
import { entered, filterSignups, localDay, signupPeriod, toSignups } from "@/lib/signups";
import { buildXlsx, XLSX_TYPE, type Cell } from "@/lib/xlsx";

// Exporta Tiendas nuevas a Excel con el mismo período, búsqueda y cuenta de la página: fecha de
// ingreso, tienda, dueño y correo, para cotejar referidos.

export async function GET(req: NextRequest) {
  const user = await authorizeRoute("stores", "export");
  if (user instanceof Response) return user;
  const accounts = await listAccounts();
  const scope = await getScope(accounts);
  const tzOf = (id: string) => accounts.find((a) => a.id === id)?.timezone ?? scope.tz;
  const today = todayIn(scope.tz);

  const sp = req.nextUrl.searchParams;
  const get = (k: string) => sp.get(k)?.trim() || undefined;
  const { bounds } = signupPeriod({ p: get("p"), from: get("from"), to: get("to") }, today);
  const q = get("q")?.slice(0, 80);

  const [profiles, contacts] = await Promise.all([storeProfiles(), contactsByStore()]);
  const rows = filterSignups(
    toSignups(entered(profiles.filter((p) => !scope.account || p.account_id === scope.account)), (p) => contacts.get(contactKey(p))),
    { ...bounds, q },
    tzOf,
  );

  const book = buildXlsx([
    {
      name: "Tiendas nuevas",
      columns: [
        { header: "Fecha de ingreso", width: 14 },
        { header: "Tienda", width: 30 },
        { header: "Dueño", width: 28 },
        { header: "Correo de la tienda", width: 34 },
        { header: "Origen del correo", width: 22 },
        { header: "Cuenta", width: 18 },
      ],
      rows: rows.map((r): Cell[] => [
        localDay(r.first_at, tzOf(r.account_id)),
        r.name,
        r.person,
        r.email,
        r.emailSource === "contacto" ? "Contacto de la tienda" : r.emailSource === "pedidos" ? "Detectado en los pedidos" : null,
        r.account_name,
      ]),
    },
  ]);

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(book), {
    headers: {
      "content-type": XLSX_TYPE,
      "content-disposition": `attachment; filename="tiendas-nuevas-miranova-${stamp}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
