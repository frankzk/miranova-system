import { AutoSelect } from "@/components/client";
import { requirePermission } from "@/lib/auth";
import { bankData } from "@/lib/reconciliation-data";
import { settlementData } from "@/lib/settlements-data";
import { COMPANIES, isCompany } from "@/lib/reconciliation";
import { PageHead } from "@/components/ui";
import { BankWorkspace } from "@/components/reconciliation-workspace";
import { ReconciliationTabs, SettlementsBoard } from "@/components/settlements-board";
import "./reconciliation.css";

export const metadata = { title: "Conciliación bancaria" };
export const maxDuration = 120;

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; v?: string }>;
}) {
  await requirePermission("reconciliation");
  const params = await searchParams;
  const company = isCompany(params.company) ? params.company : "miranova";
  const [data, liq] = await Promise.all([bankData(company), settlementData(company)]);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
  }).format(new Date());
  const movements = <BankWorkspace key={company} company={company} today={today} {...data} />;
  return (
    <div className="page bank-page">
      <PageHead
        title="Conciliación bancaria"
        sub="Cada liquidación de Drop con su comprobante y su abono en Mercury. En Movimientos, los registros uno a uno."
        actions={
          <form action="/reconciliation" method="get">
            <label className="field">
              <span>Empresa</span>
              <AutoSelect name="company" defaultValue={company}>
                {COMPANIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </AutoSelect>
            </label>
          </form>
        }
      />
      {liq.ready ? (
        <ReconciliationTabs
          key={company}
          initial={params.v === "mov" ? "mov" : "liq"}
          board={
            <SettlementsBoard
              company={company}
              today={today}
              settlements={liq.settlements}
              exempt={liq.exempt}
              sources={liq.sources}
              entries={data.entries}
              matches={data.matches}
              names={data.names}
            />
          }
          movements={movements}
        />
      ) : (
        movements
      )}
    </div>
  );
}
