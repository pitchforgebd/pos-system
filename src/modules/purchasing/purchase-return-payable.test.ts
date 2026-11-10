import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { partyLineViolations } from "../../core/posting/invariants.ts";
import { prisma } from "../../lib/db/client.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { getSupplier } from "./suppliers.ts";
import { postPurchase } from "./purchases.ts";
import { postPurchaseReturn } from "./returns.ts";

// A purchase return that is smaller than what is still owed to the supplier reduces the payable: Dr AP (supplier) / Cr Inventory.
// The other path (the supplier is paid up, so the return is refunded in cash) is in return.test.ts.

test("a purchase return against an unpaid bill reduces the payable, on a line that names the supplier", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product({ purchasePrice: "10.00" });
    const supplier = await factories(t).vendor();
    const actor = { ...t.actor, idempotencyKey: "" };

    const bought = await postPurchase({
      ...actor,
      idempotencyKey: randomUUID(),
      supplierId: supplier.id,
      businessDate: "2026-10-01",
      lines: [{ productId: product.id, quantity: "5", unitCost: "10.00" }],
    });
    assert.equal(bought.ok, true);
    if (!bought.ok) {
      return;
    }
    assert.equal((await getSupplier(t.org.id, supplier.id))?.outstanding, "50.00");

    const item = await prisma.purchaseItem.findFirstOrThrow({ where: { purchaseId: bought.id } });
    const returned = await postPurchaseReturn({
      ...actor,
      idempotencyKey: randomUUID(),
      purchaseId: bought.id,
      businessDate: "2026-10-02",
      lines: [{ purchaseItemId: item.id, quantity: "2" }],
    });
    assert.equal(returned.ok, true);
    // 2 of 5 units back: 20.00 less owed, no cash moves
    assert.equal((await getSupplier(t.org.id, supplier.id))?.outstanding, "30.00");

    const line = await prisma.journalLine.findFirstOrThrow({
      where: { organizationId: t.org.id, debit: { gt: 0 }, account: { roles: { some: { role: "AP" } } }, journal: { docType: "PURCHASE_RETURN" } },
    });
    assert.equal(line.partyType, "VENDOR");
    assert.equal(line.partyId, supplier.id);
    assert.equal(line.debit.toFixed(2), "20.00");
    assert.deepEqual(await partyLineViolations(prisma, t.org.id), []);
  });
});
