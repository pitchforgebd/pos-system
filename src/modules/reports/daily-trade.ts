import { Prisma } from "@prisma/client";

import { GROUP } from "@/core/ledger/groups";
import { paymentStatuses } from "@/core/payments";
import { addDays, dateOnly } from "@/core/time/business-date";
import { prisma } from "@/lib/db/client";
import { alertStatus } from "@/modules/inventory/stock";
import { accountTotals, chart, col, day, dayBefore, dec, docBranches, hasRole, identity, lineBranches, money, netOf, sumOf, t, ZERO, type ReportCtx, type ReportResult } from "@/modules/reports/kit";

// The trade reports (05 #1, #2, #3, #4, #7, #8): sales, stock, what customers and vendors owe, what couriers owe, profit and loss, expenses. Each
// ends with its identities against the ledger.

const window = (ctx: ReportCtx) => ({ gte: day(ctx.from), lte: day(ctx.to) });

// ---- 1. sales -----------------------------------------------------------------------------------------------------------------------------

export async function salesDayReport(ctx: ReportCtx): Promise<ReportResult> {
  const sales = await prisma.sale.findMany({
    where: { organizationId: ctx.organizationId, status: "POSTED", businessDate: window(ctx), ...docBranches(ctx) },
    orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      createdAt: true,
      businessDate: true,
      subtotal: true,
      discountTotal: true,
      vatTotal: true,
      chargesTotal: true,
      total: true,
      priceLevelId: true,
      invoice: { select: { number: true } },
      customer: { select: { name: true, isSystem: true, district: { select: { name: true } } } },
      order: { select: { channel: true } },
      items: { select: { quantity: true, unitCost: true, lineTotal: true, vatAmount: true, product: { select: { name: true, category: { select: { name: true } } } } } },
    },
  });
  const ids = sales.map((sale) => sale.id);
  const [status, allocations, levels, returns, methods, salesCredit] = await Promise.all([
    paymentStatuses(prisma, ctx.organizationId, "CUSTOMER", sales.map((sale) => ({ id: sale.id, total: sale.total }))),
    ids.length > 0 ? prisma.paymentAllocation.findMany({ where: { organizationId: ctx.organizationId, invoiceId: { in: ids } }, select: { invoiceId: true, amount: true, journal: { select: { businessDate: true } } } }) : [],
    prisma.priceLevel.findMany({ where: { organizationId: ctx.organizationId }, select: { id: true, name: true } }),
    prisma.saleReturn.aggregate({ where: { organizationId: ctx.organizationId, status: "POSTED", businessDate: window(ctx), ...docBranches(ctx) }, _sum: { total: true }, _count: { _all: true } }),
    prisma.salePayment.groupBy({ by: ["method"], where: { organizationId: ctx.organizationId, sale: { status: "POSTED", businessDate: window(ctx), ...docBranches(ctx) } }, _sum: { amount: true } }),
    prisma.$queryRaw<Array<{ net: Prisma.Decimal | null }>>`
      SELECT SUM(l.credit - l.debit) AS net
      FROM journal_lines l
      JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED' AND j.docType = 'SALE' AND j.kind = 'POSTING'
      JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = 'SALES'
      WHERE l.organizationId = ${ctx.organizationId} ${lineBranches(ctx)} AND l.businessDate BETWEEN ${ctx.from} AND ${ctx.to}
    `,
  ]);
  const level = new Map(levels.map((row) => [row.id, row.name]));
  const sameDay = new Map<string, Prisma.Decimal>();
  const saleDate = new Map(sales.map((sale) => [sale.id, dateOnly(sale.businessDate)]));
  for (const row of allocations) {
    if (row.invoiceId && dateOnly(row.journal.businessDate) === saleDate.get(row.invoiceId)) {
      sameDay.set(row.invoiceId, (sameDay.get(row.invoiceId) ?? ZERO).plus(row.amount));
    }
  }
  const rows = sales.map((sale) => {
    const cogs = sale.items.reduce((sum, item) => sum.plus(item.quantity.mul(item.unitCost ?? 0)), ZERO).toDecimalPlaces(2);
    const paid = status.get(sale.id);
    return {
      sale,
      number: sale.invoice?.number ?? "",
      cogs,
      salesPart: sale.total.minus(sale.vatTotal).minus(sale.chargesTotal),
      paidSameDay: sameDay.get(sale.id) ?? ZERO,
      owed: paid?.owed ?? ZERO,
      status: paid?.status ?? "UNPAID",
    };
  });
  const products = new Map<string, Prisma.Decimal>();
  const categories = new Map<string, Prisma.Decimal>();
  for (const sale of sales) {
    for (const item of sale.items) {
      products.set(item.product.name, (products.get(item.product.name) ?? ZERO).plus(item.lineTotal));
      const category = item.product.category?.name ?? "No category";
      categories.set(category, (categories.get(category) ?? ZERO).plus(item.lineTotal));
    }
  }
  const top = (map: Map<string, Prisma.Decimal>) => [...map].sort((a, b) => b[1].comparedTo(a[1])).slice(0, 10).map(([name, value]) => ({ name, amount: money(value) }));
  const total = sumOf(rows, (row) => row.sale.total);
  const returned = dec(returns._sum.total);
  const columns = [
    col("number", "Invoice", "ইনভয়েস"),
    col("time", "Time", "সময়"),
    col("customer", "Customer", "কাস্টমার"),
    col("district", "District", "জেলা"),
    col("channel", "Channel", "চ্যানেল"),
    col("level", "Price level", "প্রাইস লেভেল"),
    col("gross", "Gross", "মোট", true),
    col("discount", "Discount", "ডিসকাউন্ট", true),
    col("vat", "VAT", "VAT", true),
    col("charges", "Charges", "চার্জ", true),
    col("total", "Net total", "নিট মোট", true),
    col("paid", "Paid that day", "সেদিন পাওয়া", true),
    col("owed", "Still owed", "বাকি", true),
    col("status", "Payment", "পেমেন্ট"),
    ...(ctx.canProfit ? [col("cogs", "Cost of goods", "পণ্যের খরচ", true), col("profit", "Profit", "লাভ", true)] : []),
  ];
  return {
    key: "sales",
    title: t("Sales", "বিক্রি (Sales)"),
    from: ctx.from,
    to: ctx.to,
    summary: [
      { label: t("Invoices", "ইনভয়েস"), value: String(rows.length) },
      { label: t("Sales", "মোট বিক্রি"), value: money(total) },
      { label: t("Returns", "রিটার্ন"), value: money(returned) },
      { label: t("Net sales", "নিট বিক্রি"), value: money(total.minus(returned)) },
      ...(ctx.canProfit ? [{ label: t("Gross profit on these invoices", "এই ইনভয়েসগুলোর মোট লাভ"), value: money(sumOf(rows, (row) => row.salesPart.minus(row.cogs))) }] : []),
    ],
    sections: [
      {
        key: "invoices",
        title: t("Invoices", "ইনভয়েস"),
        columns,
        rows: rows.map((row) => ({
          number: row.number,
          time: row.sale.createdAt.toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit" }),
          customer: row.sale.customer?.name ?? "Walk-in",
          district: row.sale.customer?.district?.name ?? "",
          channel: row.sale.order?.channel ?? "POS",
          level: row.sale.priceLevelId ? (level.get(row.sale.priceLevelId) ?? "") : "",
          gross: money(row.sale.subtotal),
          discount: money(row.sale.discountTotal),
          vat: money(row.sale.vatTotal),
          charges: money(row.sale.chargesTotal),
          total: money(row.sale.total),
          paid: money(row.paidSameDay),
          owed: money(row.owed),
          status: row.status,
          ...(ctx.canProfit ? { cogs: money(row.cogs), profit: money(row.salesPart.minus(row.cogs)) } : {}),
        })),
        total: { total: money(total), paid: money(sumOf(rows, (row) => row.paidSameDay)), owed: money(sumOf(rows, (row) => row.owed)), ...(ctx.canProfit ? { cogs: money(sumOf(rows, (row) => row.cogs)) } : {}) },
      },
      { key: "methods", title: t("By payment method", "পেমেন্ট মেথড অনুযায়ী"), columns: [col("method", "Method", "মেথড"), col("amount", "Amount", "পরিমাণ", true)], rows: methods.map((row) => ({ method: row.method, amount: money(dec(row._sum.amount)) })) },
      { key: "products", title: t("Top products", "শীর্ষ পণ্য"), columns: [col("name", "Product", "পণ্য"), col("amount", "Sold", "বিক্রি", true)], rows: top(products) },
      { key: "categories", title: t("Top categories", "শীর্ষ ক্যাটাগরি"), columns: [col("name", "Category", "ক্যাটাগরি"), col("amount", "Sold", "বিক্রি", true)], rows: top(categories) },
    ],
    identities: [identity(t("Invoices less VAT and charges = Sales account credited by them", "ইনভয়েস − VAT − চার্জ = বিক্রির অ্যাকাউন্টে (4100) তাদের ক্রেডিট"), sumOf(rows, (row) => row.salesPart), dec(salesCredit[0]?.net))],
  };
}

