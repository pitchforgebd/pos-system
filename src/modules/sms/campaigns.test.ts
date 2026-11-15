import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { addDays, businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { stockedProduct, withTestOrg } from "../../tests/helpers/index.ts";
import { createCustomer } from "../customers/customers.ts";
import { postInvoice } from "../sales/invoice.ts";
import { getCampaign, listCampaigns, previewCampaign, segment, sendCampaign, type Filter } from "./campaigns.ts";

// P10 tasks 8-9 (features 4, 15): a segment of customers by district, type, last purchase, total bought, what they owe and how late, and what they
// bought; checked against a golden set. Who opted out is never in it. A campaign puts one message per customer in the outbox, once.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const district = async (name: string) => (await prisma.district.findFirstOrThrow({ where: { name } })).id;
const who = (t: T) => ({ organizationId: t.org.id, actorId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });

async function goldenSet(t: T) {
  const [dhaka, gazipur, rajshahi] = [await district("Dhaka"), await district("Gazipur"), await district("Rajshahi")];
  const dealer = await prisma.customerType.create({ data: { organizationId: t.org.id, name: "Dealer" } });
  const retail = await prisma.customerType.create({ data: { organizationId: t.org.id, name: "Retail" } });
  const [seeds, tools] = [await prisma.category.create({ data: { organizationId: t.org.id, name: "Seeds" } }), await prisma.category.create({ data: { organizationId: t.org.id, name: "Tools" } })];
  const p1 = await stockedProduct(t, { units: 500, cost: "6.00", price: "10.00" });
  const p2 = await stockedProduct(t, { units: 500, cost: "6.00", price: "10.00" });
  await prisma.product.update({ where: { id: p1.id }, data: { categoryId: seeds.id } });
  await prisma.product.update({ where: { id: p2.id }, data: { categoryId: tools.id } });
  const add = async (name: string, input: { districtId: number; phone?: string | null; type?: string; smsOptOut?: boolean }) => {
    const made = await createCustomer({ ...who(t), name, phone: input.phone === undefined ? `0171${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}` : input.phone, districtId: input.districtId, customerTypeId: input.type ?? null, smsOptOut: input.smsOptOut ?? false });
    assert.ok(made.ok, JSON.stringify(made));
    return made.ok ? made.customer.id : "";
  };
  const people = {
    A: await add("A Dhaka retail", { districtId: dhaka, type: retail.id }),
    B: await add("B Dhaka dealer", { districtId: dhaka, type: dealer.id }),
    C: await add("C Gazipur never bought", { districtId: gazipur }),
    D: await add("D Rajshahi opted out", { districtId: rajshahi, smsOptOut: true }),
    E: await add("E Dhaka no phone", { districtId: dhaka, phone: null }),
    F: await add("F Gazipur dealer", { districtId: gazipur, type: dealer.id }),
  };
  const sell = async (customerId: string, productId: string, quantity: string, paid: string | null, daysAgo: number) => {
    const sold = await postInvoice({ ...t.actor, idempotencyKey: randomUUID(), businessDate: today(), customerId, lines: [{ productId, quantity }], tenders: paid ? [{ method: "CASH", amount: paid }] : [] });
    assert.ok(sold.ok, JSON.stringify(sold));
    if (sold.ok && daysAgo > 0) {
      // only the date the segment reads (when they last bought) is moved back
      await prisma.sale.update({ where: { id: sold.id }, data: { businessDate: new Date(`${addDays(today(), -daysAgo)}T00:00:00.000Z`) } });
    }
  };
  await sell(people.A, p1.id, "30", "300.00", 60); // bought 300, paid, 60 days ago, Seeds
  await sell(people.B, p2.id, "5", null, 40); // bought 50 on credit, 40 days ago, Tools
  await sell(people.D, p1.id, "50", "500.00", 0); // opted out
  await sell(people.F, p1.id, "100", "800.00", 0); // bought 1000 today, owes 200, Seeds
  return { people, dhaka, gazipur, dealer: dealer.id, p1: p1.id, tools: tools.id };
}

test("the segment filters reach exactly the golden set; opted-out, Walk-in and customers without a mobile number are never in it", async () => {
  await withTestOrg(async (t) => {
    const g = await goldenSet(t);
    const name = Object.fromEntries(Object.entries(g.people).map(([key, id]) => [id, key]));
    const reach = async (filters: Filter[]) => (await segment(t.org.id, filters)).map((row) => name[row.id]).sort().join("");
    assert.equal(await reach([]), "ABCF", "no filter: everyone who can get an SMS");
    assert.equal(await reach([{ field: "DISTRICT", value: String(g.dhaka) }]), "AB", "E has no mobile number");
    assert.equal(await reach([{ field: "DISTRICT", value: String(g.dhaka) }, { field: "DISTRICT", value: String(g.gazipur) }]), "ABCF", "the same field twice is either");
    assert.equal(await reach([{ field: "CUSTOMER_TYPE", value: g.dealer }]), "BF");
    assert.equal(await reach([{ field: "HAS_DUE", value: "YES" }]), "BF");
    assert.equal(await reach([{ field: "HAS_DUE", value: "NO" }]), "AC");
    assert.equal(await reach([{ field: "DUE_OLDER_THAN_DAYS", value: "30" }]), "B", "F's invoice is from today");
    assert.equal(await reach([{ field: "DUE_OLDER_THAN_DAYS", value: "TERMS" }]), "B", "no days to pay given: due the same day, so F's invoice of today is not late yet");
    await prisma.customer.update({ where: { id: g.people.B }, data: { paymentDays: 60 } });
    assert.equal(await reach([{ field: "DUE_OLDER_THAN_DAYS", value: "TERMS" }]), "", "B has 60 days to pay an invoice of 40 days ago");
    assert.equal(await reach([{ field: "LAST_PURCHASE_BEFORE", value: addDays(today(), -30) }]), "AB");
    assert.equal(await reach([{ field: "LAST_PURCHASE_AFTER", value: addDays(today(), -50) }]), "BF");
    assert.equal(await reach([{ field: "TOTAL_PURCHASE_MIN", value: "300" }]), "AF");
    assert.equal(await reach([{ field: "TOTAL_PURCHASE_MAX", value: "100" }]), "BC", "C bought nothing: 0");
    assert.equal(await reach([{ field: "BOUGHT_PRODUCT", value: g.p1 }]), "AF");
    assert.equal(await reach([{ field: "BOUGHT_CATEGORY", value: g.tools }]), "B");
    assert.equal(await reach([{ field: "DISTRICT", value: String(g.dhaka) }, { field: "HAS_DUE", value: "YES" }]), "B", "different fields: all of them");
    await assert.rejects(segment(t.org.id, [{ field: "HAS_DUE", value: "maybe" }]));
    await assert.rejects(segment(t.org.id, [{ field: "LAST_PURCHASE_AFTER", value: "yesterday" }]));
  });
});

test("an offer campaign: the preview counts people and SMS parts; sending queues one message per customer (never the opted-out), once", async () => {
  await withTestOrg(async (t) => {
    const g = await goldenSet(t);
    await prisma.setting.create({ data: { organizationId: t.org.id, key: "sms.unitPrice", value: "0.35" } });
    const message = { body: "{customer_name}, {offer_text} - {shop_name}", offerText: "বীজে ১০% ছাড় এই সপ্তাহে" };
    const filters: Filter[] = [{ field: "DISTRICT", value: String(g.dhaka) }, { field: "DISTRICT", value: String(g.gazipur) }];
    const preview = await previewCampaign(t.org.id, { ...message, filters });
    assert.ok(preview.ok, JSON.stringify(preview));
    if (!preview.ok) {
      return;
    }
    assert.equal(preview.recipients, 4);
    assert.equal(preview.partsEach.encoding, "UNICODE", "Bangla offer text");
    assert.ok(preview.totalParts >= 4);
    assert.equal(preview.cost, (0.35 * preview.totalParts).toFixed(2));
    assert.match(preview.sample[0].body, /^A Dhaka retail, বীজে ১০% ছাড় এই সপ্তাহে - /);
    const key = randomUUID();
    const input = { ...t.actor, idempotencyKey: key, name: "Seed week", kind: "OFFER" as const, ...message, filters };
    const sent = await sendCampaign(input);
    assert.ok(sent.ok, JSON.stringify(sent));
    const again = await sendCampaign(input);
    assert.ok(again.ok && again.replayed, "the same key is the same campaign");
    const messages = await prisma.smsMessage.findMany({ where: { organizationId: t.org.id, campaignId: sent.ok ? sent.id : "" } });
    assert.equal(messages.length, 4);
    assert.ok(messages.every((row) => row.status === "QUEUED" && row.customerId));
    assert.ok(!messages.some((row) => row.customerId === g.people.D), "the opted-out customer is not sent to");
    const [listed] = await listCampaigns(t.org.id);
    assert.deepEqual([listed.recipients, listed.waiting, listed.sent, listed.failed, listed.status], [4, 4, 0, 0, "QUEUED"]);
    const report = await getCampaign(t.org.id, listed.id);
    assert.deepEqual(report?.filters.map((row) => row.field), ["DISTRICT", "DISTRICT"]);
    assert.equal((await sendCampaign({ ...input, idempotencyKey: randomUUID(), filters: [{ field: "CUSTOMER_TYPE", value: randomUUID() }] })).ok, false, "a segment that reaches nobody");
  });
});

test("the due reminder goes to those whose invoice is overdue, with what each owes", async () => {
  await withTestOrg(async (t) => {
    const g = await goldenSet(t);
    const sent = await sendCampaign({ ...t.actor, idempotencyKey: randomUUID(), name: "Overdue", kind: "DUE_REMINDER", body: "{customer_name}, please pay {due_amount} Tk.", filters: [{ field: "DUE_OLDER_THAN_DAYS", value: "30" }] });
    assert.ok(sent.ok, JSON.stringify(sent));
    const messages = await prisma.smsMessage.findMany({ where: { organizationId: t.org.id, campaignId: sent.ok ? sent.id : "" } });
    assert.deepEqual(messages.map((row) => [row.customerId, row.body]), [[g.people.B, "B Dhaka dealer, please pay 50.00 Tk."]]);
  });
});

test("through the API: a preview needs sms.manage; sending needs sms.campaign as well", async () => {
  const campaigns = await import("../../app/api/v1/sms/campaigns/route.ts");
  const preview = await import("../../app/api/v1/sms/campaigns/preview/route.ts");
  const { openSession } = await import("../auth/session.ts");
  const body = { body: "{customer_name}, {offer_text}", offerText: "Sale", filters: [] };
  for (const [permissions, previewStatus, sendStatus] of [
    [["sms.manage"], 200, 403],
    [["sms.manage", "sms.campaign"], 200, 201],
  ] as const) {
    await withTestOrg(
      async (t) => {
        await createCustomer({ ...who(t), name: "Reachable", phone: "01711000000", districtId: await district("Dhaka") });
        const { token } = await openSession({ organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });
        const post = (route: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>, path: string, payload: unknown) =>
          route(new Request(`http://localhost${path}`, { method: "POST", headers: { origin: "http://localhost", cookie: `meridian_session=${token}`, "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(payload) }), { params: Promise.resolve({}) });
        const looked = await post(preview.POST, "/api/v1/sms/campaigns/preview", body);
        assert.equal(looked.status, previewStatus);
        assert.equal(((await looked.json()) as { data?: { recipients: number } }).data?.recipients, 1);
        const sent = await post(campaigns.POST, "/api/v1/sms/campaigns", { ...body, name: "API offer", kind: "OFFER" });
        assert.equal(sent.status, sendStatus, JSON.stringify(permissions));
      },
      { permissions: [...permissions] },
    );
  }
});
