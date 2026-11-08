import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { defineRoute } from "@/core/http/define-route";
import { requirePermission } from "@/modules/access/guard";
import { writeAudit } from "@/modules/auth/audit";
import { reportCsv } from "@/modules/reports/export";
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

const kinds = new Set(["sales", "purchases", "inventory", "customers", "suppliers", "cash", "bank", "profit-loss", "trial-balance", "day-book"]);

export const GET = defineRoute<undefined, { kind: string }>({
  permission: "reports.view",
  handler: async ({ request, session, params }) => {
    const { kind } = await params;
    if (!kinds.has(kind)) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    if (!session.branchId) {
      return jsonError("BUSINESS_RULE", "Select a branch first.", 422);
    }
    const url = new URL(request.url);
    const scope: ReportScope = {
      organizationId: session.organizationId,
      branchId: session.branchId,
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    };
    if (url.searchParams.get("format") === "csv") {
      const exportDenied = requirePermission(session, "reports.export");
      if (exportDenied) {
        return exportDenied;
      }
      const csv = await reportCsv(kind, scope);
      await writeAudit({
        organizationId: session.organizationId,
        branchId: session.branchId,
        userId: session.userId,
        action: "export",
        module: "reports",
        entityType: "report",
        after: { kind },
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent"),
      });
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${kind}.csv"`,
        },
      });
    }
    if (kind === "sales") {
      return jsonOk(await salesReport(scope));
    }
    if (kind === "purchases") {
      return jsonOk(await purchaseReport(scope));
    }
    if (kind === "inventory") {
      return jsonOk(await inventoryReport(scope));
    }
    if (kind === "customers") {
      return jsonOk(await customerReport(scope.organizationId));
    }
    if (kind === "suppliers") {
      return jsonOk(await supplierReport(scope.organizationId));
    }
    if (kind === "cash") {
      return jsonOk(await cashReport(scope));
    }
    if (kind === "bank") {
      return jsonOk(await bankReport(scope));
    }
    if (kind === "profit-loss") {
      return jsonOk(await profitAndLoss(scope));
    }
    if (kind === "trial-balance") {
      return jsonOk(await trialBalance(scope));
    }
    return jsonOk(await dayBook(scope));
  },
});
