import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { factories, stockedProduct, withTestOrg } from "../../tests/helpers/index.ts";
import { postInvoice } from "../sales/invoice.ts";
import { MAX_ATTEMPTS, drainOutbox, enqueueSms } from "./outbox.ts";
import { smsParts } from "./parts.ts";
import { setSmsProviderForTests, type SmsProvider } from "./provider.ts";

// P10 task 6 and 10 (B12, B13): SMS go through an outbox. A failure is tried again and then FAILED; a sent message is never sent twice, even by two
// drains at once; without a provider they wait; a sale's bill SMS exists only if the sale committed. Bangla is counted 70/67 a part.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];

function provider(behaviour: "ok" | "fail", delayMs = 0) {
  const calls: string[] = [];
  const fake: SmsProvider = {
    name: "test",
    async send(to, body) {
      calls.push(`${to}:${body}`);
      if (delayMs) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return behaviour === "ok" ? { ok: true, ref: `ref-${calls.length}`, note: "Sent." } : { ok: false, error: "Gateway down" };
    },
  };
  return { fake, calls };
}

async function queue(t: T, body = "Hello") {
  const queued = await enqueueSms(prisma, { organizationId: t.org.id, to: "+8801711000000", body });
  assert.ok(queued);
  return queued.id;
}

test("SMS parts: plain text 160 in one SMS and 153 a part; Bangla is Unicode, 70 in one and 67 a part, so 150 Bangla characters are 3", () => {
  assert.deepEqual(smsParts("a".repeat(160)), { encoding: "GSM", length: 160, parts: 1, perPart: 160 });
  assert.equal(smsParts("a".repeat(161)).parts, 2);
  assert.equal(smsParts("{".repeat(80)).parts, 1, "an extension character counts twice: 160");
  assert.equal(smsParts("{".repeat(81)).parts, 2);
  const bangla = "আমাদের দোকানে নতুন অফার".padEnd(150, "ক");
  assert.equal(bangla.length, 150);
  assert.deepEqual(smsParts(bangla), { encoding: "UNICODE", length: 150, parts: 3, perPart: 67 });
  assert.equal(smsParts("ক".repeat(70)).parts, 1);
  assert.equal(smsParts("ক".repeat(71)).parts, 2);
  assert.equal(smsParts("Price 100 টাকা").encoding, "UNICODE", "one Bangla letter makes the whole message Unicode");
});

