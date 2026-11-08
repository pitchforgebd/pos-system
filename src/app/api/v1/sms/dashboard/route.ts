import { jsonOk } from "@/lib/api/http";
import { defineRoute } from "@/core/http/define-route";
import { smsDashboard } from "@/modules/sms/sms";

export const GET = defineRoute({
  permission: "sms.manage",
  handler: async ({ session }) => {
    return jsonOk(await smsDashboard(session.organizationId));
  },
});
