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
process.env.AUTH_SECRET ??= "test-secret-phase-10-value";
process.env.BCRYPT_COST = "4";

test("phase 10 posts customer due and advance without inventing points", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { hashPassword } = await import("../auth/password.ts");
  const { createCustomer, outstandingReceivable, updateCustomer } = await import("./customers.ts");
  const { postCustomerPayment } = await import("./dues.ts");
  const { postCustomerAdvance } = await import("./advances.ts");
  const { closeInstallment, createInstallment } = await import("./installments.ts");
  const { createLoyaltyTier, rejectLoyaltyPost } = await import("./loyalty.ts");

  const stamp = Date.now().toString();
  const org = await prisma.organization.create({ data: { name: "Due A", slug: `due-a-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Collector",
      email: `collector-${stamp}@example.com`,
      passwordHash: await hashPassword("correct-password"),
    },
  });
  const asset = await prisma.accountGroup.create({ data: { organizationId: org.id, code: "1000", name: "Assets" } });
  const equity = await prisma.accountGroup.create({ data: { organizationId: org.id, code: "3000", name: "Equity" } });
  await prisma.account.createMany({
    data: [
      { organizationId: org.id, groupId: asset.id, code: "1100", name: "Cash" },
      { organizationId: org.id, groupId: asset.id, code: "1200", name: "Bank" },
      { organizationId: org.id, groupId: asset.id, code: "1300", name: "Accounts Receivable" },
      { organizationId: org.id, groupId: equity.id, code: "3100", name: "Owner Capital" },
    ],
  });
  const actor = {
    organizationId: org.id,
    branchId: branch.id,
    userId: user.id,
    ip: "127.0.0.1",
    userAgent: "test",
  };

  try {
    const created = await createCustomer({
      ...actor,
      actorId: user.id,
      name: "Harbor Pantry",
      openingBalance: "10.00",
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    assert.equal((await outstandingReceivable(org.id, created.customer.id)).toFixed(2), "10.00");
    const beforePayment = await prisma.journal.count({ where: { organizationId: org.id } });
    assert.equal(beforePayment, 1);

    const key = randomUUID();
    const payment = await postCustomerPayment({
      ...actor,
      idempotencyKey: key,
      customerId: created.customer.id,
      occurredOn: "2026-10-01",
      amount: "4.00",
      method: "CASH",
    });
    assert.equal(payment.ok, true);
    if (payment.ok) {
      assert.equal(payment.number?.startsWith("PAY-2026-"), true);
    }
    const replay = await postCustomerPayment({
      ...actor,
      idempotencyKey: key,
      customerId: created.customer.id,
      occurredOn: "2026-10-01",
      amount: "4.00",
      method: "CASH",
    });
    assert.equal(replay.ok, true);
    if (replay.ok) {
      assert.equal(replay.replayed, true);
    }
    const over = await postCustomerPayment({
      ...actor,
      idempotencyKey: randomUUID(),
      customerId: created.customer.id,
      occurredOn: "2026-10-01",
      amount: "7.00",
      method: "CASH",
    });
    assert.equal(over.ok, false);
    assert.equal((await outstandingReceivable(org.id, created.customer.id)).toFixed(2), "6.00");

    const advance = await postCustomerAdvance({
      ...actor,
      idempotencyKey: randomUUID(),
      customerId: created.customer.id,
      occurredOn: "2026-10-01",
      amount: "2.00",
      method: "BANK",
    });
    assert.equal(advance.ok, true);
    assert.equal((await outstandingReceivable(org.id, created.customer.id)).toFixed(2), "4.00");
    const advanceLine = await prisma.customerLedger.findFirst({
      where: { customerId: created.customer.id, entryType: "ADVANCE" },
    });
    assert.equal(advanceLine?.credit.toFixed(2), "2.00");
    assert.equal(await prisma.customerPayment.count({ where: { customerId: created.customer.id } }), 1);
    assert.equal(await prisma.customerAdvance.count({ where: { customerId: created.customer.id } }), 1);

    const journals = await prisma.journal.findMany({ where: { organizationId: org.id }, include: { lines: { include: { account: true } } } });
    assert.equal(journals.length, 3);
    for (const journal of journals) {
      const debit = journal.lines.reduce((sum, line) => sum + Number(line.debit), 0);
      const credit = journal.lines.reduce((sum, line) => sum + Number(line.credit), 0);
      assert.equal(debit, credit);
    }
    const bank = journals.find((journal) => journal.description === "Customer advance");
    assert.equal(bank?.lines.some((line) => line.account.code === "1200" && line.debit.toFixed(2) === "2.00"), true);
    assert.equal(bank?.lines.some((line) => line.account.code === "1300" && line.credit.toFixed(2) === "2.00"), true);

    const sale = await prisma.sale.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        customerId: created.customer.id,
        status: "POSTED",
        total: "10.00",
        occurredOn: new Date("2026-10-01T00:00:00.000Z"),
        createdById: user.id,
      },
    });
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        saleId: sale.id,
        customerId: created.customer.id,
        number: `INV-TEST-${stamp}`,
        total: "10.00",
      },
    });
    const tooBig = await createInstallment({
      ...actor,
      actorId: user.id,
      customerId: created.customer.id,
      invoiceId: invoice.id,
      amount: "11.00",
      dueOn: "2026-10-05",
    });
    assert.equal(tooBig.ok, false);
    const reminder = await createInstallment({
      ...actor,
      actorId: user.id,
      customerId: created.customer.id,
      invoiceId: invoice.id,
      amount: "6.00",
      dueOn: "2026-09-01",
    });
    assert.equal(reminder.ok, true);
    const rest = await createInstallment({
      ...actor,
      actorId: user.id,
      customerId: created.customer.id,
      invoiceId: invoice.id,
      amount: "5.00",
      dueOn: "2026-10-20",
    });
    assert.equal(rest.ok, false);
    if (reminder.ok) {
      const closed = await closeInstallment({
        organizationId: org.id,
        actorId: user.id,
        installmentId: reminder.installment.id,
        ip: "127.0.0.1",
        userAgent: "test",
      });
      assert.equal(closed.ok, true);
      const again = await closeInstallment({
        organizationId: org.id,
        actorId: user.id,
        installmentId: reminder.installment.id,
        ip: "127.0.0.1",
        userAgent: "test",
      });
      assert.equal(again.ok, false);
    }
    assert.equal(await prisma.journal.count({ where: { organizationId: org.id } }), 3);

    const points = rejectLoyaltyPost();
    assert.equal(points.ok, false);
    assert.equal(await prisma.loyaltyTransaction.count({ where: { organizationId: org.id } }), 0);
    const tier = await createLoyaltyTier({
      organizationId: org.id,
      actorId: user.id,
      name: "Silver",
      minimumSpend: "10.00",
      discountPercent: "2.00",
      ip: "127.0.0.1",
      userAgent: "test",
    });
    assert.equal(tier.ok, true);

    const edited = await updateCustomer({
      organizationId: org.id,
      actorId: user.id,
      customerId: created.customer.id,
      name: "Harbor Pantry",
      status: "INACTIVE",
      ip: "127.0.0.1",
      userAgent: "test",
    });
    assert.equal(edited.ok, true);
    const stored = await prisma.customer.findFirst({ where: { id: created.customer.id } });
    assert.equal(stored?.openingBalance.toFixed(2), "10.00");
    const blocked = await postCustomerPayment({
      ...actor,
      idempotencyKey: randomUUID(),
      customerId: created.customer.id,
      occurredOn: "2026-10-02",
      amount: "1.00",
      method: "CASH",
    });
    assert.equal(blocked.ok, false);
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.idempotencyKey.deleteMany({ where: { organizationId: org.id } });
    await prisma.loyaltyCard.deleteMany({ where: { organizationId: org.id } });
    await prisma.loyaltyTransaction.deleteMany({ where: { organizationId: org.id } });
    await prisma.loyaltyTier.deleteMany({ where: { organizationId: org.id } });
    await prisma.crmAssignment.deleteMany({ where: { organizationId: org.id } });
    await prisma.crmActivity.deleteMany({ where: { organizationId: org.id } });
    await prisma.crmContact.deleteMany({ where: { organizationId: org.id } });
    await prisma.crmSegment.deleteMany({ where: { organizationId: org.id } });
    await prisma.installment.deleteMany({ where: { organizationId: org.id } });
    await prisma.customerPayment.deleteMany({ where: { organizationId: org.id } });
    await prisma.customerAdvance.deleteMany({ where: { organizationId: org.id } });
    await prisma.customerLedger.deleteMany({ where: { organizationId: org.id } });
    await prisma.invoice.deleteMany({ where: { organizationId: org.id } });
    await prisma.sale.deleteMany({ where: { organizationId: org.id } });
    await prisma.journalLine.deleteMany({ where: { organizationId: org.id } });
    await prisma.journal.deleteMany({ where: { organizationId: org.id } });
    await prisma.customer.deleteMany({ where: { organizationId: org.id } });
    await prisma.customerType.deleteMany({ where: { organizationId: org.id } });
    await prisma.account.deleteMany({ where: { organizationId: org.id } });
    await prisma.accountGroup.deleteMany({ where: { organizationId: org.id } });
    await prisma.documentSequence.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.branch.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});
