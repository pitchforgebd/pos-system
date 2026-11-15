import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { campaignSchema } from "@/modules/sms/campaign-schema";
import { listCampaigns, sendCampaign } from "@/modules/sms/campaigns";

// GET /api/v1/sms/campaigns: the campaigns with how many of their messages were sent, wait and failed.
export const GET = defineRoute({
  permission: "sms.manage",
  handler: async ({ session }) => jsonOk(await listCampaigns(session.organizationId)),
});

// POST /api/v1/sms/campaigns: send an offer or a due reminder to a segment (sms.campaign): one message per customer goes to the outbox.
export const POST = defineRoute({
  permission: ["sms.manage", "sms.campaign"],
  body: campaignSchema,
  idempotent: true,
  handler: async ({ request, session, body, idempotencyKey }) => {
    const actor = stockActor(session, request);
    if (!actor || !idempotencyKey) {
      return jsonError("VALIDATION_ERROR", "A branch and an Idempotency-Key are required.", 400);
    }
    const result = await sendCampaign({ ...actor, idempotencyKey, ...body });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, recipients: result.recipients, parts: result.parts, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
