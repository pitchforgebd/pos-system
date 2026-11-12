import { notFound, redirect } from "next/navigation";

import { PurchaseForm, type PurchaseFormValues } from "@/components/purchasing/purchase-form";
import { PageHeader } from "@/components/ui/page-header";
import { businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { moneyAccountOptions, warehouseOptions } from "@/modules/purchasing/lookups";
import { getPurchase } from "@/modules/purchasing/purchases";
import { listSuppliers } from "@/modules/purchasing/suppliers";
import { prisma } from "@/lib/db/client";

export const metadata = { title: "Change purchase" };

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.branchId || !session.permissions.has("purchase.edit")) {
    redirect("/purchases");
  }
  const { id } = await params;
  const purchase = await getPurchase(session.organizationId, session.branchId, id);
  if (!purchase) {
    notFound();
  }
  if (purchase.status !== "DRAFT" && purchase.status !== "ORDERED") {
    redirect(`/purchases/${id}`);
  }
  const [suppliers, warehouses, accounts, products] = await Promise.all([
    listSuppliers(session.organizationId),
    warehouseOptions(session.organizationId, session.branchId),
    moneyAccountOptions(session.organizationId),
    prisma.product.findMany({ where: { id: { in: purchase.items.map((item) => item.productId) }, organizationId: session.organizationId }, select: { id: true, trackExpiry: true, trackSerial: true } }),
  ]);
  const tracked = new Map(products.map((product) => [product.id, product]));
  const initial: PurchaseFormValues = {
    id,
    status: purchase.status,
    supplierId: purchase.supplier.id,
    businessDate: purchase.businessDate,
    warehouseId: purchase.warehouseId ?? warehouses[0]?.id ?? "",
    supplierInvoiceNo: purchase.supplierInvoiceNo ?? "",
    note: purchase.note ?? "",
    headerDiscount: purchase.headerDiscount === "0.00" ? "" : purchase.headerDiscount,
    transportCost: purchase.transportCost === "0.00" ? "" : purchase.transportCost,
    otherCost: purchase.otherCost === "0.00" ? "" : purchase.otherCost,
    transporterId: purchase.transporter?.id ?? "",
    vehicleNo: purchase.vehicleNo ?? "",
    transportPaidWith: (purchase.transportPaidWith as PurchaseFormValues["transportPaidWith"] | null) ?? "CASH",
    lines: purchase.items.map((item) => ({
      productId: item.productId,
      label: `${item.sku} · ${item.name}`,
      trackExpiry: tracked.get(item.productId)?.trackExpiry ?? false,
      trackSerial: tracked.get(item.productId)?.trackSerial ?? false,
      quantity: item.quantity,
      unitCost: item.unitCost,
      discount: item.discount === "0.00" ? "" : item.discount,
      vatRate: item.vatRate === "0.00" ? "" : item.vatRate,
      lot: item.lot ?? "",
      manufacturedOn: item.manufacturedOn ?? "",
      expiresOn: item.expiresOn ?? "",
      serials: item.serials.join("\n"),
    })),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Change ${purchase.number ?? "draft purchase"}`}
        description="Nothing has been posted for this purchase yet, so its lines and figures can still change."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Purchases", href: "/purchases" }, { label: purchase.number ?? "Draft", href: `/purchases/${id}` }, { label: "Change" }]}
      />
      <PurchaseForm
        today={businessDate()}
        initial={initial}
        suppliers={suppliers.filter((supplier) => supplier.status === "ACTIVE" || supplier.id === purchase.supplier.id).map((supplier) => ({ id: supplier.id, label: supplier.name }))}
        warehouses={warehouses.map((warehouse) => ({ id: warehouse.id, label: warehouse.name }))}
        accounts={accounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}`, kind: account.kind }))}
      />
    </div>
  );
}
