import "../helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { addDays, businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { createBankAccount, postCapital } from "../../modules/accounting/books.ts";
import { postCustomerPayment } from "../../modules/customers/dues.ts";
import { postDamage, postOpeningStock, postTakeOff } from "../../modules/inventory/documents.ts";
import { confirmOrder, createOrder, dispatchOrder } from "../../modules/orders/orders.ts";
import { postPurchase } from "../../modules/purchasing/orders.ts";
import { postSupplierPayment } from "../../modules/purchasing/purchases.ts";
import { postInvoice } from "../../modules/sales/invoice.ts";
import { postSaleReturn } from "../../modules/sales/returns.ts";
import { postContraTransfer } from "../../modules/treasury/contra.ts";
import { listCategories, payExpense } from "../../modules/treasury/expenses.ts";
import { factories } from "../helpers/index.ts";
import type { TestOrg } from "../helpers/test-org.ts";

// The golden day (P11, 06 §4): one day of a farm-supply shop like Green Agricare, small enough to work out by hand. Every figure in EXPECTED was
// worked out on paper from the steps below, not by running the reports; the test runs the ten daily reports and compares.
//
// The day before: the owner puts 50,000 in the cash; opening stock: 100 bags of urea at 1,000, 50 bottles of pesticide at 300, 200 packets of
// seed at 50. A customer (Karim), a vendor (Agro Mill), a courier (Steadfast: delivery 60, condition 1%), a bKash account.
//
// The day:
//  1. 25 bags of urea bought from Agro Mill on credit at 1,000, transport 500 paid in cash: landed 25,500, average cost (100,000 + 25,500) / 125
//     = 1,004.
//  2. Cash sale at the till (Walk-in): 2 urea at 1,200 = 2,400. Cost 2,008.
//  3. Sale to Karim paid by bKash: 5 pesticide at 400 = 2,000, the service keeps 37 (into bKash 1,963). Cost 1,500.
//  4. Courier order to Karim: 10 seed at 70 = 700, sent by Steadfast: cash to collect 700, delivery 60 and condition 7 off it, courier owes 633.
//     Cost 500.
//  5. Credit sale to Karim: 3 urea at 1,200 = 3,600. Cost 3,012. One bag comes back: 1,200 off what he owes, the bag back at 1,004.
//  6. Karim pays 1,000 in cash.
//  7. One bottle of pesticide is damaged (loss 300). Two packets of seed are given away as samples (100).
//  8. Rent 5,000 paid from the cash. 10,000 moved from the cash to the bank. 5,000 paid to Agro Mill from the bank.

type T = TestOrg;

export const EXPECTED = {
  cash: { opening: "50000.00", sales: "2400.00", dues: "1000.00", expenses: "5000.00", payments: "500.00", toBank: "10000.00", closing: "37900.00" },
  bank: { opening: "0.00", in: "11963.00", out: "5000.00", closing: "6963.00", bkashCharge: "37.00", bkashClosing: "1963.00", bankClosing: "5000.00" },
  receive: { total: "15363.00", transfers: "10000.00", withoutTransfers: "5363.00" },
  payment: { total: "20500.00", transfers: "10000.00", withoutTransfers: "10500.00" },
  sales: { invoices: "4", sales: "8700.00", returns: "1200.00", net: "7500.00", cash: "2400.00", mobile: "2000.00", creditOwed: "1400.00", creditStatus: "PARTIAL", gross: "1680.00" },
  due: { karim: { opening: "0.00", added: "6300.00", paid: "3000.00", returned: "1200.00", other: "-700.00", closing: "1400.00" }, customersOwe: "1400.00", vendorOwed: "20000.00", vendor: { added: "25000.00", paid: "5000.00", closing: "20000.00" } },
  condition: { handed: "700.00", delivery: "60.00", condition: "7.00", closing: "633.00" },
  expenses: { total: "5204.00" },
  stock: { urea: { opening: "100", purchased: "25", sold: "5", returnedIn: "1", closing: "121", value: "121484.00" }, pesticide: { sold: "5", damaged: "1", closing: "44", value: "13200.00" }, seed: { sold: "10", takenOff: "2", closing: "188", value: "9400.00" }, value: "144084.00" },
  profit: { gross: "1484.00", net: "-4020.00" },
} as const;

