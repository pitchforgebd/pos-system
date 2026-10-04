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
delete process.env.SMS_PROVIDER_URL;

test("phase 13 sms substitutes text, fails closed, and does not post a journal", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { createTemplate, requestRecharge, retrySms, saveSmsSettings, sendSms, smsDashboard } = await import("./sms.ts");
  const { renderTemplate } = await import("./templates.ts");

  const stamp = Date.now().toString();
  const org = await prisma.organization.create({ data: { name: "SMS A", slug: `sms-a-${stamp}` } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Sender", email: `sender-${stamp}@example.com`, passwordHash: "not-used" },
  });
  const actor = { organizationId: org.id, actorId: user.id, userId: user.id, ip: "127.0.0.1", userAgent: "test" };

  try {
    const rejected = await createTemplate({
      organizationId: org.id,
      actorId: user.id,
      name: "Bad",
      kind: "BILL",
      body: "Hello {secret}",
      ip: "127.0.0.1",
      userAgent: "test",
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.equal(rejected.message, "That variable is not allowed.");
    }
    assert.equal(await prisma.smsTemplate.count({ where: { organizationId: org.id } }), 0);

    const rendered = renderTemplate("Hi {customer_name}", { customer_name: "1+1" });
    assert.equal(rendered.ok, true);
    if (rendered.ok) {
      assert.equal(rendered.body, "Hi 1+1");
    }

    const saved = await createTemplate({
      organizationId: org.id,
      actorId: user.id,
      name: "Bill",
      kind: "BILL",
      body: "Hi {customer_name}",
      ip: "127.0.0.1",
      userAgent: "test",
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) {
      return;
    }

    const journalsBefore = await prisma.journal.count({ where: { organizationId: org.id } });
    const key = randomUUID();
    const sent = await sendSms({
      ...actor,
      idempotencyKey: key,
      recipient: "01700000000",
      templateId: saved.template.id,
      variables: { customer_name: "Mina" },
    });
    assert.equal(sent.ok, true);
    if (!sent.ok) {
      return;
    }
    assert.equal(sent.status, "FAILED");
    const again = await sendSms({
      ...actor,
      idempotencyKey: key,
      recipient: "01700000000",
      templateId: saved.template.id,
      variables: { customer_name: "Mina" },
    });
    assert.equal(again.ok, true);
    if (again.ok) {
      assert.equal(again.replayed, true);
    }
    assert.equal(await prisma.smsMessage.count({ where: { organizationId: org.id } }), 1);
    assert.equal(await prisma.smsLog.count({ where: { organizationId: org.id } }), 1);
    assert.equal(await prisma.notificationLog.count({ where: { organizationId: org.id, channel: "SMS" } }), 1);
    assert.equal(await prisma.journal.count({ where: { organizationId: org.id } }), journalsBefore);

    const retried = await retrySms({ organizationId: org.id, userId: user.id, messageId: sent.id, idempotencyKey: randomUUID() });
    assert.equal(retried.ok, true);
    if (retried.ok) {
      assert.equal(retried.status, "FAILED");
    }
    assert.equal(await prisma.smsLog.count({ where: { organizationId: org.id } }), 2);

    await prisma.smsMessage.update({ where: { id: sent.id }, data: { status: "SENT" } });
    const held = await retrySms({ organizationId: org.id, userId: user.id, messageId: sent.id, idempotencyKey: randomUUID() });
    assert.equal(held.ok, false);
    if (!held.ok) {
      assert.equal(held.message, "A sent message is not retried.");
    }
    await prisma.smsMessage.update({ where: { id: sent.id }, data: { status: "FAILED" } });

    const blocked = await requestRecharge({ ...actor, idempotencyKey: randomUUID(), quantity: "10", occurredOn: "2026-10-01" });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.message, "Set a per-SMS price before requesting a recharge.");
    }

    const priced = await saveSmsSettings({ ...actor, sender: "Shop", provider: "Label", unitPrice: "0.40" });
    assert.equal(priced.ok, true);
    const recharge = await requestRecharge({ ...actor, idempotencyKey: randomUUID(), quantity: "10", occurredOn: "2026-10-01" });
    assert.equal(recharge.ok, true);
    if (recharge.ok) {
      assert.equal(recharge.amount, "4.00");
    }
    assert.equal(await prisma.journal.count({ where: { organizationId: org.id } }), journalsBefore);
    const dashboard = await smsDashboard(org.id);
    assert.equal(dashboard.quantity, "10.0000");
    assert.equal(dashboard.totalPurchase, "4.00");
    assert.equal(dashboard.sentTotal, 0);
    assert.equal(dashboard.balance, "4.00");
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.idempotencyKey.deleteMany({ where: { organizationId: org.id } });
    await prisma.smsLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.smsMessage.deleteMany({ where: { organizationId: org.id } });
    await prisma.smsTemplate.deleteMany({ where: { organizationId: org.id } });
    await prisma.smsRechargeRequest.deleteMany({ where: { organizationId: org.id } });
    await prisma.notificationLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.setting.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});
