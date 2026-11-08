import { Prisma } from "@prisma/client";
import { RuleError } from "@/core/errors/rule-error";
import { dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { postBalancedJournal } from "@/modules/accounting/post";
import { outstandingReceivable } from "@/modules/customers/customers";
import { allocateNumber, documentYear } from "@/modules/documents/numbers";
import { hashPayload, idempotentTransaction, isKeyRace, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { decimalString, money, parseMoney, parseQuantity, zero } from "@/core/money";
import { applyMovement, currentUnitCost, resolveWarehouse, StockRuleError } from "@/modules/inventory/stock";
import { occurredDate } from "@/lib/format/date";

type Failure = { ok: false; status: 404 | 409 | 422; code: "NOT_FOUND" | "CONFLICT" | "BUSINESS_RULE"; message: string };

export type SaleLine = {
  productId?: string;
  barcode?: string;
  variantId?: string;
  quantity: string;
  unitPrice?: string;
  discountAmount?: string;
  vatAmount?: string;
  serial?: string;
};

type Actor = {
  organizationId: string;
  branchId: string;
  userId: string;
  warehouseId?: string;
  idempotencyKey: string;
  ip: string;
  userAgent: string | null;
};

function failure(error: unknown): Failure | null {
  if (error instanceof RuleError) {
    const status = error instanceof RuleError ? error.status : 422;
    return {
      ok: false,
      status,
      code: status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : "BUSINESS_RULE",
      message: error.message,
    };
  }
  if (isKeyRace(error)) {
    throw error;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { ok: false, status: 409, code: "CONFLICT", message: "That document number was already used. Try again." };
  }
  return null;
}

export async function postSale(
  input: Actor & {
    businessDate: string;
    customerId?: string;
    ticketId?: string;
    chargesTotal?: string;
    lines: SaleLine[];
    paymentAmount?: string;
    paymentMethod?: "CASH" | "BANK" | "CARD" | "WALLET" | "OTHER";
    allowPriceOverride?: boolean;
    /** Runs inside the sale transaction, so extra writes commit or roll back with the sale. */
    inTransaction?: (tx: Prisma.TransactionClient, sale: { id: string }) => Promise<void>;
  },
) {
  const requestHash = hashPayload({
    businessDate: input.businessDate,
    customerId: input.customerId ?? null,
    ticketId: input.ticketId ?? null,
    warehouseId: input.warehouseId ?? null,
    chargesTotal: input.chargesTotal ?? "0.00",
    lines: input.lines,
    paymentAmount: input.paymentAmount ?? "0.00",
    paymentMethod: input.paymentMethod ?? null,
  });
  try {
    const data = await idempotentTransaction(async (tx) => {
      const existing = await readIdempotency(tx, {
        organizationId: input.organizationId,
        key: input.idempotencyKey,
        requestHash,
      });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        return { id: existing.entityId, replayed: true, number: null as string | null, total: null as string | null };
      }
      const charges = parseMoney(input.chargesTotal ?? "0.00");
      if (!charges || charges.isNeg()) {
        throw new StockRuleError("Enter charges with up to two decimals.");
      }
      const warehouse = await resolveWarehouse(input.organizationId, input.branchId, input.warehouseId);
      if (!warehouse) {
        throw new StockRuleError("Choose an active warehouse on the current branch.");
      }
      const payment = parseMoney(input.paymentAmount ?? "0.00");
      if (!payment) {
        throw new StockRuleError("Enter a payment amount with up to two decimals.");
      }
      const method = input.paymentMethod ?? "CASH";
      if (payment.gt(0) && method !== "CASH" && method !== "BANK" && method !== "CARD" && method !== "WALLET") {
        throw new StockRuleError("Use cash, bank, card, or wallet.");
      }
      const tenderAccount = method === "CASH" ? "1100" : "1200";
      const priced = [];
      for (const line of input.lines) {
        const quantity = parseQuantity(line.quantity);
        if (!quantity) {
          throw new StockRuleError("Enter a quantity greater than zero.");
        }
        const resolved = await resolveLineProduct(tx, input.organizationId, line);
        let unitPrice = new Prisma.Decimal(resolved.sellingPrice);
        if (line.unitPrice) {
          const offered = parseMoney(line.unitPrice);
          if (!offered) {
            throw new StockRuleError("Enter a unit price with up to two decimals.");
          }
          if (!money(offered).eq(money(unitPrice))) {
            if (!input.allowPriceOverride) {
              throw new StockRuleError("The unit price must match the selling price. Price override is not available.");
            }
            if (offered.lt(new Prisma.Decimal(resolved.minimumPrice))) {
              throw new StockRuleError("The unit price is below the minimum price.");
            }
            unitPrice = offered;
          }
        }
        const discount = parseMoney(line.discountAmount ?? "0.00");
        if (!discount || discount.isNeg()) {
          throw new StockRuleError("Enter a discount with up to two decimals.");
        }
        const gross = money(quantity.mul(unitPrice));
        if (discount.gt(gross)) {
          throw new StockRuleError("Discount is greater than the line.");
        }
        const afterDiscount = money(gross.minus(discount));
        const vat = productVat(resolved.vatType, resolved.vatValue, afterDiscount);
        if (line.vatAmount) {
          const offeredVat = parseMoney(line.vatAmount);
          if (!offeredVat || !money(offeredVat).eq(vat)) {
            throw new StockRuleError("The VAT does not match the product.");
          }
        }
        const inclusive = (resolved.vatType ?? "").toUpperCase() === "INCLUSIVE";
        const salesAmount = inclusive ? money(afterDiscount.minus(vat)) : afterDiscount;
        const payable = inclusive ? afterDiscount : money(afterDiscount.plus(vat));
        const unitCost = await currentUnitCost(tx, {
          organizationId: input.organizationId,
          productId: resolved.productId,
          variantId: resolved.variantId,
          branchId: input.branchId,
          warehouseId: warehouse.id,
        });
        priced.push({
          productId: resolved.productId,
          variantId: resolved.variantId,
          quantity,
          unitPrice: money(unitPrice),
          unitCost,
          lineTotal: payable,
          salesAmount,
          vat,
          discount,
          costTotal: money(quantity.mul(unitCost)),
          serial: resolved.trackSerial ? line.serial?.trim() || "" : null,
        });
        if (resolved.trackSerial && (!line.serial?.trim() || !quantity.eq(1))) {
          throw new StockRuleError("Enter one IMEI or serial, and sell that product one unit at a time.");
        }
      }
      const grossTotal = money(priced.reduce((sum, line) => sum.plus(money(line.quantity.mul(line.unitPrice))), zero()));
      const discountTotal = money(priced.reduce((sum, line) => sum.plus(line.discount), zero()));
      const vatTotal = money(priced.reduce((sum, line) => sum.plus(line.vat), zero()));
      const salesCredit = money(priced.reduce((sum, line) => sum.plus(line.salesAmount), zero()));
      const subtotal = money(priced.reduce((sum, line) => sum.plus(line.lineTotal), zero()).plus(charges));
      const cogs = money(priced.reduce((sum, line) => sum.plus(line.costTotal), zero()));
      if (payment.gt(subtotal)) {
        throw new StockRuleError("The payment is greater than the sale total.");
      }
      const due = money(subtotal.minus(payment));
      const customer = await requireCustomer(tx, input.organizationId, input.customerId, method === "WALLET" ? subtotal : due);
      if (method === "WALLET" && payment.gt(0)) {
        if (!customer) {
          throw new StockRuleError("Choose a customer for a wallet payment.");
        }
        const balance = await outstandingReceivable(input.organizationId, customer.id, tx);
        if (balance.neg().lt(payment)) {
          throw new StockRuleError("The wallet balance is smaller than the payment.");
        }
      }
      if (input.ticketId) {
        const ticket = await tx.heldTicket.findFirst({
          where: { id: input.ticketId, organizationId: input.organizationId, branchId: input.branchId },
          select: { id: true },
        });
        if (!ticket) {
          throw new StockRuleError("That record was not found.", 404);
        }
      }
      const number = await allocateNumber(tx, {
        organizationId: input.organizationId,
        documentType: "INV",
        year: documentYear(input.businessDate),
      });
      const sale = await tx.sale.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          warehouseId: warehouse.id,
          customerId: customer?.id ?? null,
          status: "POSTED",
          subtotal: grossTotal,
          discountTotal,
          vatTotal,
          chargesTotal: charges,
          total: subtotal,
          businessDate: occurredDate(input.businessDate),
          createdById: input.userId,
          items: {
            create: priced.map((line) => ({
              organizationId: input.organizationId,
              productId: line.productId,
              variantId: line.variantId ?? null,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountAmount: line.discount,
              vatAmount: line.vat,
              lineTotal: line.lineTotal,
            })),
          },
          invoice: {
            create: {
              organizationId: input.organizationId,
              branchId: input.branchId,
              customerId: customer?.id ?? null,
              number,
              total: subtotal,
            },
          },
        },
        select: { id: true, invoice: { select: { number: true } } },
      });
      for (const line of priced) {
        await applyMovement(tx, {
          organizationId: input.organizationId,
          productId: line.productId,
          variantId: line.variantId,
          branchId: input.branchId,
          warehouseId: warehouse.id,
          quantity: line.quantity,
          direction: "OUT",
          movementType: "SALE",
          referenceType: "sale",
          referenceId: sale.id,
          userId: input.userId,
          unitCost: line.unitCost,
          businessDate: occurredDate(input.businessDate),
        });
      }
      const journalLines = [
        ...(payment.gt(0) && method !== "WALLET" ? [{ accountCode: tenderAccount, debit: payment, credit: zero() }] : []),
        ...(due.gt(0) || (method === "WALLET" && payment.gt(0))
          ? [{ accountCode: "1300", debit: method === "WALLET" ? money(due.plus(payment)) : due, credit: zero() }]
          : []),
        ...(salesCredit.gt(0) ? [{ accountCode: "4100", debit: zero(), credit: salesCredit }] : []),
        ...(vatTotal.gt(0) ? [{ accountCode: "2300", debit: zero(), credit: vatTotal }] : []),
        ...(charges.gt(0) ? [{ accountCode: "4200", debit: zero(), credit: charges }] : []),
        ...(cogs.gt(0)
          ? [
              { accountCode: "5100", debit: cogs, credit: zero() },
              { accountCode: "1400", debit: zero(), credit: cogs },
            ]
          : []),
      ];
      if (journalLines.length > 0) {
        const journalId = await postBalancedJournal(tx, {
          organizationId: input.organizationId,
          branchId: input.branchId,
          businessDate: occurredDate(input.businessDate),
          description: `Sale ${number}`,
          createdById: input.userId,
          lines: journalLines,
        });
        await tx.sale.update({ where: { id: sale.id }, data: { journalId } });
      }
      if (payment.gt(0)) {
        await tx.salePayment.create({
          data: { organizationId: input.organizationId, saleId: sale.id, method, amount: payment },
        });
      }
      const ledgerDebit = method === "WALLET" ? money(due.plus(payment)) : due;
      if (customer && ledgerDebit.gt(0)) {
        await tx.customerLedger.create({
          data: {
            organizationId: input.organizationId,
            branchId: input.branchId,
            customerId: customer.id,
            businessDate: occurredDate(input.businessDate),
            entryType: "SALE",
            debit: ledgerDebit,
            referenceType: "sale",
            referenceId: sale.id,
          },
        });
        if (customer.creditLimit && (await outstandingReceivable(input.organizationId, customer.id, tx)).gt(customer.creditLimit)) {
          throw new StockRuleError("The sale exceeds the customer credit limit.");
        }
      }
      for (const line of priced) {
        if (!line.serial) {
          continue;
        }
        const serial = await tx.productSerial.findFirst({
          where: { organizationId: input.organizationId, serial: line.serial, status: "IN_STOCK" },
          select: { id: true, productId: true },
        });
        if (!serial || serial.productId !== line.productId) {
          throw new StockRuleError("That IMEI is not in stock for this product.");
        }
        await tx.productSerial.update({ where: { id: serial.id }, data: { status: "SOLD", saleId: sale.id } });
      }
      if (customer) {
        const shop = await tx.organization.findUnique({
          where: { id: input.organizationId },
          select: { pointsPerHundred: true },
        });
        if (shop?.pointsPerHundred && shop.pointsPerHundred.gt(0)) {
          const points = subtotal.mul(shop.pointsPerHundred).div(100).toDecimalPlaces(4);
          if (points.gt(0)) {
            await tx.loyaltyTransaction.create({
              data: {
                organizationId: input.organizationId,
                customerId: customer.id,
                entryType: "EARN",
                points,
                businessDate: occurredDate(input.businessDate),
                referenceType: "sale",
                referenceId: sale.id,
              },
            });
          }
        }
      }
      if (input.ticketId) {
        await tx.heldTicket.delete({ where: { id: input.ticketId } });
      }
      await input.inTransaction?.(tx, { id: sale.id });
      await saveIdempotency(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        key: input.idempotencyKey,
        requestHash,
        entityType: "sale",
        entityId: sale.id,
      });
      return { id: sale.id, number: sale.invoice?.number ?? number, replayed: false, total: decimalString(subtotal, 2) };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "sale",
        module: "sales",
        entityType: "sale",
        entityId: data.id,
        after: { number: data.number },
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }
    return { ok: true as const, ...data };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

