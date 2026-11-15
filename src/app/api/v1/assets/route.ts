import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { addOpeningAsset, assetRegister, buyAsset } from "@/modules/assets/assets";

const common = {
  code: z.string().trim().max(32).optional(),
  name: z.string().trim().min(1).max(191),
  category: z.enum(["VEHICLE", "FURNITURE", "COMPUTER", "WAREHOUSE_EQUIPMENT", "OTHER"]),
  purchaseDate: isoDate,
  cost: z.string().max(24),
  salvageValue: z.string().max(24).optional(),
  usefulLifeMonths: z.number().int().min(1).max(600),
  location: z.string().trim().max(191).optional(),
  note: z.string().trim().max(255).optional(),
};

const bodySchema = z.discriminatedUnion("kind", [
  /** Bought now: paid from a cash, bank or mobile account, or owed to a vendor (#36). */
  z.object({ kind: z.literal("BUY"), ...common, paidWith: z.enum(["ACCOUNT", "CREDIT"]), moneyAccountId: z.string().uuid().optional(), vendorId: z.string().uuid().optional() }),
  /** Already owned before the system: what was written off before goes in with it. */
  z.object({ kind: z.literal("OPENING"), ...common, accumulated: z.string().max(24), asOf: isoDate.optional() }),
]);

// GET /api/v1/assets: the register (cost, written off, worth now) and the totals by category.
export const GET = defineRoute({
  permission: "accounting.view",
  handler: async ({ session }) => jsonOk(await assetRegister(session.organizationId)),
});

// POST /api/v1/assets: add an asset, bought now or already owned.
export const POST = defineRoute({
  permission: "accounting.post",
  body: bodySchema,
  idempotent: true,
  handler: async ({ request, session, body, idempotencyKey }) => {
    const actor = stockActor(session, request);
    if (!actor || !idempotencyKey) {
      return jsonError("VALIDATION_ERROR", "A branch and an Idempotency-Key are required.", 400);
    }
    const result = body.kind === "BUY" ? await buyAsset({ ...actor, idempotencyKey, ...body }) : await addOpeningAsset({ ...actor, idempotencyKey, ...body });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, code: result.code, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
