import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { messageSchema } from "@/modules/sms/campaign-schema";
import { previewCampaign } from "@/modules/sms/campaigns";

// POST /api/v1/sms/campaigns/preview: who the campaign would reach, a few messages as they would read, the SMS parts and the cost. Reads only.
export const POST = defineRoute({
  permission: "sms.manage",
  body: messageSchema,
  transaction: false,
  handler: async ({ session, body }) => {
    const result = await previewCampaign(session.organizationId, body);
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk(result);
  },
});
