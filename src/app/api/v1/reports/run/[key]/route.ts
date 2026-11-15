import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { writeAudit } from "@/modules/auth/audit";
import { findReport, reportContext, reportToCsv, reportToXlsx } from "@/modules/reports/registry";

// GET /api/v1/reports/run/:key?from=&to=&branch=&format=csv|xlsx&lang=: one report (P11). As JSON, or exported (reports.export, audited).
export const GET = defineRoute<undefined, { key: string }>({
  permission: "reports.view",
  handler: async ({ request, session, params }) => {
    const { key } = await params;
    const report = findReport(key);
    if (!report) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    if (report.needs && !session.permissions.has(report.needs)) {
      return jsonError("AUTHORIZATION_ERROR", "This report needs the profit report permission.", 403);
    }
    const url = new URL(request.url);
    const ctx = reportContext(session, { from: url.searchParams.get("from"), to: url.searchParams.get("to"), branch: url.searchParams.get("branch") });
    if ("error" in ctx) {
      return jsonError("BUSINESS_RULE", ctx.error, 422);
    }
    const result = await report.run(ctx);
    const format = url.searchParams.get("format");
    if (format !== "csv" && format !== "xlsx") {
      return jsonOk(result);
    }
    if (!session.permissions.has("reports.export")) {
      return jsonError("AUTHORIZATION_ERROR", "Exporting a report needs the export permission.", 403);
    }
    const lang = url.searchParams.get("lang") === "bn" ? "bn" : "en";
    await writeAudit({ organizationId: session.organizationId, userId: session.userId, action: "export", module: "reports", entityType: "report", entityId: key, after: { from: ctx.from, to: ctx.to, branches: ctx.branchIds ?? "all", format }, ip: clientIp(request), userAgent: request.headers.get("user-agent") });
    const name = `${key}-${ctx.from}${ctx.to !== ctx.from ? `-${ctx.to}` : ""}`;
    if (format === "csv") {
      return new Response(`﻿${reportToCsv(result, lang)}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"` } });
    }
    return new Response(new Uint8Array(reportToXlsx(result, lang)), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}.xlsx"` } });
  },
});
