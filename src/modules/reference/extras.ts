import { randomUUID } from "node:crypto";
import { RuleError } from "@/core/errors/rule-error";
import { dateOnly } from "@/core/time/business-date";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { postBalancedJournal } from "@/modules/accounting/post";
import { decimalString, parseQuantity } from "@/core/money";
import { applyMovement, resolveWarehouse, StockRuleError } from "@/modules/inventory/stock";

type Actor = {
  organizationId: string;
  branchId: string;
  userId: string;
  ip: string;
  userAgent: string | null;
};

function failure(error: unknown) {
  if (error instanceof RuleError) {
    const status = error.status;
    return { ok: false as const, status: status as 404 | 409 | 422, code: "BUSINESS_RULE" as const, message: error.message };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { ok: false as const, status: 409 as const, code: "CONFLICT" as const, message: "That value is already used." };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Choose records that already exist." };
  }
  return null;
}

function day(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export async function listSerials(organizationId: string) {
  const rows = await prisma.productSerial.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, serial: true, status: true, product: { select: { sku: true, name: true } } },
  });
  return rows.map((row) => ({ id: row.id, serial: row.serial, status: row.status, sku: row.product.sku, name: row.product.name }));
}

export async function addSerial(input: Actor & { productId: string; serial: string }) {
  const serial = input.serial.trim();
  if (!serial) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter an IMEI or serial." };
  }
  const product = await prisma.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId, deletedAt: null, trackSerial: true },
    select: { id: true },
  });
  if (!product) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Choose a product that tracks serial numbers." };
  }
  try {
    const row = await prisma.productSerial.create({
      data: { organizationId: input.organizationId, productId: product.id, serial, status: "IN_STOCK" },
      select: { id: true },
    });
    await writeAudit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "create",
      module: "products",
      entityType: "product_serial",
      entityId: row.id,
      after: { serial },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ok: true as const, id: row.id };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function listClaims(organizationId: string) {
  const rows = await prisma.warrantyClaim.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, serial: true, note: true, status: true, product: { select: { name: true } }, customer: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    productName: row.product.name,
    customerName: row.customer.name,
    serial: row.serial ?? "",
    note: row.note,
    status: row.status,
  }));
}

export async function fileClaim(input: Actor & { productId: string; customerId: string; serial?: string; note: string }) {
  const note = input.note.trim();
  if (!note) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a claim note." };
  }
  try {
    const row = await prisma.warrantyClaim.create({
      data: {
        organizationId: input.organizationId,
        branchId: input.branchId,
        productId: input.productId,
        customerId: input.customerId,
        serial: input.serial?.trim() || null,
        note,
      },
      select: { id: true },
    });
    return { ok: true as const, id: row.id };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function closeClaim(input: { organizationId: string; claimId: string }) {
  const current = await prisma.warrantyClaim.findFirst({
    where: { id: input.claimId, organizationId: input.organizationId },
    select: { id: true, status: true },
  });
  if (!current) {
    return { ok: false as const, status: 404 as const, code: "NOT_FOUND" as const, message: "That claim was not found." };
  }
  if (current.status === "CLOSED") {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "That claim is already closed." };
  }
  await prisma.warrantyClaim.update({ where: { id: current.id }, data: { status: "CLOSED" } });
  return { ok: true as const, id: current.id };
}

export async function listCouriers(organizationId: string) {
  return prisma.courier.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, phone: true },
  });
}