export async function buildAgriDay(t: T) {
  const day = today();
  const before = addDays(day, -1);
  const actor = () => ({ ...t.actor, idempotencyKey: randomUUID() });
  const docs = () => ({ organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, warehouseId: t.warehouse.id, ip: "127.0.0.1", userAgent: "test", idempotencyKey: randomUUID() });
  const ok = (label: string, result: { ok: boolean }) => assert.equal(result.ok, true, `${label}: ${JSON.stringify(result)}`);
  const f = factories(t);

  // the day before
  const urea = await f.product({ name: "Urea bag 50kg", purchasePrice: "1000.00", sellingPrice: "1200.00", wholesalePrice: "1150.00", minimumPrice: "1000.00" });
  const pesticide = await f.product({ name: "Pesticide bottle", purchasePrice: "300.00", sellingPrice: "400.00", wholesalePrice: "380.00", minimumPrice: "300.00" });
  const seed = await f.product({ name: "Seed packet", purchasePrice: "50.00", sellingPrice: "70.00", wholesalePrice: "65.00", minimumPrice: "50.00" });
  ok("capital", await postCapital({ ...actor(), businessDate: before, capitalType: "ADDED", ownerName: "Owner", amount: "50000.00", method: "CASH" }));
  ok("opening stock", await postOpeningStock({ ...docs(), businessDate: before, lines: [{ productId: urea.id, quantity: "100", unitCost: "1000.0000" }, { productId: pesticide.id, quantity: "50", unitCost: "300.0000" }, { productId: seed.id, quantity: "200", unitCost: "50.0000" }] }));
  const karim = await f.customer({ name: "Karim" });
  const vendor = await f.vendor({ name: "Agro Mill" });
  const courier = await prisma.courier.create({ data: { organizationId: t.org.id, name: "Steadfast", defaultConditionPercent: "1", defaultDeliveryCharge: "60", outsideDeliveryCharge: "110" } });
  ok("bKash", await createBankAccount({ ...actor(), name: "bKash", kind: "MOBILE", accountNumber: "01711-000000" }));
  const bkash = await prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id, name: "bKash" } });
  const cash = (await prisma.accountRole.findFirstOrThrow({ where: { organizationId: t.org.id, role: "CASH" } })).accountId;
  const bank = (await prisma.accountRole.findFirstOrThrow({ where: { organizationId: t.org.id, role: "BANK:DEFAULT" } })).accountId;

  // 1. purchase
  ok("purchase", await postPurchase({ ...actor(), warehouseId: t.warehouse.id, supplierId: vendor.id, businessDate: day, transportCost: "500.00", transportPaidWith: "CASH", lines: [{ productId: urea.id, quantity: "25", unitCost: "1000.00" }] }));
  // 2. cash sale at the till
  ok("cash sale", await postInvoice({ ...actor(), businessDate: day, lines: [{ productId: urea.id, quantity: "2" }], tenders: [{ method: "CASH", amount: "2400.00" }] }));
  // 3. bKash sale with its charge
  ok("bKash sale", await postInvoice({ ...actor(), businessDate: day, customerId: karim.id, lines: [{ productId: pesticide.id, quantity: "5" }], tenders: [{ method: "MOBILE", accountId: bkash.id, amount: "2000.00", charge: "37.00" }] }));
  // 4. courier order
  const order = await createOrder(actor(), { customerId: karim.id, businessDate: day, deliveryMethod: "COURIER", shippingAddress: "Village Char, Dhaka", lines: [{ productId: seed.id, quantity: "10" }] });
  ok("order", order);
  const orderId = order.ok ? order.id : "";
  ok("confirm", await confirmOrder(actor(), orderId));
  ok("dispatch", await dispatchOrder(actor(), orderId, { dispatchedOn: day, shipment: { courierId: courier.id } }));
  // 5. credit sale and one bag back
  const credit = await postInvoice({ ...actor(), businessDate: day, customerId: karim.id, lines: [{ productId: urea.id, quantity: "3" }] });
  ok("credit sale", credit);
  const creditId = credit.ok ? credit.id : "";
  const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: creditId } });
  ok("return", await postSaleReturn({ ...actor(), saleId: creditId, businessDate: day, refundMethod: "AR_ONLY", lines: [{ saleItemId: item.id, quantity: "1" }] }));
  // 6. Karim pays 1,000
  ok("due collected", await postCustomerPayment({ ...actor(), customerId: karim.id, businessDate: day, amount: "1000.00", method: "CASH" }));
  // 7. damage and samples
  ok("damage", await postDamage({ ...docs(), productId: pesticide.id, businessDate: day, place: "Store", purchasePrice: "300.00", salePrice: "400.00", discountAmount: "0.00", vatAmount: "0.00", quantity: "1", reason: "Leaked" }));
  ok("samples", await postTakeOff({ ...docs(), businessDate: day, purpose: "SAMPLE", recipient: "Farmers' meeting", approvedBy: "Owner", lines: [{ productId: seed.id, quantity: "2" }] } as Parameters<typeof postTakeOff>[0]));
  // 8. rent, cash to bank, pay the vendor
  const rent = (await listCategories(t.org.id)).find((row) => row.name === "Rent");
  assert.ok(rent);
  ok("rent", await payExpense({ ...actor(), businessDate: day, categoryId: rent.id, moneyAccountId: cash, amount: "5000.00" }));
  ok("cash to bank", await postContraTransfer({ ...actor(), businessDate: day, fromAccountId: cash, toAccountId: bank, amount: "10000.00" }));
  ok("pay the vendor", await postSupplierPayment({ ...actor(), supplierId: vendor.id, businessDate: day, amount: "5000.00", method: "BANK" }));

  return { day, ids: { urea: urea.id, pesticide: pesticide.id, seed: seed.id, karim: karim.id, vendor: vendor.id, courier: courier.id, bkash: bkash.id, bank, cash, credit: creditId } };
}
