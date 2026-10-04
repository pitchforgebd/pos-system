"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { EntryForm } from "@/components/screens/entry-form";
import { PosScreen } from "@/components/screens/pos-screen";
import { RecordBrowser } from "@/components/screens/record-browser";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { MoneyDisplay } from "@/components/ui/money-display";
import { PageHeader } from "@/components/ui/page-header";
import { PrintPreview } from "@/components/ui/print-preview";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import type { MockRow, ScreenSpec } from "@/lib/screens/types";

const moneyKeys = new Set(["total", "due", "price", "amount", "balance", "payable", "value", "opening", "expected"]);

export function ModuleScreen({
  spec,
  nav,
  crumbs,
  view,
  record,
  detailBase,
}: {
  spec: ScreenSpec;
  nav: { href: string; label: string }[];
  crumbs: { label: string; href?: string }[];
  view: "ready" | "loading" | "empty" | "error";
  record: MockRow | null;
  detailBase?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [tab, setTab] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const activeTab = spec.tabs?.[tab];
  const columns = activeTab?.columns ?? spec.columns ?? [];
  const rows = activeTab?.rows ?? spec.rows ?? [];
  const recordColumns = record
    ? Object.keys(record).map((key) => ({
        key,
        header: key,
        kind: moneyKeys.has(key) ? ("money" as const) : key === "date" || key.endsWith("Date") ? ("date" as const) : ("text" as const),
      }))
    : [];
  const tableColumns = spec.kind === "detail" ? (spec.lineColumns ?? recordColumns) : columns;
  const tableRows = spec.kind === "detail" ? (spec.lineRows ?? (record ? [record] : [])) : rows;
  const currentNav = nav
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;
  const retry = () => router.push(spec.kind === "detail" && record ? pathname : spec.path);

  if (view === "loading") {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (view === "error") {
    return <ErrorState title="This screen could not be shown" description="The sample screen failed to render. Nothing was changed." onRetry={retry} />;
  }

  if (view === "empty" && spec.kind !== "list" && spec.kind !== "import") {
    return <EmptyState title="Nothing to show" description="This preview hides the sample content." />;
  }

  const headerAction = (() => {
    if (spec.kind === "pos") {
      return <Button href="/pos/open-tickets">Open tickets</Button>;
    }
    if (spec.kind === "form" || spec.kind === "settings") {
      return (
        <Button type="submit" form="screen-form">
          {spec.cta}
        </Button>
      );
    }
    if (spec.ctaHref) {
      return <Button href={spec.ctaHref}>{spec.cta}</Button>;
    }
    if (spec.kind === "import") {
      return <Button onClick={() => document.getElementById("import-file")?.click()}>{spec.cta}</Button>;
    }
    if (spec.fields) {
      return <Button onClick={() => setDrawerOpen(true)}>{spec.cta}</Button>;
    }
    if (spec.kind === "detail") {
      return <Button onClick={() => setPrintOpen(true)}>{spec.cta}</Button>;
    }
    return null;
  })();

  const printCustomer = String(record?.customer ?? record?.supplier ?? record?.name ?? "Sample");
  const printTotal = typeof record?.total === "number" ? record.total : typeof record?.price === "number" ? record.price : 0;
  const printDate = typeof record?.date === "string" ? record.date : "2026-09-30";

  return (
    <div className="space-y-6">
      <Alert tone="info" title="Sample data">
        Records on this screen are for layout review. Nothing is saved.
      </Alert>
      <PageHeader title={record ? String(record.id) : spec.title} description={spec.description} breadcrumbs={crumbs} actions={headerAction} />
      {nav.length > 1 ? (
        <nav aria-label="Section" className="-mx-1 flex gap-1 overflow-x-auto border-b border-border">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.href === currentNav ? "page" : undefined}
              className={cn(
                "shrink-0 border-b-2 px-3 py-2 text-sm",
                item.href === currentNav ? "border-primary font-medium text-text" : "border-transparent text-muted",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}
      {spec.stats ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {spec.stats.map((stat) => (
            <article key={stat.label} className="rounded-md border border-border bg-surface p-4">
              <p className="text-sm text-muted">{stat.label}</p>
              <p className="mt-2 text-xl font-semibold">{stat.value}</p>
            </article>
          ))}
        </section>
      ) : null}
      {spec.links ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {spec.links.map((link) => (
            <Link key={link.href} href={link.href} className="rounded-md border border-border bg-surface p-4 hover:bg-secondary">
              <span className="block text-sm font-medium">{link.label}</span>
              <span className="mt-1 block text-sm text-muted">{link.description}</span>
            </Link>
          ))}
        </section>
      ) : null}
      {spec.kind === "pos" ? <PosScreen /> : null}
      {spec.kind === "import" ? (
        <FormField label="CSV file" htmlFor="import-file" hint="The file stays on this page.">
          <Input
            id="import-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) {
                setImportNote(null);
                return;
              }
              const allowed = file.name.toLowerCase().endsWith(".csv");
              setImportNote(allowed ? `${file.name} was not imported.` : "Choose a CSV file.");
            }}
          />
          {importNote ? <Alert tone={importNote.endsWith("not imported.") ? "info" : "error"} title={importNote} /> : null}
        </FormField>
      ) : null}
      {(spec.kind === "form" || spec.kind === "settings") && spec.fields ? (
        <div className="max-w-xl rounded-md border border-border bg-surface p-4">
          <EntryForm fields={spec.fields} submitLabel={spec.cta} />
        </div>
      ) : null}
      {spec.tabs ? (
        <div className="flex flex-wrap gap-2">
          {spec.tabs.map((item, index) => (
            <Button key={item.label} size="sm" variant={index === tab ? "primary" : "secondary"} onClick={() => setTab(index)}>
              {item.label}
            </Button>
          ))}
        </div>
      ) : null}
      {spec.kind === "detail" && record && spec.lineColumns ? (
        <section className="grid gap-3 rounded-md border border-border bg-surface p-4 sm:grid-cols-2">
          {Object.entries(record).map(([key, value]) => (
            <div key={key}>
              <p className="text-xs text-muted">{key}</p>
              <p className="text-sm font-medium">
                {typeof value === "number" && moneyKeys.has(key) ? <MoneyDisplay amount={value} /> : String(value)}
              </p>
            </div>
          ))}
        </section>
      ) : null}
      {tableColumns.length > 0 ? (
        <RecordBrowser
          caption={spec.title}
          columns={tableColumns}
          rows={tableRows}
          view={view === "empty" ? "empty" : "ready"}
          detailBase={spec.kind === "list" ? detailBase : undefined}
          onRetry={retry}
        />
      ) : null}
      {spec.fields && spec.kind !== "form" && spec.kind !== "settings" ? (
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} title={spec.cta} description="Checking the fields does not save a record.">
          <EntryForm fields={spec.fields} submitLabel="Check fields" formId="drawer-form" onCancel={() => setDrawerOpen(false)} />
        </Drawer>
      ) : null}
      <Modal open={printOpen} onOpenChange={setPrintOpen} title="Print preview" description="Layout only. This does not create a document.">
        {record ? (
          <div className="space-y-4">
            <PrintPreview invoice={String(record.id)} date={printDate} customer={printCustomer} total={printTotal} />
            <div className="flex justify-end print:hidden">
              <Button onClick={() => window.print()}>Print</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
