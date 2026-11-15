import { defineRoute } from "@/core/http/define-route";

import { jsonOk } from "@/lib/api/http";
import { sendWaiting } from "@/modules/sms/sms";

// POST /api/v1/sms/outbox: send what waits in the outbox now. Not in a transaction: it calls the SMS provider, and each message is claimed and
// recorded on its own (a retry of this request cannot send a message twice).
export const POST = defineRoute({
  permission: "sms.manage",
  transaction: false,
  handler: async ({ session }) => jsonOk(await sendWaiting(session.organizationId)),
});
