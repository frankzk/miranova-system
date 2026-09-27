import Link from "next/link";
import { notFound } from "next/navigation";
import { IconChevronLeft } from "@/components/icons";
import { OrderDetailView } from "@/components/order-detail";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getOrder } from "@/lib/queries";

export const metadata = { title: "Orden" };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("orders");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const o = await getOrder(id);
  if (!o) notFound();

  return (
    <div className="page page-narrow">
      <div className="crumbs">
        <Link href="/orders"><IconChevronLeft style={{ verticalAlign: -3 }} /> Órdenes</Link>
      </div>
      <div className="panel" style={{ overflow: "hidden" }}>
        <OrderDetailView o={o} showPaid={can(user, "money")} showRaw={can(user, "accounts")} />
      </div>
    </div>
  );
}