// ---- 3. what customers and vendors owe ----------------------------------------------------------------------------------------------------

type PartyMove = { partyId: string; bucket: string; debit: Prisma.Decimal | null; credit: Prisma.Decimal | null };

async function partyMoves(ctx: ReportCtx, partyType: "CUSTOMER" | "VENDOR" | "COURIER", role: "AR" | "AP" | "COURIER_AR", advanceRole: "CUSTOMER_ADVANCE" | "VENDOR_ADVANCE" | null) {
  const wallet = advanceRole
    ? Prisma.sql`CASE WHEN EXISTS (SELECT 1 FROM journal_lines x JOIN account_roles rr ON rr.organizationId = x.organizationId AND rr.accountId = x.accountId AND rr.role = ${advanceRole} WHERE x.journalId = j.id) THEN 'ADVANCE_USED' ELSE COALESCE(j.docType, 'JOURNAL') END`
    : Prisma.sql`COALESCE(j.docType, 'JOURNAL')`;
  const [moves, opening, closing] = await Promise.all([
    prisma.$queryRaw<PartyMove[]>`
      SELECT l.partyId AS partyId, ${wallet} AS bucket, SUM(l.debit) AS debit, SUM(l.credit) AS credit
      FROM journal_lines l
      JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED'
      JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = ${role}
      WHERE l.organizationId = ${ctx.organizationId} AND l.partyType = ${partyType} ${lineBranches(ctx)} AND l.businessDate BETWEEN ${ctx.from} AND ${ctx.to}
      GROUP BY l.partyId, bucket
    `,
    balancesUpTo(ctx, partyType, role, dayBefore(ctx.from)),
    balancesUpTo(ctx, partyType, role, ctx.to),
  ]);
  return { moves: moves.map((row) => ({ ...row, debit: dec(row.debit), credit: dec(row.credit) })), opening, closing };
}

