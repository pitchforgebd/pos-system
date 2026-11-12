import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { getShipment } from "@/modules/shipping/shipments";

export const GET = defineRoute<undefined, { id: string }>({
  permission: "shipments.view",
  handler: async ({ session, params }) => {
    const { id } = await params;
    if (!session.branchId || !z.string().uuid().safeParse(id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const shipment = await getShipment(session.organizationId, session.branchId, id);
    return shipment ? jsonOk(shipment) : jsonError("NOT_FOUND", "That record was not found.", 404);
  },
});
