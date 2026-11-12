import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { listOpenInvoices } from "@/modules/customers/dues";

// GET /api/v1/customers/:id/open-invoices: what the customer still owes, invoice by invoice, oldest first.
export const GET = defineRoute<undefined, { id: string }>({
  permission: "customers.payment",
  handler: async ({ session, params }) => {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    return jsonOk(await listOpenInvoices(session.organizationId, id));
  },
});
