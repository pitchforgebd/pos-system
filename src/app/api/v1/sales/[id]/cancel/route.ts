import { jsonError } from "@/lib/api/http";
import { defineRoute } from "@/core/http/define-route";

export const POST = defineRoute({
  permission: "sales.cancel",
  handler: async ({  }) => {
    return jsonError("BUSINESS_RULE", "A posted sale is not cancelled in this phase.", 422);
  },
});