test("a failing provider: tried again after 1, 2 and 4 minutes, then FAILED after the fourth try; nothing is sent before its time", async () => {
  await withTestOrg(async (t) => {
    const { fake, calls } = provider("fail");
    setSmsProviderForTests(fake);
    try {
      const id = await queue(t);
      const row = () => prisma.smsMessage.findUniqueOrThrow({ where: { id } });
      assert.deepEqual(await drainOutbox({ organizationId: t.org.id }), { configured: true, sent: 0, retrying: 1, failed: 0 });
      const first = await row();
      assert.deepEqual([first.status, first.attempts, first.lastError], ["QUEUED", 1, "Gateway down"]);
      const wait = (first.nextAttemptAt?.getTime() ?? 0) - Date.now();
      assert.ok(wait > 50_000 && wait <= 60_000, `about a minute: ${wait}`);
      await drainOutbox({ organizationId: t.org.id });
      assert.equal(calls.length, 1, "not due yet");
      for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
        await prisma.smsMessage.update({ where: { id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
        await drainOutbox({ organizationId: t.org.id });
      }
      const last = await row();
      assert.deepEqual([last.status, last.attempts, calls.length], ["FAILED", 4, 4]);
      assert.equal(await prisma.smsLog.count({ where: { messageId: id } }), 4, "every try is logged");
      await drainOutbox({ organizationId: t.org.id });
      assert.equal(calls.length, 4, "a failed message is not tried again by itself");
    } finally {
      setSmsProviderForTests(null);
    }
  });
});

test("a working provider: SENT once; a second drain and two drains at once never send it again", async () => {
  await withTestOrg(async (t) => {
    const { fake, calls } = provider("ok", 30);
    setSmsProviderForTests(fake);
    try {
      const ids = [await queue(t, "one"), await queue(t, "two"), await queue(t, "three")];
      const [a, b] = await Promise.all([drainOutbox({ organizationId: t.org.id }), drainOutbox({ organizationId: t.org.id })]);
      assert.equal(a.sent + b.sent, 3, "three messages, each sent by one of the two drains");
      assert.equal(calls.length, 3);
      assert.deepEqual(calls.map((call) => call.split(":")[0]), ["01711000000", "01711000000", "01711000000"]);
      const rows = await prisma.smsMessage.findMany({ where: { id: { in: ids } } });
      assert.ok(rows.every((row) => row.status === "SENT" && row.attempts === 1 && row.sentAt && row.providerRef));
      await drainOutbox({ organizationId: t.org.id });
      assert.equal(calls.length, 3, "a sent message is not sent again");
    } finally {
      setSmsProviderForTests(null);
    }
  });
});

test("without a provider nothing is sent and nothing is lost: the messages wait in the outbox", async () => {
  await withTestOrg(async (t) => {
    setSmsProviderForTests(null);
    const saved = process.env.SMS_PROVIDER;
    delete process.env.SMS_PROVIDER;
    try {
      const id = await queue(t);
      assert.deepEqual(await drainOutbox({ organizationId: t.org.id }), { configured: false, sent: 0, retrying: 0, failed: 0 });
      const row = await prisma.smsMessage.findUniqueOrThrow({ where: { id } });
      assert.deepEqual([row.status, row.attempts], ["QUEUED", 0]);
      assert.equal(await enqueueSms(prisma, { organizationId: t.org.id, to: "12345", body: "x" }), null, "not a mobile number: nothing is queued");
    } finally {
      if (saved !== undefined) {
        process.env.SMS_PROVIDER = saved;
      }
    }
  });
});

test("the bill SMS is written with the sale and only if the sale commits; a refused sale leaves no message (money is never undone by an SMS)", async () => {
  await withTestOrg(async (t) => {
    await prisma.smsTemplate.create({ data: { organizationId: t.org.id, name: "Bill", kind: "BILL", body: "Dear {customer_name}, bill {invoice_number}: {todays_bill}, paid {paid_amount}, due {current_balance}. {shop_name}" } });
    const product = await stockedProduct(t, { units: 10, cost: "6.00", price: "10.00" });
    const customer = await factories(t).customer({ phone: "01811000000", creditLimit: "15.00" });
    const sold = await postInvoice({ ...t.actor, idempotencyKey: randomUUID(), businessDate: today(), customerId: customer.id, lines: [{ productId: product.id, quantity: "3" }], tenders: [{ method: "CASH", amount: "20.00" }] });
    assert.equal(sold.ok, true, JSON.stringify(sold));
    const messages = await prisma.smsMessage.findMany({ where: { organizationId: t.org.id } });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].customerId, customer.id);
    assert.equal(messages[0].status, "QUEUED");
    assert.match(messages[0].body, /^Dear Customer \d+, bill INV-[^:]+: 30\.00, paid 20\.00, due 10\.00\. /);
    const refused = await postInvoice({ ...t.actor, idempotencyKey: randomUUID(), businessDate: today(), customerId: customer.id, lines: [{ productId: product.id, quantity: "5" }] });
    assert.equal(refused.ok, false, "over the credit limit");
    assert.equal(await prisma.smsMessage.count({ where: { organizationId: t.org.id } }), 1, "the refused sale queued nothing");
    const cash = await postInvoice({ ...t.actor, idempotencyKey: randomUUID(), businessDate: today(), lines: [{ productId: product.id, quantity: "1" }], tenders: [{ method: "CASH", amount: "10.00" }] });
    assert.equal(cash.ok, true);
    assert.equal(await prisma.smsMessage.count({ where: { organizationId: t.org.id } }), 1, "Walk-in gets no SMS");
    const { fake, calls } = provider("fail");
    setSmsProviderForTests(fake);
    try {
      await drainOutbox({ organizationId: t.org.id });
      assert.equal(calls.length, 1);
      assert.equal(await prisma.sale.count({ where: { organizationId: t.org.id, status: "POSTED" } }), 2, "the failed SMS did not touch the sales");
    } finally {
      setSmsProviderForTests(null);
    }
  });
});