async function balancesUpTo(ctx: ReportCtx, partyType: string, role: string, upTo: string) {
  const rows = await prisma.$queryRaw<Array<{ partyId: string; net: Prisma.Decimal | null }>>`
    SELECT l.partyId AS partyId, SUM(l.debit - l.credit) AS net
    FROM journal_lines l
    JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED'
    JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = ${role}
    WHERE l.organizationId = ${ctx.organizationId} AND l.partyType = ${partyType} ${lineBranches(ctx)} AND l.businessDate <= ${upTo}
    GROUP BY l.partyId
  `;
  return new Map(rows.map((row) => [row.partyId, dec(row.net)]));
}

async function roleBalance(ctx: ReportCtx, role: string, upTo: string) {
  const rows = await prisma.$queryRaw<Array<{ net: Prisma.Decimal | null }>>`
    SELECT SUM(l.debit - l.credit) AS net
    FROM journal_lines l
    JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED'
    JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = ${role}
    WHERE l.organizationId = ${ctx.organizationId} ${lineBranches(ctx)} AND l.businessDate <= ${upTo}
  `;
  return dec(rows[0]?.net);
}

/** The oldest invoice (or bill) of each party that still has something owed on it. */
async function oldestOpen(ctx: ReportCtx, kind: "CUSTOMER" | "VENDOR", partyIds: string[]) {
  const result = new Map<string, string>();
  for (const partyId of partyIds) {
    const docs =
      kind === "CUSTOMER"
        ? await prisma.sale.findMany({ where: { organizationId: ctx.organizationId, customerId: partyId, status: "POSTED", businessDate: { lte: day(ctx.to) } }, orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }], select: { id: true, total: true, businessDate: true } })
        : await prisma.purchase.findMany({ where: { organizationId: ctx.organizationId, supplierId: partyId, status: "RECEIVED", businessDate: { lte: day(ctx.to) } }, orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }], select: { id: true, total: true, businessDate: true } });
    const status = await paymentStatuses(prisma, ctx.organizationId, kind, docs);
    const first = docs.find((doc) => status.get(doc.id)?.owed.gt(0));
    if (first) {
      result.set(partyId, dateOnly(first.businessDate));
    }
  }
  return result;
}

