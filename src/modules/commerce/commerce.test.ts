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

test("phase 11 quotations and requisitions do not post money or stock", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { acceptQuotation, convertQuotation, createQuotation, sendQuotation } = await import("./quotations.ts");
  const { approveRequisition, createRequisition, fulfillRequisition, rejectRequisition } = await import("./requisitions.ts");

  const stamp = Date.now().toString();
  const org = await prisma.organization.create({ data: { name: "Quote A", slug: `quote-a-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Clerk", email: `clerk-${stamp}@example.com`, passwordHash: "not-used" },
  });
  const customer = await prisma.customer.create({ data: { organizationId: org.id, name: "Harbor Pantry", createdById: user.id } });
  const actor = { organizationId: org.id, branchId: branch.id, userId: user.id, ip: "127.0.0.1", userAgent: "test" };

  try {
    const key = randomUUID();
    const created = await createQuotation({ ...actor, idempotencyKey: key, customerId: customer.id, businessDate: "2026-10-01", note: "Window quote" });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    assert.equal(created.number?.startsWith("QUO-2026-"), true);
    const replay = await createQuotation({ ...actor, idempotencyKey: key, customerId: customer.id, businessDate: "2026-10-01", note: "Window quote" });
    assert.equal(replay.ok && replay.replayed, true);
    const skipped = await acceptQuotation({ ...actor, quotationId: created.id });
    assert.equal(skipped.ok, false);
    const sent = await sendQuotation({ ...actor, quotationId: created.id });
    assert.equal(sent.ok, true);
    const sentAgain = await sendQuotation({ ...actor, quotationId: created.id });
    assert.equal(sentAgain.ok, false);
    const accepted = await acceptQuotation({ ...actor, quotationId: created.id });
    assert.equal(accepted.ok, true);
    const converted = await convertQuotation({ organizationId: org.id, branchId: branch.id, quotationId: created.id });
    assert.equal(converted.ok, false);
    const stored = await prisma.quotation.findFirst({ where: { id: created.id } });
    assert.equal(stored?.status, "ACCEPTED");
    assert.equal(await prisma.sale.count({ where: { organizationId: org.id } }), 0);
    assert.equal(await prisma.journal.count({ where: { organizationId: org.id } }), 0);
    assert.equal(await prisma.customerLedger.count({ where: { organizationId: org.id } }), 0);

    const request = await createRequisition({ ...actor, idempotencyKey: randomUUID(), businessDate: "2026-10-01", note: "Need bags" });
    assert.equal(request.ok, true);
    if (!request.ok) {
      return;
    }
    assert.equal(request.number?.startsWith("REQ-2026-"), true);
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
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.idempotencyKey.deleteMany({ where: { organizationId: org.id } });
    await prisma.quotation.deleteMany({ where: { organizationId: org.id } });
    await prisma.requisition.deleteMany({ where: { organizationId: org.id } });
    await prisma.customer.deleteMany({ where: { organizationId: org.id } });
    await prisma.documentSequence.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.branch.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});
