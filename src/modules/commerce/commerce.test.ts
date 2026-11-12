import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

for (const line of readFileSync(new URL("../../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}
process.env.AUTH_SECRET ??= "test-secret-phase-11-value";

test("phase 11 requisitions do not post money (quotations are draft orders since P06: see orders.test.ts)", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { approveRequisition, createRequisition, fulfillRequisition, rejectRequisition } = await import("./requisitions.ts");

  const stamp = Date.now().toString();
  const org = await prisma.organization.create({ data: { name: "Quote A", slug: `quote-a-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Clerk", email: `clerk-${stamp}@example.com`, passwordHash: "not-used" },
  });
  const actor = { organizationId: org.id, branchId: branch.id, userId: user.id, ip: "127.0.0.1", userAgent: "test" };

  try {
    const request = await createRequisition({ ...actor, idempotencyKey: randomUUID(), businessDate: "2026-10-01", note: "Need bags" });
    assert.equal(request.ok, true);
    if (!request.ok) {
      return;
    }
    assert.equal(request.number?.startsWith("REQ-2627-"), true);
    const early = await fulfillRequisition({ ...actor, requisitionId: request.id });
    assert.equal(early.ok, false);
    const approved = await approveRequisition({ ...actor, requisitionId: request.id });
    assert.equal(approved.ok, true);
    const rejected = await rejectRequisition({ ...actor, requisitionId: request.id });
    assert.equal(rejected.ok, false);
    const fulfilled = await fulfillRequisition({ ...actor, requisitionId: request.id });
    assert.equal(fulfilled.ok, true);
    assert.equal(await prisma.stockLedger.count({ where: { organizationId: org.id } }), 0);
    const finalStatus = await prisma.requisition.findFirst({ where: { id: request.id } });
    assert.equal(finalStatus?.status, "FULFILLED");
  } finally {
    const { cleanupOrg } = await import("../../tests/helpers/cleanup.ts");
    await cleanupOrg(org.id);
    await prisma.$disconnect();
  }
});
