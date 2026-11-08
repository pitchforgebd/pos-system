import { jsonOk } from "@/lib/api/http";
import { defineRoute } from "@/core/http/define-route";
import { listPermissionCatalog } from "@/modules/access/roles";

export const GET = defineRoute({
  permission: "roles.manage",
  handler: async ({  }) => {
    return jsonOk(await listPermissionCatalog());
  },
});
