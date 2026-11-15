import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { getAsset } from "@/modules/assets/assets";

// GET /api/v1/assets/:id: one asset, its schedule, what it is worth now and its lines in the books.
export const GET = defineRoute<undefined, { id: string }>({
  permission: "accounting.view",
  handler: async ({ session, params }) => {
    const { id } = await params;
    const asset = z.string().uuid().safeParse(id).success ? await getAsset(session.organizationId, id) : null;
    if (!asset) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    return jsonOk(asset);
  },
});