async function resolveLineProduct(tx: Prisma.TransactionClient, organizationId: string, line: SaleLine) {
  let productId = line.productId ?? null;
  let variantId = line.variantId ?? null;
  if (line.barcode) {
    const barcode = await tx.productBarcode.findFirst({
      where: { organizationId, barcode: line.barcode },
      select: { productId: true, variantId: true },
    });
    if (!barcode) {
      throw new StockRuleError("That record was not found.", 404);
    }
    if (productId && productId !== barcode.productId) {
      throw new StockRuleError("The barcode does not match the product.");
    }
    productId = barcode.productId;
    variantId = variantId ?? barcode.variantId;
  }
  if (!productId) {
    throw new StockRuleError("Choose a product.");
  }
  const product = await tx.product.findFirst({
    where: { id: productId, organizationId, deletedAt: null, status: "ACTIVE" },
    select: { id: true, sellingPrice: true, minimumPrice: true, vatType: true, vatValue: true, trackSerial: true },
  });
  if (!product) {
    throw new StockRuleError("That record was not found.", 404);
  }
  // A variant with its own price sells at that price; otherwise it follows the product.
  let sellingPrice = product.sellingPrice;
  if (variantId) {
    const variant = await tx.productVariant.findFirst({
      where: { id: variantId, productId: product.id, organizationId },
      select: { id: true, price: true },
    });
    if (!variant) {
      throw new StockRuleError("That record was not found.", 404);
    }
    if (variant.price !== null) {
      sellingPrice = variant.price;
    }
  }
  return {
    productId: product.id,
    variantId,
    sellingPrice,
    minimumPrice: product.minimumPrice,
    vatType: product.vatType,
    vatValue: product.vatValue,
    trackSerial: product.trackSerial,
  };
}

