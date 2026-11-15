import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { listRuns, previewDepreciation, runDepreciation } from "@/modules/assets/assets";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

// GET /api/v1/assets/depreciation?month=YYYY-MM: what each asset would write off that month (the preview), and the months already done.
export const GET = defineRoute({
  permission: "accounting.view",
  handler: async ({ request, session }) => {
    const asked = month.safeParse(new URL(request.url).searchParams.get("month"));
    if (!asked.success) {
      return jsonError("VALIDATION_ERROR", "Choose a month (YYYY-MM).", 400);
    }
    const preview = await previewDepreciation(session.organizationId, asked.data);
    return jsonOk({ ...preview, rows: preview.rows.map((row) => ({ ...row, amount: row.amount.toFixed(2) })), runs: await listRuns(session.organizationId) });
  },
});

// POST /api/v1/assets/depreciation: post the month's depreciation (#37): one journal for every active asset, once a month.
export const POST = defineRoute({
  permission: "accounting.post",
  body: z.object({ month }),
  idempotent: true,
  handler: async ({ request, session, body, idempotencyKey }) => {
    const actor = stockActor(session, request);
    if (!actor || !idempotencyKey) {
      return jsonError("VALIDATION_ERROR", "A branch and an Idempotency-Key are required.", 400);
    }
    const result = await runDepreciation({ ...actor, idempotencyKey, month: body.month });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, total: result.total, assets: result.count, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
