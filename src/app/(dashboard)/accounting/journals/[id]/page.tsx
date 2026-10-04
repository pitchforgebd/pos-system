import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ReverseForm } from "@/components/accounting/forms";
import { PrintButton, PrintSheet } from "@/components/print/sheet";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { getJournal } from "@/modules/accounting/books";

export const metadata = { title: "Journal" };

export default async function JournalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { id } = await params;
  const journal = await getJournal(session.organizationId, session.branchId, id);
  if (!journal) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={journal.number ?? "Journal"}
        description={`${journal.occurredOn} · ${journal.description ?? ""} · ${journal.balanced ? "Debit equals credit" : "Not balanced"}`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Journals", href: "/accounting/journals" }, { label: journal.number ?? "Journal" }]}
        actions={<PrintButton label="Print voucher" />}
      />
      <PrintSheet title={journal.number ?? "Voucher"} note="Debit equals credit on a posted journal.">
        <p>{journal.occurredOn}</p>
        {journal.description ? <p>{journal.description}</p> : null}
        {journal.lines.map((line) => (
          <p key={line.id}>
            {line.accountCode} {line.accountName} · Dr {line.debit} · Cr {line.credit}
          </p>
        ))}
      </PrintSheet>
      <DataTable
        caption="Journal lines"
        columns={[
          { key: "account", header: "Account", cell: (row) => `${row.accountCode} · ${row.accountName}` },
          { key: "debit", header: "Debit", cell: (row) => row.debit },
          { key: "credit", header: "Credit", cell: (row) => row.credit },
        ]}
        rows={journal.lines}
        getRowKey={(row) => row.id}
      />
      {journal.reversals.length > 0 ? (
        <p className="text-sm">
          Reversed by{" "}
          {journal.reversals.map((reversal) => (
            <Link key={reversal.id} href={`/accounting/journals/${reversal.id}`}>{reversal.number ?? "reversal"}</Link>
          ))}
        </p>
      ) : null}
      {journal.reversible && session.permissions.has("accounting.reverse") ? <ReverseForm journalId={journal.id} /> : null}
    </div>
  );
}
