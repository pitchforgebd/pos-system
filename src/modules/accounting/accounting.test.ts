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
process.env.AUTH_SECRET ??= "test-secret-phase-09-value";
process.env.BCRYPT_COST = "4";

test("phase 09 journals balance and reversals do not edit the original", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { hashPassword } = await import("../auth/password.ts");
  const { accountStatement, createBankAccount, getJournal, postCapital, postCashVoucher, postContra, postExpense, postIncome, postJournal, postLoan, reverseJournal } = await import("./books.ts");

  const stamp = Date.now().toString();
  const org = await prisma.organization.create({ data: { name: "Books A", slug: `books-a-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Accountant", email: `books-${stamp}@example.com`, passwordHash: await hashPassword("correct-password") },
  });
  const { ensureChart } = await import("../../core/ledger/chart.ts");
  await ensureChart(prisma, org.id);
  const actor = { organizationId: org.id, branchId: branch.id, userId: user.id, ip: "127.0.0.1", userAgent: "test" };

  try {
    const unbalanced = await postJournal({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      description: "Unbalanced",
      lines: [
        { accountCode: "1100", debit: "10.00", credit: "0.00" },
        { accountCode: "1200", debit: "0.00", credit: "4.00" },
      ],
    });
    assert.equal(unbalanced.ok, false);
    assert.equal(await prisma.journal.count({ where: { organizationId: org.id } }), 0);

    const key = randomUUID();
    const posted = await postJournal({
      ...actor,
      idempotencyKey: key,
      businessDate: "2026-10-01",
      description: "Move cash",
      lines: [
        { accountCode: "1100", debit: "10.00", credit: "0.00" },
        { accountCode: "1200", debit: "0.00", credit: "10.00" },
      ],
    });
    assert.equal(posted.ok, true);
    if (posted.ok) {
      assert.match(posted.number ?? "", /^VCH-2627-\d{6}$/);
    }
    const replay = await postJournal({
      ...actor,
      idempotencyKey: key,
      businessDate: "2026-10-01",
      description: "Move cash",
      lines: [
        { accountCode: "1100", debit: "10.00", credit: "0.00" },
        { accountCode: "1200", debit: "0.00", credit: "10.00" },
      ],
    });
    assert.equal(replay.ok && replay.replayed, true);

    const original = posted.ok ? await getJournal(org.id, branch.id, posted.id) : null;
    const reversal = await reverseJournal({
      ...actor,
      idempotencyKey: randomUUID(),
      journalId: posted.ok ? posted.id : "",
      businessDate: "2026-10-02",
    });
    assert.equal(reversal.ok, true);
    const again = await reverseJournal({
      ...actor,
      idempotencyKey: randomUUID(),
      journalId: posted.ok ? posted.id : "",
      businessDate: "2026-10-02",
    });
    assert.equal(again.ok, false);
    const still = posted.ok ? await getJournal(org.id, branch.id, posted.id) : null;
    assert.deepEqual(still?.lines.map((line) => [line.accountCode, line.debit, line.credit]), original?.lines.map((line) => [line.accountCode, line.debit, line.credit]));

    const wrongAccount = await postExpense({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      accountCode: "1100",
      amount: "15.00",
      method: "CASH",
    });
    assert.equal(wrongAccount.ok, false);
    const rent = await postExpense({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      accountCode: "6100",
      amount: "15.00",
      method: "CASH",
    });
    assert.equal(rent.ok, true);
    if (rent.ok) {
      assert.match(rent.number ?? "", /^EXP-2627-\d{6}$/);
    }
    const contra = await postContra({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      direction: "CASH_TO_BANK",
      amount: "5.00",
    });
    assert.equal(contra.ok, true);

    const statement = await accountStatement({ organizationId: org.id, branchId: branch.id, accountCode: "1100", from: "2026-10-01", to: "2026-10-02" });
    assert.equal(statement?.opening, "0.00");
    assert.equal(statement?.lines.at(-1)?.balance, "-20.00");

    const income = await postIncome({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      accountCode: "4200",
      amount: "8.00",
      method: "CASH",
      category: "Rent received",
    });
    assert.equal(income.ok, true);
    const capital = await postCapital({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      capitalType: "ADDED",
      ownerName: "Owner",
      amount: "25.00",
      method: "CASH",
    });
    assert.equal(capital.ok, true);
    const loan = await postLoan({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      direction: "RECEIVED",
      lender: "City Bank",
      amount: "40.00",
      method: "BANK",
    });
    assert.equal(loan.ok, true);
    const payment = await postCashVoucher({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      voucherType: "PAYMENT",
      accountCode: "6100",
      amount: "3.00",
      method: "CASH",
    });
    assert.equal(payment.ok, true);
    const salesReceipt = await postCashVoucher({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      voucherType: "RECEIPT",
      accountCode: "4100",
      amount: "3.00",
      method: "CASH",
    });
    assert.equal(salesReceipt.ok, false);
    const bank = await createBankAccount({
      ...actor,
      idempotencyKey: randomUUID(),
      name: "Dutch Bangla",
      openingAmount: "12.00",
    });
    assert.equal(bank.ok, true);
    if (bank.ok) {
      assert.equal(bank.number, "1201");
    }

    const journals = await prisma.journal.findMany({ where: { organizationId: org.id }, include: { lines: true } });
    assert.ok(journals.length >= 3);
    for (const journal of journals) {
      const debit = journal.lines.reduce((sum, line) => sum + Number(line.debit), 0);
      const credit = journal.lines.reduce((sum, line) => sum + Number(line.credit), 0);
      assert.equal(debit, credit);
    }
    // I2: every receivable and payable line these postings wrote names its party.
    const { partyLineViolations } = await import("../../core/posting/invariants.ts");
    assert.deepEqual(await partyLineViolations(prisma, org.id), []);
  } finally {
    const { cleanupOrg } = await import("../../tests/helpers/cleanup.ts");
    await cleanupOrg(org.id);
    await prisma.$disconnect();
  }
});
