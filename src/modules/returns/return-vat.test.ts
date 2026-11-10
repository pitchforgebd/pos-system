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
process.env.AUTH_SECRET ??= "test-secret-return-vat-value";
process.env.BCRYPT_COST = "4";

test("a customer return reverses the discount, the sales credit, and the VAT payable", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { hashPassword } = await import("../auth/password.ts");
  const { getSale, postSale } = await import("../sales/sales.ts");
  const { postSaleReturn } = await import("../sales/returns.ts");

  const stamp = `${Date.now()}-vat`;
  const org = await prisma.organization.create({ data: { name: "Return VAT", slug: `return-vat-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: branch.id, name: "Main" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Cashier", email: `return-vat-${stamp}@example.com`, passwordHash: await hashPassword("correct-password") },
  });
  const { ensureChart } = await import("../../core/ledger/chart.ts");
  await ensureChart(prisma, org.id);
  async function makeProduct(name: string, sellingPrice: string) {
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        sku: `${name}-${stamp}`,
        liveSku: `${name}-${stamp}`,
        name,
        slug: `${name}-${stamp}`.toLowerCase(),
        purchasePrice: "1.00",
        sellingPrice,
        wholesalePrice: sellingPrice,
        minimumPrice: "1.00",
        vatType: "EXCLUSIVE",
        vatValue: "10",
        trackStock: true,
        trackExpiry: false,
        trackBatch: false,
        trackSerial: false,
      },
    });
    await prisma.stockBalance.create({
      data: { organizationId: org.id, productId: product.id, branchId: branch.id, warehouseId: warehouse.id, quantity: "10.0000" },
    });
    await prisma.stockLedger.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        branchId: branch.id,
        warehouseId: warehouse.id,
        quantity: "10.0000",
        direction: "IN",
        movementType: "OPENING",
        referenceType: "test",
        referenceId: product.id,
        unitCost: "1.00",
        userId: user.id,
      },
    });
    return product;
  }

  const actor = { organizationId: org.id, branchId: branch.id, userId: user.id, warehouseId: warehouse.id, ip: "127.0.0.1", userAgent: "test" };

  async function accountNet(code: string) {
    const lines = await prisma.journalLine.findMany({ where: { organizationId: org.id, account: { code } }, select: { debit: true, credit: true } });
    return lines.reduce((sum, line) => sum.plus(line.credit).minus(line.debit), new (await import("@prisma/client")).Prisma.Decimal(0));
  }

  async function returnLines(returnId: string) {
    const lines = await prisma.journalLine.findMany({
      where: { journal: { saleReturn: { id: returnId } } },
      include: { account: { select: { code: true } } },
    });
    const pick = (code: string, side: "debit" | "credit") =>
      lines.filter((line) => line.account.code === code).reduce((sum, line) => sum + Number(line[side]), 0).toFixed(2);
    return { salesDebit: pick("4100", "debit"), vatDebit: pick("2300", "debit"), cashCredit: pick("1100", "credit") };
  }

  try {
    // 3 x 10.00 = 30.00, discount 3.00, VAT 10% of 27.00 = 2.70, the customer pays 29.70.
    const discounted = await makeProduct("disc", "10.00");
    const sold = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      lines: [{ productId: discounted.id, quantity: "3", discountAmount: "3.00" }],
      paymentAmount: "29.70",
      paymentMethod: "CASH",
    });
    assert.equal(sold.ok, true);
    const sale = sold.ok ? await getSale(org.id, branch.id, sold.id) : null;
    assert.equal(sale?.total, "29.70");
    assert.equal((await accountNet("2300")).toFixed(2), "2.70");
    assert.equal((await accountNet("4100")).toFixed(2), "27.00");
    const itemId = sale?.items[0]?.id ?? "";

    const first = await postSaleReturn({
      ...actor,
      idempotencyKey: randomUUID(),
      saleId: sold.ok ? sold.id : "",
      businessDate: "2026-10-02",
      lines: [{ saleItemId: itemId, quantity: "1" }],
    });
    assert.equal(first.ok, true);
    if (first.ok) {
      // One third of 29.70 is 9.90 (not the 10.00 list price): 9.00 sales credit and 0.90 VAT.
      assert.equal(first.total, "9.90");
      assert.deepEqual(await returnLines(first.id), { salesDebit: "9.00", vatDebit: "0.90", cashCredit: "9.90" });
    }

    const rest = await postSaleReturn({
      ...actor,
      idempotencyKey: randomUUID(),
      saleId: sold.ok ? sold.id : "",
      businessDate: "2026-10-03",
      lines: [{ saleItemId: itemId, quantity: "2" }],
    });
    assert.equal(rest.ok, true);
    if (rest.ok) {
      assert.equal(rest.total, "19.80");
      assert.deepEqual(await returnLines(rest.id), { salesDebit: "18.00", vatDebit: "1.80", cashCredit: "19.80" });
    }
    // Everything came back: nothing is left owing as VAT or kept as sales.
    assert.equal((await accountNet("2300")).toFixed(2), "0.00");
    assert.equal((await accountNet("4100")).toFixed(2), "0.00");

    // Rounding: 3 x 3.33 = 9.99, VAT 1.00, total 10.99. Three single returns add up exactly.
    const rounded = await makeProduct("round", "3.33");
    const soldRounded = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      lines: [{ productId: rounded.id, quantity: "3" }],
      paymentAmount: "10.99",
      paymentMethod: "CASH",
    });
    assert.equal(soldRounded.ok, true);
    const roundedSale = soldRounded.ok ? await getSale(org.id, branch.id, soldRounded.id) : null;
    const roundedItem = roundedSale?.items[0]?.id ?? "";
    const totals: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const result = await postSaleReturn({
        ...actor,
        idempotencyKey: randomUUID(),
        saleId: soldRounded.ok ? soldRounded.id : "",
        businessDate: "2026-10-04",
        lines: [{ saleItemId: roundedItem, quantity: "1" }],
      });
      assert.equal(result.ok, true);
      totals.push(result.ok ? (result.total ?? "") : "");
    }
    assert.deepEqual(totals, ["3.66", "3.66", "3.67"]);
    assert.equal((await accountNet("2300")).toFixed(2), "0.00");
    assert.equal((await accountNet("4100")).toFixed(2), "0.00");

    const journals = await prisma.journal.findMany({ where: { organizationId: org.id }, include: { lines: true } });
    for (const journal of journals) {
      const debit = journal.lines.reduce((sum, line) => sum + Number(line.debit), 0);
      const credit = journal.lines.reduce((sum, line) => sum + Number(line.credit), 0);
      assert.equal(debit.toFixed(2), credit.toFixed(2));
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
