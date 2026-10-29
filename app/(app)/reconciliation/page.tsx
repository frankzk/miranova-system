import { AutoSelect } from "@/components/client";
import { requirePermission } from "@/lib/auth";
import { bankData } from "@/lib/reconciliation-data";
import { COMPANIES, isCompany } from "@/lib/reconciliation";
import { PageHead } from "@/components/ui";
import { BankWorkspace } from "@/components/reconciliation-workspace";
import "./reconciliation.css";

export const metadata = { title: "Conciliación bancaria" };
export const maxDuration = 120;

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  await requirePermission("reconciliation");
  const params = await searchParams;
  const company = isCompany(params.company) ? params.company : "miranova";
  const data = await bankData(company);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
  }).format(new Date());
  return (
    <div className="page bank-page">
      <PageHead
        title="Conciliación bancaria"
        sub="Registra los abonos de Mercury y las transferencias de Boxful. Vincúlalos uno a uno."
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
      <BankWorkspace key={company} company={company} today={today} {...data} />
    </div>
  );
}
