import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { getCampaign } from "@/modules/sms/campaigns";

// GET /api/v1/sms/campaigns/:id: the campaign report (filters, and each message with its state).
export const GET = defineRoute<undefined, { id: string }>({
  permission: "sms.manage",
  handler: async ({ session, params }) => {
    const { id } = await params;
    const campaign = z.string().uuid().safeParse(id).success ? await getCampaign(session.organizationId, id) : null;
    if (!campaign) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    return jsonOk(campaign);
  },
});
