import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { stockedProduct, withTestOrg } from "../../tests/helpers/index.ts";
import { createCustomer } from "../customers/customers.ts";
import { getCustomerProfile, statementOf } from "../customers/profile.ts";
import { createSupplier } from "../purchasing/suppliers.ts";
import { postInvoice } from "../sales/invoice.ts";
import { findCustomers, findVendors } from "./directory.ts";
import { geography, normalizeBdPhone } from "./profile.ts";

// P10 tasks 1-5 (D15): the places of Bangladesh, customer and vendor codes, a Bangladeshi phone, district required on the form, a phone used twice
// is a warning, search by part of a name/phone/code/business with filters, and the customer's page and statement from the books.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const who = (t: T) => ({ organizationId: t.org.id, actorId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });
const dhaka = async () => (await prisma.district.findFirstOrThrow({ where: { name: "Dhaka" } })).id;
const district = async (name: string) => (await prisma.district.findFirstOrThrow({ where: { name } })).id;

test("the places: 8 divisions, 64 districts with Bangla names, every upazila in a district", async () => {
  const geo = await geography();
  assert.deepEqual([geo.divisions.length, geo.districts.length], [8, 64]);
  assert.ok(geo.upazilas.length >= 490, "the upazilas are there");
  const named = geo.districts.find((row) => row.name === "Dhaka");
  assert.equal(named?.bnName, "ঢাকা");
  assert.ok(geo.districts.every((row) => geo.divisions.some((division) => division.id === row.divisionId)));
  assert.ok(geo.upazilas.every((row) => geo.districts.some((d) => d.id === row.districtId)));
  assert.ok(geo.divisions.some((row) => row.name === "Chattogram" && row.bnName === "চট্টগ্রাম"));
});

test("a Bangladeshi mobile number is read in its usual forms and anything else is refused", () => {
  for (const [typed, want] of [
    ["01711000000", "01711000000"],
    ["+8801711000000", "01711000000"],
    ["8801911 222 333", "01911222333"],
    ["017-1100-0000", "01711000000"],
    ["01211000000", null],
    ["0171100000", null],
    ["02 9555555", null],
    ["", null],
  ] as const) {
    assert.equal(normalizeBdPhone(typed), want, typed);
  }
});

test("a new customer gets the next code; the district must exist and the upazila must be in it; a phone used before is a warning, not a refusal", async () => {
  await withTestOrg(async (t) => {
    const dhakaId = await dhaka();
    const savar = await prisma.upazila.findFirstOrThrow({ where: { districtId: dhakaId } });
    const elsewhere = await prisma.upazila.findFirstOrThrow({ where: { districtId: { not: dhakaId } } });
    const first = await createCustomer({ ...who(t), name: "Rahim", phone: "+880 1711-000000", districtId: dhakaId, upazilaId: savar.id, businessName: "Rahim Traders", tags: "dealer, rice, dealer", paymentDays: 15 });
    assert.equal(first.ok, true, JSON.stringify(first));
    const second = await createCustomer({ ...who(t), name: "Karim", phone: "01711000000", districtId: dhakaId });
    assert.equal(second.ok, true, JSON.stringify(second));
    if (!first.ok || !second.ok) {
      return;
    }
    assert.deepEqual([first.customer.code, second.customer.code], ["CUS-00001", "CUS-00002"]);
    assert.deepEqual(second.samePhone.map((row) => row.code), ["CUS-00001"], "the same phone: a warning naming the other customer");
    const stored = await prisma.customer.findUniqueOrThrow({ where: { id: first.customer.id } });
    assert.deepEqual([stored.phone, stored.tags, stored.paymentDays, stored.businessName], ["01711000000", "dealer, rice", 15, "Rahim Traders"]);
    assert.equal((await createCustomer({ ...who(t), name: "Bad phone", phone: "12345", districtId: dhakaId })).ok, false);
    assert.equal((await createCustomer({ ...who(t), name: "Wrong upazila", districtId: dhakaId, upazilaId: elsewhere.id })).ok, false);
    assert.equal((await createCustomer({ ...who(t), name: "No district", districtId: 9999 })).ok, false);
    const vendor = await createSupplier({ ...who(t), name: "Mill", openingPayable: "0.00", districtId: await district("Bogura"), contactPerson: "Selim", bankDetails: "City Bank, Bogura, 123" });
    assert.equal(vendor.ok && vendor.supplier.code, "VEN-00001");
  });
});