export async function addCourier(input: { organizationId: string; name: string; phone?: string | null }) {
  const name = input.name.trim();
  if (!name) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a courier name." };
  }
  try {
    const row = await prisma.courier.create({
      data: { organizationId: input.organizationId, name, phone: input.phone?.trim() || null },
      select: { id: true },
    });
    return { ok: true as const, id: row.id };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function listShipments(organizationId: string, branchId: string) {
  const rows = await prisma.shipment.findMany({
    where: { organizationId, branchId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, reference: true, trackingCode: true, status: true, courier: { select: { name: true } }, customer: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    courierName: row.courier.name,
    customerName: row.customer?.name ?? "",
    reference: row.reference ?? "",
    trackingCode: row.trackingCode ?? "",
    status: row.status,
  }));
}

export async function addShipment(input: Actor & { courierId: string; customerId?: string; reference?: string; trackingCode?: string }) {
  try {
    const row = await prisma.shipment.create({
      data: {
        organizationId: input.organizationId,
        branchId: input.branchId,
        courierId: input.courierId,
        customerId: input.customerId || null,
        reference: input.reference?.trim() || null,
        trackingCode: input.trackingCode?.trim() || null,
      },
      select: { id: true },
    });
    return { ok: true as const, id: row.id };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function listDirectReturns(organizationId: string, branchId: string) {
  const rows = await prisma.directReturn.findMany({
    where: { organizationId, branchId },
    orderBy: { businessDate: "desc" },
    take: 100,
    select: { id: true, quantity: true, refundAmount: true, method: true, businessDate: true, product: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    productName: row.product.name,
    quantity: decimalString(row.quantity, 4),
    refundAmount: decimalString(row.refundAmount, 2),
    method: row.method,
    businessDate: dateOnly(row.businessDate),
  }));
}

export async function postDirectReturn(input: Actor & { productId: string; quantity: string; refundAmount: string; method: "CASH" | "BANK"; businessDate: string }) {
  try {
    const data = await prisma.$transaction(async (tx) => {
      const quantity = parseQuantity(input.quantity);
      const warehouse = await resolveWarehouse(input.organizationId, input.branchId);
      if (!warehouse) {
        throw new StockRuleError("Choose an active warehouse on the current branch.");
      }
      const rows = await tx.stockLedger.findMany({
        where: { organizationId: input.organizationId, productId: input.productId, variantId: null, branchId: input.branchId, warehouseId: warehouse.id, direction: "IN" },
        select: { unitCost: true, quantity: true },
      });
      if (rows.length === 0 || rows.some((row) => row.unitCost === null)) {
        throw new StockRuleError("A direct return needs a stock-in cost for this product.");
      }
      let costQty = new Prisma.Decimal(0);
      let costAmount = new Prisma.Decimal(0);
      for (const row of rows) {
        const rowQuantity = new Prisma.Decimal(row.quantity);
        costQty = costQty.plus(rowQuantity);
        costAmount = costAmount.plus(rowQuantity.mul(row.unitCost ?? 0));
      }
      if (costQty.lte(0)) {
        throw new StockRuleError("A direct return needs a stock-in cost for this product.");
      }
      const unitCost = costAmount.div(costQty).toDecimalPlaces(4);
      const refund = parseQuantity(input.refundAmount);
      if (!quantity || !refund || refund.lte(0)) {
        throw new StockRuleError("Enter a quantity and a refund greater than zero.");
      }
      const moneyRefund = refund.toDecimalPlaces(2);
      const cost = unitCost.mul(quantity).toDecimalPlaces(2);
      const cash = input.method === "BANK" ? "1200" : "1100";
      const id = randomUUID();
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: day(input.businessDate),
        description: "Direct return",
        createdById: input.userId,
        lines: [
          { accountCode: "4100", debit: moneyRefund, credit: new Prisma.Decimal(0) },
          { accountCode: cash, debit: new Prisma.Decimal(0), credit: moneyRefund },
          { accountCode: "1400", debit: cost, credit: new Prisma.Decimal(0) },
          { accountCode: "5100", debit: new Prisma.Decimal(0), credit: cost },
        ],
      });
      await applyMovement(tx, {
        organizationId: input.organizationId,
        productId: input.productId,
        branchId: input.branchId,
        warehouseId: warehouse.id,
        quantity,
        direction: "IN",
        movementType: "CUSTOMER_RETURN",
        referenceType: "direct_return",
        referenceId: id,
        userId: input.userId,
        unitCost,
      });
      await tx.directReturn.create({
        data: {
          id,
          organizationId: input.organizationId,
          branchId: input.branchId,
          warehouseId: warehouse.id,
          productId: input.productId,
          quantity,
          refundAmount: moneyRefund,
          method: input.method,
          journalId,
          businessDate: day(input.businessDate),
        },
      });
      return { id };
    });
    return { ok: true as const, id: data.id };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function listDealers(organizationId: string) {
  const rows = await prisma.customer.findMany({
    where: { organizationId, customerType: { name: "Dealer" } },
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true, phone: true },
  });
  return rows;
}

export async function markDealer(input: { organizationId: string; customerId: string }) {
  const existing = await prisma.customerType.findFirst({
    where: { organizationId: input.organizationId, name: "Dealer" },
    select: { id: true },
  });
  const type = existing ?? (await prisma.customerType.create({
    data: { organizationId: input.organizationId, name: "Dealer" },
    select: { id: true },
  }));
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!customer) {
    return { ok: false as const, status: 404 as const, code: "NOT_FOUND" as const, message: "That customer was not found." };
  }
  await prisma.customer.update({ where: { id: customer.id }, data: { customerTypeId: type.id } });
  return { ok: true as const, id: customer.id };
}

export async function redeemLoyalty(input: Actor & { customerId: string; points: string; businessDate: string }) {
  const points = parseQuantity(input.points);
  if (!points || points.lte(0)) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter the points to redeem." };
  }
  const shop = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { takaPerPoint: true },
  });
  const rate = shop?.takaPerPoint ?? null;
  if (!rate || rate.lte(0)) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Set taka per point on shop settings before redeeming." };
  }
  try {
    const data = await prisma.$transaction(async (tx) => {
      const sums = await tx.loyaltyTransaction.groupBy({
        by: ["entryType"],
        where: { organizationId: input.organizationId, customerId: input.customerId },
        _sum: { points: true },
      });
      const byType = new Map(sums.map((row) => [row.entryType, new Prisma.Decimal(row._sum.points ?? 0)]));
      const balance = (byType.get("EARN") ?? new Prisma.Decimal(0))
        .plus(byType.get("ADJUST") ?? 0)
        .minus(byType.get("REDEEM") ?? 0)
        .minus(byType.get("EXPIRE") ?? 0)
        .minus(byType.get("REVERSAL") ?? 0);
      if (balance.lt(points)) {
        throw new StockRuleError("The customer does not have those points.");
      }
      const taka = points.mul(rate).toDecimalPlaces(2);
      const group = await tx.accountGroup.findFirst({ where: { organizationId: input.organizationId, code: "6000" }, select: { id: true } });
      if (!group) {
        throw new StockRuleError("The expense group is missing.");
      }
      await tx.account.upsert({
        where: { organizationId_code: { organizationId: input.organizationId, code: "6500" } },
        update: {},
        create: { organizationId: input.organizationId, groupId: group.id, code: "6500", name: "Loyalty discount" },
      });
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: day(input.businessDate),
        description: "Loyalty redeem",
        createdById: input.userId,
        lines: [
          { accountCode: "6500", debit: taka, credit: new Prisma.Decimal(0) },
          { accountCode: "1300", debit: new Prisma.Decimal(0), credit: taka },
        ],
      });
      await tx.customerLedger.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          customerId: input.customerId,
          businessDate: day(input.businessDate),
          entryType: "ADJUSTMENT",
          credit: taka,
          referenceType: "loyalty",
          referenceId: journalId,
        },
      });
      const entry = await tx.loyaltyTransaction.create({
        data: {
          organizationId: input.organizationId,
          customerId: input.customerId,
          entryType: "REDEEM",
          points,
          businessDate: day(input.businessDate),
          referenceType: "journal",
          referenceId: journalId,
        },
        select: { id: true },
      });
      return { id: entry.id };
    });
    return { ok: true as const, id: data.id };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) return mapped;
    throw error;
  }
}