function productVat(vatType: string | null, vatValue: Prisma.Decimal | null, base: Prisma.Decimal) {
  if (!vatType || vatValue === null) {
    return zero();
  }
  const rate = new Prisma.Decimal(vatValue);
  if (rate.lte(0)) {
    return zero();
  }
  const type = vatType.toUpperCase();
  if (type === "EXCLUSIVE" || type === "PERCENT") {
    return money(base.mul(rate).div(100));
  }
  if (type === "INCLUSIVE") {
    return money(base.minus(money(base.div(rate.div(100).plus(1)))));
  }
  return zero();
}

async function requireCustomer(tx: Prisma.TransactionClient, organizationId: string, customerId: string | undefined, due: Prisma.Decimal) {
  if (!customerId) {
    if (due.gt(0)) {
      throw new StockRuleError("Choose a customer for the unpaid amount.");
    }
    return null;
  }
  const customer = await tx.customer.findFirst({
    where: { id: customerId, organizationId },
    select: { id: true, status: true, creditLimit: true },
  });
  if (!customer) {
    throw new StockRuleError("That record was not found.", 404);
  }
  if (customer.status !== "ACTIVE") {
    throw new StockRuleError("That customer is not active.");
  }
  return customer;
}

export async function listSales(organizationId: string, branchId: string) {
  const rows = await prisma.sale.findMany({
    where: { organizationId, branchId },
    orderBy: { businessDate: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      total: true,
      businessDate: true,
      customer: { select: { name: true } },
      invoice: { select: { number: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.invoice?.number ?? null,
    status: row.status,
    total: decimalString(row.total, 2),
    businessDate: dateOnly(row.businessDate),
    customerName: row.customer?.name ?? "Walk-in",
  }));
}

export async function getSale(organizationId: string, branchId: string, id: string) {
  const row = await prisma.sale.findFirst({
    where: { id, organizationId, branchId },
    include: {
      customer: { select: { id: true, name: true } },
      invoice: { select: { number: true } },
      items: { include: { product: { select: { sku: true, name: true } } } },
      payments: true,
      journal: { include: { lines: { select: { debit: true, credit: true } } } },
    },
  });
  if (!row) {
    return null;
  }
  const debit = row.journal?.lines.reduce((sum, line) => sum.plus(line.debit), zero()) ?? zero();
  const credit = row.journal?.lines.reduce((sum, line) => sum.plus(line.credit), zero()) ?? zero();
  return {
    id: row.id,
    number: row.invoice?.number ?? null,
    status: row.status,
    businessDate: dateOnly(row.businessDate),
    customerName: row.customer?.name ?? "Walk-in",
    subtotal: decimalString(row.subtotal, 2),
    discountTotal: decimalString(row.discountTotal, 2),
    vatTotal: decimalString(row.vatTotal, 2),
    chargesTotal: decimalString(row.chargesTotal, 2),
    total: decimalString(row.total, 2),
    journalBalanced: debit.eq(credit),
    items: row.items.map((item) => ({
      id: item.id,
      sku: item.product.sku,
      name: item.product.name,
      quantity: decimalString(item.quantity, 4),
      unitPrice: decimalString(item.unitPrice, 2),
      lineTotal: decimalString(item.lineTotal, 2),
    })),
    payments: row.payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      amount: decimalString(payment.amount, 2),
    })),
  };
}
