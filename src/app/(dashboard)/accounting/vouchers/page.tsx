import Link from "next/link";
import { redirect } from "next/navigation";

import { CashVoucherForm, ContraForm } from "@/components/accounting/forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { GROUP } from "@/core/ledger/groups";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listAccounts, listVouchers } from "@/modules/accounting/books";

export const metadata = { title: "Vouchers" };

const voucherTypes = ["JOURNAL", "CONTRA", "PAYMENT", "RECEIPT"] as const;

export default async function VouchersPage({ searchParams }: { searchParams: Promise<{ type?: string; q?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const type = voucherTypes.find((item) => item === params.type) ?? "";
  const q = params.q?.trim().toLowerCase() ?? "";
  const [accounts, voucherRows] = await Promise.all([
    listAccounts(session.organizationId),
    listVouchers(session.organizationId, session.branchId),
  ]);
  const moneyAccounts = accounts
    .filter((account) => account.status === "ACTIVE" && ["CASH", "BANK", "MOBILE"].includes(account.kind))
    .map((account) => ({ code: account.code, kind: account.kind, label: `${account.code} · ${account.name}` }));
  const voucherAccounts = accounts
    .filter((account) => account.status === "ACTIVE" && account.kind === "OTHER" && [GROUP.LIABILITY, GROUP.EQUITY, GROUP.REVENUE, GROUP.EXPENSE].some((code) => code === account.groupCode) && !account.roles.some((role) => ["CASH", "AR", "INVENTORY", "AP", "SALES", "COGS"].includes(role)))
    .map((account) => ({ code: account.code, label: `${account.code} · ${account.name}` }));
  const vouchers = voucherRows.filter((row) => {
    if (type && row.voucherType !== type) {
      return false;
    }
    if (!q) {
      return true;
    }
    return `${row.number ?? ""} ${row.voucherType}`.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vouchers"
        description="A payment credits cash or bank. A receipt debits cash or bank. Customer dues and supplier payables stay on their own screens."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: "Vouchers" }]}
      />
      {session.permissions.has("accounting.post") ? (
        <>
          <ContraForm />
          <CashVoucherForm accounts={voucherAccounts} moneyAccounts={moneyAccounts} />
        </>
      ) : null}
      <form className="flex flex-wrap items-end gap-2" action="/accounting/vouchers">
        <label className="grid gap-1 text-sm">
          Type
          <select name="type" defaultValue={type} className="h-10 rounded-md border border-border bg-surface px-2">
            <option value="">All</option>
            {voucherTypes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          Search
          <input name="q" defaultValue={params.q ?? ""} placeholder="Number or type" className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      <DataTable
        caption="Vouchers"
        columns={[
          { key: "number", header: "Voucher", cell: (row) => row.journalId ? <Link href={`/accounting/journals/${row.journalId}`}>{row.number}</Link> : row.number },
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "type", header: "Type", cell: (row) => row.voucherType },
          { key: "amount", header: "Amount", cell: (row) => row.amount },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={vouchers}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No vouchers" description="Post a payment, a receipt, a journal, or a cash and bank transfer." />}
      />
    </div>
  );
}
