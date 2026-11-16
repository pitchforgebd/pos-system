import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ReverseForm } from "@/components/accounting/forms";
import { PrintSheet } from "@/components/print/document";
import { PrintButton } from "@/components/print/sheet";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { getJournal } from "@/modules/accounting/books";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Journal");

export default async function JournalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ph = await getPhrase();
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
        title={journal.number ?? ph("Journal")}
        description={`${journal.businessDate} · ${journal.description ?? ""} · ${journal.balanced ? "Debit equals credit" : "Not balanced"}`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Journals", href: "/accounting/journals" }, { label: journal.number ?? ph("Journal") }]}
        actions={<PrintButton label={ph("Print voucher")} />}
      />
      <PrintSheet title={journal.number ?? ph("Voucher")} note="Debit equals credit on a posted journal.">
        <p>{journal.businessDate}</p>
        {journal.description ? <p>{journal.description}</p> : null}
        {journal.lines.map((line) => (
          <p key={line.id}>
            {line.accountCode} {line.accountName} {ph("· Dr")} {line.debit} {ph("· Cr")} {line.credit}
          </p>
        ))}
      </PrintSheet>
      <DataTable
        caption={ph("Journal lines")}
        columns={[
          { key: "account", header: ph("Account"), cell: (row) => `${row.accountCode} · ${row.accountName}` },
          { key: "debit", header: ph("Debit"), cell: (row) => row.debit },
          { key: "credit", header: ph("Credit"), cell: (row) => row.credit },
        ]}
        rows={journal.lines}
        getRowKey={(row) => row.id}
      />
      {journal.reversals.length > 0 ? (
        <p className="text-sm">
          {ph("Reversed by")}{" "}
          {journal.reversals.map((reversal) => (
            <Link key={reversal.id} href={`/accounting/journals/${reversal.id}`}>{reversal.number ?? ph("reversal")}</Link>
          ))}
        </p>
      ) : null}
      {journal.reversible && session.permissions.has("accounting.reverse") ? <ReverseForm journalId={journal.id} /> : null}
    </div>
  );
}