export async function dueReport(ctx: ReportCtx): Promise<ReportResult> {
  const [customers, vendors] = await Promise.all([partyMoves(ctx, "CUSTOMER", "AR", "CUSTOMER_ADVANCE"), partyMoves(ctx, "VENDOR", "AP", "VENDOR_ADVANCE")]);
  const build = async (kind: "CUSTOMER" | "VENDOR", data: Awaited<ReturnType<typeof partyMoves>>) => {
    const sign = kind === "CUSTOMER" ? 1 : -1;
    const ids = [...new Set([...data.moves.map((row) => row.partyId), ...[...data.opening].filter(([, value]) => !value.isZero()).map(([id]) => id)])];
    const names = kind === "CUSTOMER" ? await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, code: true, paymentDays: true } }) : await prisma.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, code: true, paymentDays: true } });
    const of = new Map(names.map((row) => [row.id, row]));
    const owing = ids.filter((id) => (data.closing.get(id) ?? ZERO).mul(sign).gt(0));
    const oldest = await oldestOpen(ctx, kind, owing);
    const own = kind === "CUSTOMER" ? "SALE" : "PURCHASE";
    const paidDoc = kind === "CUSTOMER" ? "CUSTOMER_PAYMENT" : "SUPPLIER_PAYMENT";
    const returnDoc = kind === "CUSTOMER" ? "SALE_RETURN" : "PURCHASE_RETURN";
    return ids
      .map((id) => {
        const mine = data.moves.filter((row) => row.partyId === id);
        const net = (bucket: string) => sumOf(mine.filter((row) => row.bucket === bucket), (row) => row.debit.minus(row.credit)).mul(sign);
        const opening = (data.opening.get(id) ?? ZERO).mul(sign);
        const closing = (data.closing.get(id) ?? ZERO).mul(sign);
        const added = net(own);
        const paid = net(paidDoc).neg();
        const returned = net(returnDoc).neg();
        const advance = net("ADVANCE_USED").neg();
        const other = closing.minus(opening).minus(added).plus(paid).plus(returned).plus(advance);
        const party = of.get(id);
        const since = oldest.get(id) ?? null;
        const late = since !== null && addDays(since, party?.paymentDays ?? 0) < ctx.to;
        return { id, name: party ? `${party.name} (${party.code})` : id, opening, added, paid, returned, advance, other, closing, since, late };
      })
      .sort((a, b) => b.closing.comparedTo(a.closing));
  };
  const [customerRows, vendorRows] = await Promise.all([build("CUSTOMER", customers), build("VENDOR", vendors)]);
  const [ar, ap] = await Promise.all([roleBalance(ctx, "AR", ctx.to), roleBalance(ctx, "AP", ctx.to)]);
  const columns = (kind: "CUSTOMER" | "VENDOR") => [
    col("name", kind === "CUSTOMER" ? "Customer" : "Vendor", kind === "CUSTOMER" ? "কাস্টমার" : "Vendor"),
    col("opening", "Opening", "শুরুর বাকি", true),
    col("added", kind === "CUSTOMER" ? "New invoices" : "New bills", kind === "CUSTOMER" ? "নতুন ইনভয়েস" : "নতুন বিল", true),
    col("paid", kind === "CUSTOMER" ? "Collected" : "Paid", kind === "CUSTOMER" ? "আদায়" : "পরিশোধ", true),
    col("returned", "Returns", "রিটার্ন", true),
    col("advance", "Advance used", "অগ্রিম সমন্বয়", true),
    col("other", "Other", "অন্যান্য", true),
    col("closing", "Closing", "শেষ বাকি", true),
    col("since", "Oldest unpaid", "পুরনো অপরিশোধিত"),
    col("late", "Overdue", "ওভারডিউ"),
  ];
  const show = (rows: Awaited<ReturnType<typeof build>>) =>
    rows.map((row) => ({ name: row.name, opening: money(row.opening), added: money(row.added), paid: money(row.paid), returned: money(row.returned), advance: money(row.advance), other: money(row.other), closing: money(row.closing), since: row.since ?? "", late: row.late ? "Yes" : "" }));
  return {
    key: "due",
    title: t("What is owed", "বাকির হিসাব (Due)"),
    from: ctx.from,
    to: ctx.to,
    summary: [
      { label: t("Customers owe", "কাস্টমারের বাকি"), value: money(sumOf(customerRows, (row) => row.closing)) },
      { label: t("The shop owes vendors", "Vendor-এর পাওনা"), value: money(sumOf(vendorRows, (row) => row.closing)) },
    ],
    sections: [
      { key: "customers", title: t("Customers", "কাস্টমার"), columns: columns("CUSTOMER"), rows: show(customerRows), total: { closing: money(sumOf(customerRows, (row) => row.closing)) } },
      { key: "vendors", title: t("Vendors", "Vendor"), columns: columns("VENDOR"), rows: show(vendorRows), total: { closing: money(sumOf(vendorRows, (row) => row.closing)) } },
    ],
    identities: [
      identity(t("Customers' closing = receivable (1300) balance", "কাস্টমারের শেষ বাকি = AR (1300) ব্যালান্স"), sumOf(customerRows, (row) => row.closing), ar),
      identity(t("Vendors' closing = payable (2100) balance", "Vendor-এর শেষ বাকি = AP (2100) ব্যালান্স"), sumOf(vendorRows, (row) => row.closing), ap.neg()),
    ],
  };
}

// ---- 4. what couriers owe (condition) -----------------------------------------------------------------------------------------------------

