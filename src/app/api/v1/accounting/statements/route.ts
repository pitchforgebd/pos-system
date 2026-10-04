import { jsonError, jsonOk } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { stockActor } from "@/modules/inventory/actor";
import { accountStatement } from "@/modules/accounting/books";

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "accounting.view");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
  if (!actor) {
    return jsonError("BUSINESS_RULE", "Select a branch before viewing a statement.", 422);
  }
  const url = new URL(request.url);
  const accountCode = url.searchParams.get("accountCode")?.trim() ?? "";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!accountCode || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return jsonError("VALIDATION_ERROR", "An account and a date range are required.", 400);
  }
  const statement = await accountStatement({ ...actor, accountCode, from, to });
  if (!statement) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  return jsonOk(statement);
}
