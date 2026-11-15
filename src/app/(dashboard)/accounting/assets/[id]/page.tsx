import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DisposeForm } from "@/components/assets/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { getAsset } from "@/modules/assets/assets";
import { moneyPickerOptions } from "@/modules/treasury/dashboard";

export const metadata = { title: "Fixed Asset" };

const paidText: Record<string, string> = { CASH: "Paid in cash", BANK: "Paid from a bank", MOBILE: "Paid by mobile banking", CREDIT: "Owed to the vendor", OPENING: "Owned before the system (opening)" };

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { id } = await params;
  const asset = /^[0-9a-f-]{36}$/i.test(id) ? await getAsset(session.organizationId, id) : null;
  if (!asset) {
    notFound();
  }
  const canPost = session.permissions.has("accounting.post");
  const accounts = canPost && asset.status === "ACTIVE" ? await moneyPickerOptions(session.organizationId) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${asset.code} · ${asset.name}`}
        description={`${asset.categoryLabel}. ${asset.branch}${asset.location ? `, ${asset.location}` : ""}. ${asset.status === "ACTIVE" ? "In use." : `Disposed on ${asset.disposedOn}${asset.disposalAmount && asset.disposalAmount !== "0.00" ? ` for ${asset.disposalAmount}` : ""}.`}`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: "Fixed assets", href: "/accounting/assets" }, { label: asset.code }]}
      />
      <section className="grid gap-3 sm:grid-cols-4" aria-label="Figures">
        <Figure label="Cost" value={asset.cost} />
        <Figure label="Written off" value={asset.accumulated} />
        <Figure label="Worth now" value={asset.bookValue} />
        <Figure label="This month" value={asset.thisMonth} />
      </section>
      <dl className="grid max-w-3xl gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <dt className="text-muted">Bought on</dt>
        <dd>{asset.purchaseDate}</dd>
        <dt className="text-muted">How</dt>
        <dd>
          {paidText[asset.paidWith] ?? asset.paidWith}
          {asset.paidFrom ? ` (${asset.paidFrom})` : ""}
          {asset.vendor ? ` (${asset.vendor})` : ""}
        </dd>
        <dt className="text-muted">Useful life</dt>
        <dd>{asset.usefulLifeMonths} months, value left at the end {asset.salvageValue}</dd>
        <dt className="text-muted">Depreciation</dt>
        <dd>
          Straight line, {asset.monthly} a month, {asset.depreciationStartMonth} to {asset.depreciationEndMonth}
          {asset.isOpening ? ` (after ${asset.openingDepreciation} written off before)` : ""}
        </dd>
        {asset.note ? (
          <>
            <dt className="text-muted">Note</dt>
            <dd>{asset.note}</dd>
          </>
        ) : null}
        {asset.disposalNote ? (
          <>
            <dt className="text-muted">Disposal</dt>
            <dd>{asset.disposalNote}</dd>
          </>
        ) : null}
      </dl>
      <DataTable
        caption="In the books"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.date },
          { key: "ref", header: "Entry", cell: (row) => <Link href={`/accounting/journals/${row.journalId}`}>{row.reference}</Link> },
          { key: "account", header: "Account", cell: (row) => row.account },
          { key: "debit", header: "Debit", cell: (row) => (row.debit === "0.00" ? "" : row.debit) },
          { key: "credit", header: "Credit", cell: (row) => (row.credit === "0.00" ? "" : row.credit) },
        ]}
        rows={asset.lines}
        getRowKey={(row) => row.id}
      />
      {canPost && asset.status === "ACTIVE" ? (
        <section className="space-y-3" aria-label="Sell or write off">
          <h2 className="text-lg font-semibold">Sell or write off</h2>
          <p className="text-sm text-muted">Post this month&apos;s depreciation first if it should count. What it brings above what it is worth is other income; below it is a loss.</p>
          <DisposeForm assetId={asset.id} accounts={accounts.map((account) => ({ id: account.id, label: account.label }))} today={businessDate()} bookValue={asset.bookValue} />
        </section>
      ) : null}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
      {label}
      <span className="mt-1 block text-lg font-semibold">{value}</span>
    </p>
  );
}
