import { toCsv } from "@/modules/imports/csv";
import {
  bankReport,
  cashReport,
  customerReport,
  dayBook,
  inventoryReport,
  profitAndLoss,
  purchaseReport,
  salesReport,
  supplierReport,
  trialBalance,
  type ReportScope,
} from "@/modules/reports/reports";

export async function reportCsv(kind: string, scope: ReportScope) {
  if (kind === "sales") {
    const report = await salesReport(scope);
    return toCsv(["date", "invoice", "customer", "total"], report.rows.map((row) => [row.occurredOn, row.number, row.party, row.total]));
  }
  if (kind === "purchases") {
    const report = await purchaseReport(scope);
    return toCsv(["date", "purchase", "supplier", "total"], report.rows.map((row) => [row.occurredOn, row.number, row.party, row.total]));
  }
  if (kind === "inventory") {
    const report = await inventoryReport(scope);
    return toCsv(["sku", "product", "warehouse", "quantity", "status"], report.rows.map((row) => [row.sku, row.product, row.warehouse, row.quantity, row.status]));
  }
  if (kind === "customers") {
    const report = await customerReport(scope.organizationId);
    return toCsv(["customer", "due"], report.rows.map((row) => [row.name, row.due]));
  }
  if (kind === "suppliers") {
    const report = await supplierReport(scope.organizationId);
    return toCsv(["supplier", "payable"], report.rows.map((row) => [row.name, row.payable]));
  }
  if (kind === "cash" || kind === "bank") {
    const report = kind === "cash" ? await cashReport(scope) : await bankReport(scope);
    return toCsv(["date", "reference", "debit", "credit"], report.rows.map((row) => [row.occurredOn, row.reference, row.debit, row.credit]));
  }
  if (kind === "profit-loss") {
    const report = await profitAndLoss(scope);
    return toCsv(
      ["account", "name", "group", "amount"],
      [
        ...report.rows.map((row) => [row.code, row.name, row.group, row.amount]),
        ["", "Revenue", "4000", report.revenue],
        ["", "Cost of sales", "5000", report.cost],
        ["", "Gross profit", "", report.gross],
        ["", "Expenses", "6000", report.expenses],
        ["", "Net", "", report.net],
      ],
    );
  }
  if (kind === "trial-balance") {
    const report = await trialBalance(scope);
    return toCsv(
      ["code", "name", "debit", "credit"],
      [...report.rows.map((row) => [row.code, row.name, row.debit, row.credit]), ["", "Total", report.debit, report.credit]],
    );
  }
  const report = await dayBook(scope);
  return toCsv(["date", "reference", "account", "debit", "credit"], report.rows.map((row) => [row.occurredOn, row.reference, row.account, row.debit, row.credit]));
}