test("search: part of the name, phone, other phone, code or business; district, type and owes filters; a page at a time", async () => {
  await withTestOrg(async (t) => {
    const [dhakaId, rajshahi] = [await dhaka(), await district("Rajshahi")];
    const made: string[] = [];
    for (let i = 1; i <= 7; i += 1) {
      const row = await createCustomer({ ...who(t), name: `Farmer ${i}`, phone: `0171100000${i}`, altPhone: i === 3 ? "01999888777" : null, businessName: i === 2 ? "Green Seeds" : null, districtId: i <= 4 ? dhakaId : rajshahi });
      assert.equal(row.ok, true, JSON.stringify(row));
      made.push(row.ok ? row.customer.id : "");
    }
    const names = async (filter: Parameters<typeof findCustomers>[1]) => (await findCustomers(t.org.id, filter)).rows.map((row) => row.name);
    assert.deepEqual(await names({ q: "Green" }), ["Farmer 2"], "business name");
    assert.deepEqual(await names({ q: "999888" }), ["Farmer 3"], "other phone");
    assert.deepEqual(await names({ q: "CUS-00005" }), ["Farmer 5"], "code");
    assert.deepEqual(await names({ q: "01711000006" }), ["Farmer 6"], "phone");
    assert.equal((await findCustomers(t.org.id, { districtId: rajshahi })).total, 3);
    const product = await stockedProduct(t, { units: 10, cost: "6.00", price: "10.00" });
    const sold = await postInvoice({ ...t.actor, idempotencyKey: randomUUID(), businessDate: today(), customerId: made[0], lines: [{ productId: product.id, quantity: "2" }] });
    assert.equal(sold.ok, true, JSON.stringify(sold));
    assert.deepEqual(await names({ due: "YES" }), ["Farmer 1"]);
    assert.equal((await findCustomers(t.org.id, { due: "NO" })).total, 6, "Walk-in is not listed");
    const page = await findCustomers(t.org.id, { pageSize: 25, page: 1 });
    assert.deepEqual([page.total, page.pageCount, page.rows[0].district], [7, 1, "Dhaka"]);
    assert.equal((await findCustomers(t.org.id, { pageSize: 25, page: 2 })).rows.length, 0);
    const vendors = await findVendors(t.org.id, { q: "nothing" });
    assert.equal(vendors.total, 0);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("the customer's page: bought in all, last bought, owes, invoices with what is still owed; the statement runs the balance", async () => {
  await withTestOrg(async (t) => {
    const made = await createCustomer({ ...who(t), name: "Sumi", phone: "01811000000", districtId: await dhaka() });
    assert.ok(made.ok);
    const id = made.ok ? made.customer.id : "";
    const product = await stockedProduct(t, { units: 20, cost: "6.00", price: "10.00" });
    const a = await postInvoice({ ...t.actor, idempotencyKey: randomUUID(), businessDate: today(), customerId: id, lines: [{ productId: product.id, quantity: "5" }], tenders: [{ method: "CASH", amount: "20.00" }] });
    const b = await postInvoice({ ...t.actor, idempotencyKey: randomUUID(), businessDate: today(), customerId: id, lines: [{ productId: product.id, quantity: "3" }], tenders: [{ method: "CASH", amount: "30.00" }] });
    assert.ok(a.ok && b.ok, JSON.stringify([a, b]));
    const profile = await getCustomerProfile(t.org.id, id);
    assert.deepEqual([profile?.summary.invoices, profile?.summary.bought, profile?.summary.due, profile?.summary.lastPurchase], [2, "80.00", "30.00", today()]);
    assert.deepEqual(profile?.invoices.map((row) => [row.total, row.owed, row.status]).sort(), [["30.00", "0.00", "PAID"], ["50.00", "30.00", "PARTIAL"]]);
    assert.equal(profile?.code, "CUS-00001");
    const statement = await statementOf(t.org.id, "CUSTOMER", id, today(), today());
    assert.equal(statement?.closing, "30.00");
    assert.equal(statement?.rows.at(-1)?.balance, "30.00");
    assert.equal(statement?.opening, "0.00");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("the API: a customer needs a district (D15); the answer says who else has the phone; same-phone lookup", async () => {
  const customers = await import("../../app/api/v1/customers/route.ts");
  const samePhone = await import("../../app/api/v1/customers/same-phone/route.ts");
  await withTestOrg(async (t) => {
    const { openSession } = await import("../auth/session.ts");
    const { token } = await openSession({ organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });
    const call = async (route: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>, path: string, body?: unknown) => {
      const response = await route(new Request(`http://localhost${path}`, { method: body ? "POST" : "GET", headers: { origin: "http://localhost", cookie: `meridian_session=${token}`, "content-type": "application/json", "idempotency-key": randomUUID() }, body: body ? JSON.stringify(body) : undefined }), { params: Promise.resolve({}) });
      return { status: response.status, body: (await response.json()) as { data?: Record<string, unknown> & unknown[]; error?: { message: string } } };
    };
    const without = await call(customers.POST, "/api/v1/customers", { name: "No place", phone: "01711000000" });
    assert.deepEqual([without.status, without.body.error?.message], [400, "Choose the district."]);
    const first = await call(customers.POST, "/api/v1/customers", { name: "A", phone: "01711000000", districtId: await dhaka() });
    const second = await call(customers.POST, "/api/v1/customers", { name: "B", phone: "+8801711000000", districtId: await dhaka() });
    assert.deepEqual([first.status, second.status], [201, 201]);
    assert.deepEqual((second.body.data?.samePhone as unknown as Array<{ name: string }>).map((row) => row.name), ["A"]);
    const looked = await call(samePhone.GET, "/api/v1/customers/same-phone?phone=01711-000000");
    assert.deepEqual((looked.body.data as unknown as Array<{ name: string }>).map((row) => row.name).sort(), ["A", "B"]);
  });
});
