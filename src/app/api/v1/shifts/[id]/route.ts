import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { getShift } from "@/modules/shifts/shifts";

export const GET = defineRoute<undefined, { id: string }>({
  permission: "shifts.manage",
  handler: async ({ session, params }) => {
    const { id } = await params;
    if (!session.branchId || !z.string().uuid().safeParse(id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const shift = await getShift(session.organizationId, session.branchId, id);
    if (!shift) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    return jsonOk(shift);
  },
});
