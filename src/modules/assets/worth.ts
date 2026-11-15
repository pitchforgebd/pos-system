import { Prisma } from "@prisma/client";

import type { AccountRole } from "@/core/ledger/roles";
import { decimalString, zero } from "@/core/money";
import { prisma } from "@/lib/db/client";

// "What the company owns and owes" (P09 task 7, feature 5): every figure is an account balance of the whole company (all branches), read from the
// books, so the card and the page always agree with the balance sheet. Each line links to the screen that explains it.

type Line = { key: string; label: string; amount: string; href: string };

const text = (value: Prisma.Decimal) => decimalString(value, 2);

/** Debit minus credit of the accounts that play each role, and of the accounts of each money kind. */
async function balances(organizationId: string) {
  const [byRole, byKind] = await Promise.all([
    prisma.$queryRaw<Array<{ role: string; net: Prisma.Decimal | null }>>`
      SELECT r.role AS role, SUM(l.debit - l.credit) AS net
      FROM journal_lines l
      JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED'
      JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId
      WHERE l.organizationId = ${organizationId}
      GROUP BY r.role
    `,
    prisma.$queryRaw<Array<{ kind: string; net: Prisma.Decimal | null }>>`
      SELECT a.kind AS kind, SUM(l.debit - l.credit) AS net
      FROM journal_lines l
      JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED'
      JOIN accounts a ON a.id = l.accountId AND a.kind IN ('CASH', 'BANK', 'MOBILE')
      WHERE l.organizationId = ${organizationId}
      GROUP BY a.kind
    `,
  ]);
  const role = new Map(byRole.map((row) => [row.role, new Prisma.Decimal(row.net ?? 0)]));
  const kind = new Map(byKind.map((row) => [row.kind, new Prisma.Decimal(row.net ?? 0)]));
  return { role: (name: AccountRole) => role.get(name) ?? zero(), kind: (name: string) => kind.get(name) ?? zero() };
}

export async function companyWorth(organizationId: string) {
  const b = await balances(organizationId);
  const owns: Array<{ key: string; label: string; value: Prisma.Decimal; href: string }> = [
    { key: "cash", label: "Cash", value: b.kind("CASH"), href: "/accounting/bank-cash" },
    { key: "bank", label: "Bank", value: b.kind("BANK"), href: "/accounting/bank-cash" },
    { key: "mobile", label: "Mobile banking", value: b.kind("MOBILE"), href: "/accounting/bank-cash" },
    { key: "customers", label: "Customers owe", value: b.role("AR"), href: "/customers" },
    { key: "couriers", label: "Couriers owe", value: b.role("COURIER_AR"), href: "/couriers" },
    { key: "vendorAdvances", label: "Paid to vendors in advance", value: b.role("VENDOR_ADVANCE"), href: "/suppliers" },
    { key: "stock", label: "Stock (at cost)", value: b.role("INVENTORY"), href: "/inventory/stock" },
    { key: "fixedAssets", label: "Fixed assets (after depreciation)", value: b.role("FIXED_ASSET").plus(b.role("ACCUM_DEPR")), href: "/accounting/assets" },
  ];
  const vat = b.role("OUTPUT_VAT").plus(b.role("INPUT_VAT")).neg();
  const owes: Array<{ key: string; label: string; value: Prisma.Decimal; href: string }> = [
    { key: "vendors", label: "Owed to vendors", value: b.role("AP").neg(), href: "/suppliers/ledger" },
    { key: "customerAdvances", label: "Customer advances", value: b.role("CUSTOMER_ADVANCE").neg(), href: "/customers/advances" },
    { key: "loans", label: "Loans", value: b.role("LOAN").neg(), href: "/accounting/loans" },
    { key: "vat", label: "VAT to pay", value: vat, href: "/accounting/statements" },
    { key: "accrued", label: "Expenses owed", value: b.role("ACCRUED").neg(), href: "/accounting/expenses" },
  ];
  const total = (list: typeof owns) => list.reduce((sum, line) => sum.plus(line.value), zero());
  const assets = total(owns);
  const liabilities = total(owes);
  const show = (list: typeof owns): Line[] => list.map((line) => ({ key: line.key, label: line.label, amount: text(line.value), href: line.href }));
  return { owns: show(owns), owes: show(owes), assets: text(assets), liabilities: text(liabilities), net: text(assets.minus(liabilities)) };
}