export async function conditionReport(ctx: ReportCtx): Promise<ReportResult> {
  const data = await partyMoves(ctx, "COURIER", "COURIER_AR", null);
  const couriers = await prisma.courier.findMany({ where: { organizationId: ctx.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const shipments = await prisma.shipment.findMany({
    where: { organizationId: ctx.organizationId, courierId: { not: null }, ...docBranches(ctx), OR: [{ dispatchedOn: window(ctx) }, { status: { in: ["CREATED", "PICKED", "IN_TRANSIT"] } }] },
    orderBy: [{ dispatchedOn: "asc" }, { createdAt: "asc" }],
    select: { id: true, number: true, courierId: true, status: true, codAmount: true, deliveryCharge: true, conditionCharge: true, deliveryPaidWith: true, dispatchedOn: true, trackingCode: true },
  });
  const inWindow = shipments.filter((row) => row.dispatchedOn && dateOnly(row.dispatchedOn) >= ctx.from && dateOnly(row.dispatchedOn) <= ctx.to);
  const rows = couriers
    .map((courier) => {
      const mine = data.moves.filter((row) => row.partyId === courier.id);
      const bucket = (name: string) => mine.filter((row) => row.bucket === name);
      const handed = sumOf(bucket("SHIPMENT"), (row) => row.debit);
      const deducted = sumOf(bucket("SHIPMENT"), (row) => row.credit);
      const sent = inWindow.filter((row) => row.courierId === courier.id);
      const delivery = sumOf(sent.filter((row) => row.deliveryPaidWith === null || row.deliveryPaidWith === "DEDUCT"), (row) => row.deliveryCharge);
      const condition = sumOf(sent, (row) => row.conditionCharge);
      const returned = sumOf(bucket("SHIPMENT_RETURN"), (row) => row.debit.minus(row.credit));
      const settled = sumOf(bucket("COURIER_SETTLEMENT"), (row) => row.credit.minus(row.debit));
      const opening = data.opening.get(courier.id) ?? ZERO;
      const closing = data.closing.get(courier.id) ?? ZERO;
      const other = closing.minus(opening).minus(handed).plus(delivery).plus(condition).minus(returned).plus(settled);
      return { courier, opening, handed, deducted, delivery, condition, returned, settled, other, closing };
    })
    .filter((row) => !row.opening.isZero() || !row.closing.isZero() || !row.handed.isZero() || !row.settled.isZero());
  const name = new Map(couriers.map((row) => [row.id, row.name]));
  const balance = await roleBalance(ctx, "COURIER_AR", ctx.to);
  return {
    key: "condition",
    title: t("Couriers' cash on delivery", "কন্ডিশন (কুরিয়ারের পাওনা)"),
    from: ctx.from,
    to: ctx.to,
    summary: [{ label: t("Couriers owe", "কুরিয়ারের কাছে পাওনা"), value: money(sumOf(rows, (row) => row.closing)) }],
    sections: [
      {
        key: "couriers",
        title: t("Couriers", "কুরিয়ার"),
        columns: [col("courier", "Courier", "কুরিয়ার"), col("opening", "Opening", "শুরুর পাওনা", true), col("handed", "COD handed over", "নতুন COD", true), col("delivery", "Delivery charge", "ডেলিভারি চার্জ", true), col("condition", "Condition charge", "কন্ডিশন চার্জ", true), col("returned", "Returned parcels", "ফেরত পার্সেল", true), col("settled", "Settled", "সেটেলমেন্টে পাওয়া", true), col("other", "Other", "অন্যান্য", true), col("closing", "Closing", "শেষ পাওনা", true)],
        rows: rows.map((row) => ({ courier: row.courier.name, opening: money(row.opening), handed: money(row.handed), delivery: money(row.delivery), condition: money(row.condition), returned: money(row.returned), settled: money(row.settled), other: money(row.other), closing: money(row.closing) })),
        total: { closing: money(sumOf(rows, (row) => row.closing)) },
      },
      {
        key: "shipments",
        title: t("Parcels", "পার্সেল"),
        columns: [col("number", "Shipment", "শিপমেন্ট"), col("courier", "Courier", "কুরিয়ার"), col("status", "Status", "অবস্থা"), col("cod", "COD", "COD", true), col("delivery", "Delivery", "ডেলিভারি", true), col("condition", "Condition", "কন্ডিশন", true), col("days", "Days out", "দিন পার", true)],
        rows: shipments.map((row) => ({ number: row.number ?? row.trackingCode ?? "", courier: row.courierId ? (name.get(row.courierId) ?? "") : "", status: row.status, cod: money(row.codAmount), delivery: money(row.deliveryCharge), condition: money(row.conditionCharge), days: row.dispatchedOn ? Math.max(0, Math.round((day(ctx.to).getTime() - row.dispatchedOn.getTime()) / 86_400_000)) : "" })),
      },
    ],
    identities: [
      identity(t("Delivery and condition charges of the parcels = what the dispatches took off the couriers", "পার্সেলের ডেলিভারি ও কন্ডিশন চার্জ = হস্তান্তরে কুরিয়ারের হিসাব থেকে কাটা"), sumOf(rows, (row) => row.delivery.plus(row.condition)), sumOf(rows, (row) => row.deducted)),
      identity(t("Couriers' closing = courier receivable (1350) balance", "কুরিয়ারের শেষ পাওনা = COURIER_AR (1350) ব্যালান্স"), sumOf(rows, (row) => row.closing), balance),
    ],
  };
}

// ---- 7. profit and loss -------------------------------------------------------------------------------------------------------------------

/** Profit and loss for the window, from the ledger (05 #7). Needs reports.profit. */
export async function profitReport(ctx: ReportCtx): Promise<ReportResult> {
  const [accounts, totals] = await Promise.all([chart(ctx.organizationId), accountTotals(ctx, ctx.from, ctx.to)]);
  const credit = (test: (account: (typeof accounts)[number]) => boolean) => netOf(totals, accounts, test).neg();
  const debit = (test: (account: (typeof accounts)[number]) => boolean) => netOf(totals, accounts, test);
  const named = new Set(["SALES", "CHARGE_INCOME", "COGS", "INVENTORY_LOSS", "INVENTORY_GAIN", "OTHER_INCOME", "PPV"]);
  const sales = credit(hasRole("SALES"));
  const chargeIncome = credit(hasRole("CHARGE_INCOME"));
  const cogs = debit(hasRole("COGS"));
  const gross = sales.plus(chargeIncome).minus(cogs);
  const stockLoss = debit(hasRole("INVENTORY_LOSS")).minus(credit(hasRole("INVENTORY_GAIN")));
  const expenseAccounts = accounts.filter((account) => account.group === GROUP.EXPENSE);
  const expenses = expenseAccounts.map((account) => ({ account, amount: debit((row) => row.id === account.id) })).filter((row) => !row.amount.isZero());
  const otherIncome = credit(hasRole("OTHER_INCOME"));
  const ppv = debit(hasRole("PPV"));
  const otherRevenue = credit((account) => account.group === GROUP.REVENUE && !account.roles.some((role) => named.has(role)));
  const otherCost = debit((account) => account.group === GROUP.COST_OF_SALES && !account.roles.some((role) => named.has(role)));
  const totalExpenses = sumOf(expenses, (row) => row.amount);
  const net = gross.minus(stockLoss).minus(totalExpenses).plus(otherIncome).plus(otherRevenue).minus(ppv).minus(otherCost);
  const ledgerNet = credit((account) => account.group === GROUP.REVENUE || account.group === GROUP.COST_OF_SALES || account.group === GROUP.EXPENSE);
  const line = (en: string, bn: string, value: Prisma.Decimal, strong = false) => ({ line: strong ? `= ${en} / ${bn}` : `${en} / ${bn}`, amount: money(value) });
  return {
    key: "profit",
    title: t("Profit and loss", "লাভ-ক্ষতি"),
    from: ctx.from,
    to: ctx.to,
    summary: [
      { label: t("Gross profit", "মোট লাভ"), value: money(gross) },
      { label: t("Net profit", "নিট লাভ"), value: money(net) },
    ],
    sections: [
      {
        key: "statement",
        title: t("Statement", "হিসাব"),
        columns: [col("line", "Line", "লাইন"), col("amount", "Amount", "পরিমাণ", true)],
        rows: [
          line("Net sales (4100)", "নিট বিক্রি", sales),
          line("+ Charge income (4200)", "চার্জ আয়", chargeIncome),
          line("- Cost of goods sold (5100)", "বিক্রিত পণ্যের ব্যয়", cogs),
          line("Gross profit", "মোট লাভ", gross, true),
          line("- Stock loss less gain (5200, 4300)", "স্টক ক্ষতি − লাভ", stockLoss),
          ...expenses.map((row) => line(`- ${row.account.name} (${row.account.code})`, "খরচ", row.amount)),
          line("+ Other income (4400)", "অন্যান্য আয়", otherIncome),
          ...(otherRevenue.isZero() ? [] : [line("+ Other revenue", "অন্যান্য রাজস্ব", otherRevenue)]),
          line("- Purchase price variance (5300)", "PPV", ppv),
          ...(otherCost.isZero() ? [] : [line("- Other cost", "অন্যান্য ব্যয়", otherCost)]),
          line("Net profit or loss", "নিট লাভ/ক্ষতি", net, true),
        ],
      },
    ],
    identities: [identity(t("Net = every income and expense account's net in the ledger", "নিট = সব আয়-ব্যয় অ্যাকাউন্টের নিট (ট্রায়াল ব্যালান্স)"), net, ledgerNet)],
  };
}

// ---- 8. expenses --------------------------------------------------------------------------------------------------------------------------

export async function expenseDayReport(ctx: ReportCtx): Promise<ReportResult> {
  const lines = await prisma.$queryRaw<Array<{ id: string; journalId: string; accountId: string; amount: Prisma.Decimal | null; businessDate: Date; docType: string | null; docId: string | null; number: string | null; description: string | null }>>`
    SELECT l.id AS id, l.journalId AS journalId, l.accountId AS accountId, (l.debit - l.credit) AS amount, l.businessDate AS businessDate, j.docType AS docType, j.docId AS docId, j.number AS number, j.description AS description
    FROM journal_lines l
    JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED'
    JOIN accounts a ON a.id = l.accountId
    JOIN account_groups g ON g.id = a.groupId AND g.code = ${GROUP.EXPENSE}
    WHERE l.organizationId = ${ctx.organizationId} ${lineBranches(ctx)} AND l.businessDate BETWEEN ${ctx.from} AND ${ctx.to}
    ORDER BY l.businessDate, j.createdAt
  `;
  const accounts = await chart(ctx.organizationId);
  const name = new Map(accounts.map((account) => [account.id, `${account.name} (${account.code})`]));
  const vouchers = await prisma.expense.findMany({ where: { organizationId: ctx.organizationId, journalId: { in: [...new Set(lines.map((line) => line.journalId))] } }, select: { journalId: true, amount: true, periodMonth: true, moneyAccountId: true, category: { select: { name: true, type: true } } } });
  const voucher = new Map(vouchers.map((row) => [row.journalId as string, row]));
  const rows = lines.map((line) => {
    const own = voucher.get(line.journalId);
    return { line, amount: dec(line.amount), own, type: own?.category?.type ?? (line.docType === "EXPENSE" ? "VARIABLE" : "OTHER") };
  });
  const byType = new Map<string, Prisma.Decimal>();
  const byAccount = new Map<string, Prisma.Decimal>();
  for (const row of rows) {
    byType.set(row.type, (byType.get(row.type) ?? ZERO).plus(row.amount));
    const account = name.get(row.line.accountId) ?? "";
    byAccount.set(account, (byAccount.get(account) ?? ZERO).plus(row.amount));
  }
  const totals = await accountTotals(ctx, ctx.from, ctx.to);
  const group = netOf(totals, accounts, (account) => account.group === GROUP.EXPENSE);
  const total = sumOf(rows, (row) => row.amount);
  const voucherLines = sumOf(rows.filter((row) => row.line.docType === "EXPENSE" && row.own), (row) => row.amount);
  const voucherAmounts = sumOf(vouchers.filter((row) => lines.some((line) => line.journalId === row.journalId && line.docType === "EXPENSE")), (row) => row.amount);
  const typeLabel: Record<string, string> = { MONTHLY_FIXED: "Fixed monthly / মাসিক স্থির", VARIABLE: "Variable / পরিবর্তনশীল", MISC: "Miscellaneous / বিবিধ", OTHER: "Other (charges, transport, depreciation ...) / অন্যান্য" };
  return {
    key: "expenses",
    title: t("Expenses", "খরচ"),
    from: ctx.from,
    to: ctx.to,
    summary: [{ label: t("Total", "মোট"), value: money(total) }],
    sections: [
      { key: "types", title: t("By kind", "ধরন অনুযায়ী"), columns: [col("type", "Kind", "ধরন"), col("amount", "Amount", "পরিমাণ", true)], rows: [...byType].map(([type, value]) => ({ type: typeLabel[type] ?? type, amount: money(value) })) },
      { key: "accounts", title: t("By account", "খাত অনুযায়ী"), columns: [col("account", "Account", "খাত"), col("amount", "Amount", "পরিমাণ", true)], rows: [...byAccount].map(([account, value]) => ({ account, amount: money(value) })) },
      {
        key: "lines",
        title: t("Each one", "প্রতিটি"),
        columns: [col("date", "Date", "তারিখ"), col("account", "Account", "খাত"), col("category", "Category", "ক্যাটাগরি"), col("number", "Number", "নম্বর"), col("what", "What", "বিবরণ"), col("month", "Month it is for", "কোন মাসের"), col("amount", "Amount", "পরিমাণ", true)],
        rows: rows.map((row) => ({ date: dateOnly(row.line.businessDate), account: name.get(row.line.accountId) ?? "", category: row.own?.category?.name ?? "", number: row.line.number ?? "", what: row.line.description ?? "", month: row.own?.periodMonth ?? "", amount: money(row.amount) })),
        total: { amount: money(total) },
      },
    ],
    identities: [
      identity(t("Total = expense group (6000) net debit", "মোট = 6000 গ্রুপের নিট ডেবিট"), total, group),
      identity(t("Expense vouchers = their expense lines in the ledger", "খরচের ভাউচার = লেজারে তাদের খরচের লাইন"), voucherAmounts, voucherLines),
    ],
  };
}

// ---- 2. stock -----------------------------------------------------------------------------------------------------------------------------

type Move = { productId: string; branchId: string; movementType: string; direction: string; quantity: Prisma.Decimal | null; value: Prisma.Decimal | null };

async function stockMoves(ctx: ReportCtx, from: string | null, to: string) {
  const rows = await prisma.$queryRaw<Move[]>`
    SELECT s.productId AS productId, s.branchId AS branchId, s.movementType AS movementType, s.direction AS direction, SUM(s.quantity) AS quantity, SUM(COALESCE(s.totalCost, ROUND(s.quantity * s.unitCost, 2), 0)) AS value
    FROM stock_ledgers s
    WHERE s.organizationId = ${ctx.organizationId} ${lineBranches(ctx, "s")} AND s.businessDate <= ${to} ${from ? Prisma.sql`AND s.businessDate >= ${from}` : Prisma.empty}
    GROUP BY s.productId, s.branchId, s.movementType, s.direction
  `;
  return rows.map((row) => ({ ...row, quantity: dec(row.quantity), value: dec(row.value) }));
}

export async function stockDayReport(ctx: ReportCtx): Promise<ReportResult> {
  const [before, during, upTo] = await Promise.all([stockMoves(ctx, null, dayBefore(ctx.from)), stockMoves(ctx, ctx.from, ctx.to), stockMoves(ctx, null, ctx.to)]);
  const keyOf = (row: { productId: string; branchId: string }) => `${row.productId}|${row.branchId}`;
  const keys = [...new Set([...before, ...during, ...upTo].map(keyOf))];
  const productIds = [...new Set(keys.map((key) => key.split("|")[0]))];
  const branchIds = [...new Set(keys.map((key) => key.split("|")[1]))];
  const [products, branches, accounts, totals] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, sku: true, reorderLevel: true } }),
    prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } }),
    chart(ctx.organizationId),
    accountTotals(ctx, null, ctx.to),
  ]);
  const product = new Map(products.map((row) => [row.id, row]));
  const branch = new Map(branches.map((row) => [row.id, row.name]));
  const signed = (rows: typeof before, key: string, pick: "quantity" | "value") => sumOf(rows.filter((row) => keyOf(row) === key), (row) => (row.direction === "IN" ? row[pick] : row[pick].neg()));
  const moved = (key: string, types: string[], direction: "IN" | "OUT") => sumOf(during.filter((row) => keyOf(row) === key && row.direction === direction && types.includes(row.movementType)), (row) => row.quantity);
  const IN_TYPES = { PURCHASE: ["PURCHASE"], RETURN: ["CUSTOMER_RETURN"], TRANSFER: ["TRANSFER_IN"] } as const;
  const OUT_TYPES = { SALE: ["SALE"], SUPPLIER: ["SUPPLIER_RETURN"], TRANSFER: ["TRANSFER_OUT"], DAMAGE: ["DAMAGE", "EXPIRY"], TAKE_OFF: ["TAKE_OFF"] } as const;
  const rows = keys
    .map((key) => {
      const [productId, branchId] = key.split("|");
      const opening = signed(before, key, "quantity");
      const purchased = moved(key, [...IN_TYPES.PURCHASE], "IN");
      const returnedIn = moved(key, [...IN_TYPES.RETURN], "IN");
      const transferIn = moved(key, [...IN_TYPES.TRANSFER], "IN");
      const allIn = sumOf(during.filter((row) => keyOf(row) === key && row.direction === "IN"), (row) => row.quantity);
      const otherIn = allIn.minus(purchased).minus(returnedIn).minus(transferIn);
      const sold = moved(key, [...OUT_TYPES.SALE], "OUT");
      const toSupplier = moved(key, [...OUT_TYPES.SUPPLIER], "OUT");
      const transferOut = moved(key, [...OUT_TYPES.TRANSFER], "OUT");
      const damaged = moved(key, [...OUT_TYPES.DAMAGE], "OUT");
      const takenOff = moved(key, [...OUT_TYPES.TAKE_OFF], "OUT");
      const allOut = sumOf(during.filter((row) => keyOf(row) === key && row.direction === "OUT"), (row) => row.quantity);
      const adjustedOut = allOut.minus(sold).minus(toSupplier).minus(transferOut).minus(damaged).minus(takenOff);
      const closing = signed(upTo, key, "quantity");
      const value = signed(upTo, key, "value");
      const info = product.get(productId);
      return { key, info, branch: branch.get(branchId) ?? "", opening, purchased, returnedIn, transferIn, otherIn, sold, toSupplier, transferOut, damaged, takenOff, adjustedOut, allIn, allOut, closing, value };
    })
    .filter((row) => !row.opening.isZero() || !row.allIn.isZero() || !row.allOut.isZero() || !row.closing.isZero() || !row.value.isZero())
    .sort((a, b) => (a.info?.name ?? "").localeCompare(b.info?.name ?? ""));
  const qty = (value: Prisma.Decimal) => value.toDecimalPlaces(4).toString();
  const broken = rows.filter((row) => !row.opening.plus(row.allIn).minus(row.allOut).eq(row.closing));
  const inventory = netOf(totals, accounts, hasRole("INVENTORY"));
  const totalValue = sumOf(rows, (row) => row.value);
  return {
    key: "stock",
    title: t("Stock", "স্টক"),
    from: ctx.from,
    to: ctx.to,
    summary: [
      { label: t("Products", "পণ্য"), value: String(rows.length) },
      ...(ctx.canProfit ? [{ label: t("Stock value at cost", "স্টকের মূল্য (খরচে)"), value: money(totalValue) }] : []),
      { label: t("Low or out", "কম বা শেষ"), value: String(rows.filter((row) => alertStatus(row.closing, row.info?.reorderLevel ?? ZERO) !== "NORMAL").length) },
    ],
    sections: [
      {
        key: "products",
        title: t("Products", "পণ্য"),
        columns: [
          col("product", "Product", "পণ্য"),
          col("branch", "Branch", "ব্রাঞ্চ"),
          col("opening", "Opening", "শুরু", true),
          col("purchased", "Bought", "ক্রয়", true),
          col("returnedIn", "Returned in", "রিটার্ন-ইন", true),
          col("transferIn", "Transfer in", "ট্রান্সফার-ইন", true),
          col("otherIn", "Other in", "অন্যান্য ইন", true),
          col("sold", "Sold", "বিক্রি", true),
          col("toSupplier", "Back to vendor", "সাপ্লায়ার রিটার্ন", true),
          col("transferOut", "Transfer out", "ট্রান্সফার-আউট", true),
          col("damaged", "Damaged / expired", "ড্যামেজ/মেয়াদ", true),
          col("takenOff", "Taken off", "Take-off", true),
          col("adjustedOut", "Adjusted out", "অ্যাডজাস্টমেন্ট", true),
          col("closing", "Closing", "শেষ", true),
          ...(ctx.canProfit ? [col("cost", "Average cost", "গড় খরচ", true), col("value", "Value", "মূল্য", true)] : []),
          col("status", "Status", "অবস্থা"),
        ],
        rows: rows.map((row) => ({
          product: row.info ? `${row.info.name} (${row.info.sku})` : row.key,
          branch: row.branch,
          opening: qty(row.opening),
          purchased: qty(row.purchased),
          returnedIn: qty(row.returnedIn),
          transferIn: qty(row.transferIn),
          otherIn: qty(row.otherIn),
          sold: qty(row.sold),
          toSupplier: qty(row.toSupplier),
          transferOut: qty(row.transferOut),
          damaged: qty(row.damaged),
          takenOff: qty(row.takenOff),
          adjustedOut: qty(row.adjustedOut),
          closing: qty(row.closing),
          ...(ctx.canProfit ? { cost: row.closing.gt(0) ? row.value.div(row.closing).toDecimalPlaces(4).toString() : "", value: money(row.value) } : {}),
          status: alertStatus(row.closing, row.info?.reorderLevel ?? ZERO),
        })),
        total: ctx.canProfit ? { value: money(totalValue) } : undefined,
      },
    ],
    identities: [
      identity(t("Rows where opening + in - out is not the closing", "যে সারিতে শুরু + ইন − আউট ≠ শেষ"), new Prisma.Decimal(broken.length), ZERO),
      identity(t("Stock value = inventory (1400) balance at the end", "স্টকের মূল্য = দিনশেষে ইনভেন্টরি (1400) ব্যালান্স"), totalValue, inventory),
    ],
  };
}

