import Link from "next/link";
import { redirect } from "next/navigation";

import { AssetForm } from "@/components/assets/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { CATEGORIES, assetRegister, vendorOptions } from "@/modules/assets/assets";
import { moneyPickerOptions } from "@/modules/treasury/dashboard";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Fixed Assets");

const label = (value: string) => CATEGORIES.find((category) => category.value === value)?.label ?? value;

export default async function AssetsPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const canPost = session.permissions.has("accounting.post");
  const [register, accounts, vendors] = await Promise.all([assetRegister(session.organizationId), canPost ? moneyPickerOptions(session.organizationId) : [], canPost ? vendorOptions(session.organizationId) : []]);

  return (
    <div className="space-y-8">
      <PageHeader
        title={ph("Fixed assets")}
        description={ph("The shop's vehicles, furniture, computers and equipment: what each cost, what has been written off and what it is worth now, all from the books.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: ph("Fixed assets") }]}
        actions={
          <>
            <Link href="/accounting/depreciation" className="text-sm font-medium text-primary">
              {ph("Monthly depreciation")}
            </Link>
            <Link href="/accounting/worth" className="text-sm font-medium text-primary">
              {ph("Company worth")}
            </Link>
          </>
        }
      />
      <section className="grid gap-3 sm:grid-cols-4" aria-label={ph("Totals")}>
        <Figure label={ph("Assets in use")} value={String(register.totals.count)} />
        <Figure label={ph("Cost")} value={register.totals.cost} />
        <Figure label={ph("Written off")} value={register.totals.accumulated} />
        <Figure label={ph("Worth now")} value={register.totals.bookValue} />
      </section>
      {register.byCategory.length > 0 ? (
        <DataTable
          caption={ph("By category")}
          columns={[
            { key: "category", header: ph("Category"), cell: (row) => row.label },
            { key: "count", header: ph("Assets"), cell: (row) => row.count },
            { key: "cost", header: ph("Cost"), cell: (row) => row.cost },
            { key: "accumulated", header: ph("Written off"), cell: (row) => row.accumulated },
            { key: "bookValue", header: ph("Worth now"), cell: (row) => row.bookValue },
          ]}
          rows={register.byCategory}
          getRowKey={(row) => row.category}
        />
      ) : null}
      <DataTable
        caption={ph("Register")}
        columns={[
          { key: "code", header: ph("Code"), cell: (row) => <Link href={`/accounting/assets/${row.id}`}>{row.code}</Link> },
          { key: "name", header: ph("Asset"), cell: (row) => row.name },
          { key: "category", header: ph("Category"), cell: (row) => label(row.category) },
          { key: "where", header: ph("Where"), cell: (row) => [row.branch, row.location].filter(Boolean).join(" · ") },
          { key: "bought", header: ph("Bought"), cell: (row) => row.purchaseDate },
          { key: "cost", header: ph("Cost"), cell: (row) => row.cost },
          { key: "accumulated", header: ph("Written off"), cell: (row) => row.accumulated },
          { key: "bookValue", header: ph("Worth now"), cell: (row) => row.bookValue },
          { key: "status", header: ph("Status"), cell: (row) => (row.status === "ACTIVE" ? "In use" : `Disposed ${row.disposedOn ?? ""}`) },
        ]}
        rows={register.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No fixed assets")} description={ph("Add the shop's vehicles, furniture, computers and equipment.")} />}
      />
      {canPost ? (
        <section className="space-y-3" aria-label={ph("Add an asset")}>
          <h2 className="text-lg font-semibold">{ph("Add an asset")}</h2>
          <AssetForm categories={[...CATEGORIES]} accounts={accounts.map((account) => ({ id: account.id, label: account.label }))} vendors={vendors} today={businessDate()} />
        </section>
      ) : null}
    </div>
  );
}

function Figure({ label: title, value }: { label: string; value: string }) {
  return (
    <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
      {title}
      <span className="mt-1 block text-lg font-semibold">{value}</span>
    </p>
  );
}
