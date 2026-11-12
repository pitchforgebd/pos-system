import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { listCategories, listExpenseAccounts, saveCategory } from "@/modules/treasury/expenses";

const bodySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(191),
  accountId: z.string().uuid(),
  type: z.enum(["MONTHLY_FIXED", "VARIABLE", "MISC"]),
  active: z.boolean().optional(),
});

// GET /api/v1/accounting/expense-categories: the categories and the expense accounts a category can post to.
export const GET = defineRoute({
  permission: "accounting.view",
  handler: async ({ session }) => jsonOk({ categories: await listCategories(session.organizationId), accounts: await listExpenseAccounts(session.organizationId) }),
});

// POST /api/v1/accounting/expense-categories: add a category or change one (name, expense account, type, active).
export const POST = defineRoute({
  permission: "settings.manage",
  body: bodySchema,
  handler: async ({ request, session, body }) => {
    if (!session.branchId) {
      return jsonError("BUSINESS_RULE", "Select a branch first.", 422);
    }
    const result = await saveCategory({ organizationId: session.organizationId, branchId: session.branchId, userId: session.userId, ip: clientIp(request), userAgent: request.headers.get("user-agent") }, body);
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id }, "Operation completed", body.id ? 200 : 201);
  },
});
