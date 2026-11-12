import { Prisma } from "@prisma/client";

import { randomUUID } from "node:crypto";

import { hashPayload, idempotentTransaction, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { decimalString, money, parseMoney, parseQuantity, zero } from "@/core/money";
import type { PostLine } from "@/core/posting/journal";
import { postWithStock } from "@/core/posting/stock";
import { sellSerial } from "@/core/stock";
import { writeAudit } from "@/modules/auth/audit";
import { customerWallet, outstandingReceivable } from "@/modules/customers/customers";
import { allocateNumber } from "@/modules/documents/numbers";
import { resolveWarehouse, StockRuleError, type ConsumedLot } from "@/modules/inventory/stock";
import { resolvePrice } from "@/modules/pricing";
import { failure, type Actor } from "@/modules/purchasing/common";
import { allocateByWeight } from "@/modules/purchasing/costing";
import { ensureWalkIn, takeReceipt, type Tender, type TenderMethod } from "@/modules/sales/receipts";
import { occurredDate } from "@/lib/format/date";

// The invoice (P06 task 2, #17): every sale, at the till or an order's dispatch, is one document that posts together, in one transaction:
//   the stock out (at the average cost, COGS from it), the journal (Dr Receivable of the customer / Cr Sales, Output VAT, Charge income;
//   Dr COGS / Cr Inventory), and the receipts for what was paid now (#18, #20). A cash sale is made to the Walk-in customer, so every
//   invoice has a payment status worked out the same way. The customer's row is locked first (N5), so two sales that spend the same
//   advance or push the same customer over the credit limit take turns.

type Tx = Prisma.TransactionClient;

export type InvoiceLine = {
  productId?: string;
  barcode?: string;
  variantId?: string;
  quantity: string;
  /** Only with the price-override permission; never below the product's minimum price. */
  unitPrice?: string;
  discountAmount?: string;
  discountPercent?: string;
  vatAmount?: string;
  serial?: string;
};

export type TenderInput = { method: TenderMethod; accountId?: string; amount: string; charge?: string };

export type InvoiceInput = Actor & {
  businessDate: string;
  customerId?: string;
  /** The order being dispatched: its reservations are consumed and its prices are kept. */
  orderId?: string;
  ticketId?: string;
  shiftId?: string;
  districtId?: string;
  /** A price level by name or id (needs the price-level permission); the customer type's level otherwise. */
  level?: string;
  levelId?: string;
  headerDiscount?: string;
  chargesTotal?: string;
  lines: InvoiceLine[];
  tenders?: TenderInput[];
  /** D22: what is paid beyond this invoice settles the customer's older invoices, oldest first. */
  takePreviousDue?: boolean;
  allowDiscount?: boolean;
  allowPriceOverride?: boolean;
  allowPriceLevel?: boolean;
  /** An order's dispatch: the prices are the order's own, not looked up again. */
  fixedPrices?: boolean;
  /** Runs inside the sale transaction, so extra writes commit or roll back with the sale. */
  inTransaction?: (tx: Tx, sale: { id: string; customerId: string }) => Promise<void>;
};

type Customer = { id: string; status: string; creditLimit: Prisma.Decimal | null; customerTypeId: string | null; isSystem: boolean };

async function loadCustomer(tx: Tx, organizationId: string, customerId: string | undefined): Promise<Customer> {
  const id = customerId ?? (await ensureWalkIn(tx, organizationId));
  const found = await tx.customer.findFirst({ where: { id, organizationId }, select: { id: true, status: true, creditLimit: true, customerTypeId: true, isSystem: true } });
  if (!found) {
    throw new StockRuleError("That record was not found.", 404);
  }
  if (!found.isSystem) {
    // The customer row is locked for the rest of the transaction (N5).
    await tx.$queryRaw`SELECT id FROM customers WHERE id = ${found.id} AND organizationId = ${organizationId} FOR UPDATE`;
  }
  if (found.status !== "ACTIVE") {
    throw new StockRuleError("That customer is not active.");
  }
  return found;
}

async function resolveLineProduct(tx: Tx, organizationId: string, line: InvoiceLine) {
  let productId = line.productId ?? null;
  let variantId = line.variantId ?? null;
  if (line.barcode) {
    const barcode = await tx.productBarcode.findFirst({ where: { organizationId, barcode: line.barcode }, select: { productId: true, variantId: true } });
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
    select: { id: true, sellingPrice: true, minimumPrice: true, vatType: true, vatValue: true, trackSerial: true, trackStock: true },
  });
  if (!product) {
    throw new StockRuleError("That record was not found.", 404);
  }
  // A variant with its own price sells at that price; otherwise it follows the product.
  let sellingPrice = product.sellingPrice;
  if (variantId) {
    const variant = await tx.productVariant.findFirst({ where: { id: variantId, productId: product.id, organizationId }, select: { id: true, price: true } });
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
    /** False for a service or other non-stock item: it is sold with no stock movement and no cost of goods. */
    stocked: product.trackStock,
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

const amountOf = (value: string | undefined, what: string) => {
  const parsed = parseMoney(value ?? "0.00");
  if (!parsed || parsed.isNeg()) {
    throw new StockRuleError(`Enter ${what} with up to two decimals.`);
  }
  return parsed;
};

export function postInvoice(input: InvoiceInput) {
  const requestHash = hashPayload({
    businessDate: input.businessDate,
    customerId: input.customerId ?? null,
    orderId: input.orderId ?? null,
    ticketId: input.ticketId ?? null,
    warehouseId: input.warehouseId ?? null,
    level: input.level ?? input.levelId ?? null,
    headerDiscount: input.headerDiscount ?? "0.00",
    chargesTotal: input.chargesTotal ?? "0.00",
    lines: input.lines,
    tenders: input.tenders ?? [],
    takePreviousDue: input.takePreviousDue ?? false,
  });
  return (async () => {
    try {
      const data = await idempotentTransaction(async (tx) => {
        const existing = await readIdempotency(tx, { organizationId: input.organizationId, key: input.idempotencyKey, requestHash });
        if (existing === "mismatch") {
          throw new StockRuleError("This idempotency key was already used for a different request.", 409);
        }
        if (existing) {
          const sale = await tx.sale.findFirst({ where: { id: existing.entityId, organizationId: input.organizationId }, select: { id: true, total: true, invoice: { select: { number: true } } } });
          return { id: existing.entityId, replayed: true, number: sale?.invoice?.number ?? null, total: sale ? decimalString(sale.total, 2) : null, paid: null as string | null, due: null as string | null };
        }
        const charges = amountOf(input.chargesTotal, "charges");
        const headerDiscount = amountOf(input.headerDiscount, "a discount");
        const warehouse = await resolveWarehouse(input.organizationId, input.branchId, input.warehouseId);
        if (!warehouse) {
          throw new StockRuleError("Choose an active warehouse on the current branch.");
        }
        if (input.lines.length === 0) {
          throw new StockRuleError("Add a line to the sale.");
        }
        const customer = await loadCustomer(tx, input.organizationId, input.customerId);
        const shop = await tx.organization.findUniqueOrThrow({ where: { id: input.organizationId }, select: { maxDiscountPercent: true, loyaltyEarn: true, pointsPerHundred: true } });
        if ((input.level || input.levelId) && input.allowPriceLevel === false) {
          throw new StockRuleError("You may not change the price level.");
        }

        // each line: the product, the price at the level and quantity, the discount, the VAT
        const priced = [];
        for (const line of input.lines) {
          const quantity = parseQuantity(line.quantity);
          if (!quantity) {
            throw new StockRuleError("Enter a quantity greater than zero.");
          }
          const resolved = await resolveLineProduct(tx, input.organizationId, line);
          let unitPrice = new Prisma.Decimal(resolved.sellingPrice);
          let priceLevelId: string | null = null;
          if (!input.fixedPrices) {
            const picked = await resolvePrice(tx, {
              organizationId: input.organizationId,
              productId: resolved.productId,
              variantId: resolved.variantId,
              quantity: decimalString(quantity, 4),
              level: input.level,
              levelId: input.levelId,
              customerTypeId: customer.customerTypeId,
            });
            if (picked) {
              unitPrice = picked.price;
              priceLevelId = picked.levelId;
            }
          }
          if (line.unitPrice) {
            const offered = parseMoney(line.unitPrice);
            if (!offered) {
              throw new StockRuleError("Enter a unit price with up to two decimals.");
            }
            if (!money(offered).eq(money(unitPrice))) {
              if (!input.allowPriceOverride && !input.fixedPrices) {
                throw new StockRuleError("The unit price must match the selling price. Price override is not available.");
              }
              if (!input.fixedPrices && offered.lt(new Prisma.Decimal(resolved.minimumPrice))) {
                throw new StockRuleError("The unit price is below the minimum price.");
              }
              unitPrice = offered;
            }
          }
          const gross = money(quantity.mul(unitPrice));
          let discount = amountOf(line.discountAmount, "a discount");
          if (line.discountPercent) {
            const percent = new Prisma.Decimal(/^\d{1,3}(\.\d{1,2})?$/.test(line.discountPercent) ? line.discountPercent : "NaN");
            if (percent.isNaN() || percent.gt(100)) {
              throw new StockRuleError("A discount percentage is between 0 and 100.");
            }
            discount = money(gross.mul(percent).div(100));
          }
          if (discount.gt(0) && input.allowDiscount === false) {
            throw new StockRuleError("You may not give a discount.");
          }
          if (discount.gt(gross)) {
            throw new StockRuleError("Discount is greater than the line.");
          }
          if (gross.gt(0) && discount.mul(100).gt(gross.mul(shop.maxDiscountPercent))) {
            throw new StockRuleError(`A discount can be at most ${decimalString(shop.maxDiscountPercent, 2)}% of the line.`);
          }
          if (resolved.trackSerial && (!line.serial?.trim() || !quantity.eq(1))) {
            throw new StockRuleError("Enter one IMEI or serial, and sell that product one unit at a time.");
          }
          priced.push({ resolved, quantity, unitPrice: money(unitPrice), priceLevelId, gross, discount, serial: resolved.trackSerial ? (line.serial?.trim() as string) : null, offeredVat: line.vatAmount });
        }
        // the discount on the whole invoice is shared over the lines by value, so each line's VAT is on what is really charged
        const afterLine = priced.map((line) => money(line.gross.minus(line.discount)));
        const grossTotal = money(priced.reduce((sum, line) => sum.plus(line.gross), zero()));
        const lineDiscounts = money(priced.reduce((sum, line) => sum.plus(line.discount), zero()));
        if (headerDiscount.gt(0) && input.allowDiscount === false) {
          throw new StockRuleError("You may not give a discount.");
        }
        if (headerDiscount.gt(afterLine.reduce((sum, value) => sum.plus(value), zero()))) {
          throw new StockRuleError("Discount is greater than the sale.");
        }
        if (grossTotal.gt(0) && lineDiscounts.plus(headerDiscount).mul(100).gt(grossTotal.mul(shop.maxDiscountPercent))) {
          throw new StockRuleError(`A discount can be at most ${decimalString(shop.maxDiscountPercent, 2)}% of the sale.`);
        }
        const headerShares = allocateByWeight(headerDiscount, afterLine);
        const lines = priced.map((line, index) => {
          const base = money(afterLine[index].minus(headerShares[index]));
          const vat = productVat(line.resolved.vatType, line.resolved.vatValue, base);
          if (line.offeredVat) {
            const offered = parseMoney(line.offeredVat);
            if (!offered || !money(offered).eq(vat)) {
              throw new StockRuleError("The VAT does not match the product.");
            }
          }
          const inclusive = (line.resolved.vatType ?? "").toUpperCase() === "INCLUSIVE";
          return { ...line, vat, salesAmount: inclusive ? money(base.minus(vat)) : base, payable: inclusive ? base : money(base.plus(vat)), id: randomUUID() };
        });
        const discountTotal = money(lineDiscounts.plus(headerDiscount));
        const vatTotal = money(lines.reduce((sum, line) => sum.plus(line.vat), zero()));
        const salesCredit = money(lines.reduce((sum, line) => sum.plus(line.salesAmount), zero()));
        const total = money(lines.reduce((sum, line) => sum.plus(line.payable), zero()).plus(charges));

        // what is paid now
        const tenders: Tender[] = (input.tenders ?? [])
          .map((entry) => ({ method: entry.method, accountId: entry.accountId, amount: amountOf(entry.amount, "a payment amount"), charge: amountOf(entry.charge, "a charge") }))
          .filter((entry) => entry.amount.gt(0));
        const paidTotal = money(tenders.reduce((sum, entry) => sum.plus(entry.amount), zero()));
        if (!input.takePreviousDue && paidTotal.gt(total)) {
          throw new StockRuleError("The payment is greater than the sale total.");
        }
        const walletPart = money(tenders.filter((entry) => entry.method === "WALLET").reduce((sum, entry) => sum.plus(entry.amount), zero()));
        if (walletPart.gt(0)) {
          if (customer.isSystem) {
            throw new StockRuleError("Choose a customer for a wallet payment.");
          }
          if ((await customerWallet(input.organizationId, customer.id, tx)).lt(walletPart)) {
            throw new StockRuleError("The wallet balance is smaller than the payment.");
          }
        }
        const due = money(Prisma.Decimal.max(total.minus(paidTotal), 0));
        if (due.gt(0) && customer.isSystem) {
          throw new StockRuleError("Choose a customer for the unpaid amount.");
        }
        if (input.ticketId) {
          const ticket = await tx.heldTicket.findFirst({ where: { id: input.ticketId, organizationId: input.organizationId, branchId: input.branchId }, select: { id: true } });
          if (!ticket) {
            throw new StockRuleError("That record was not found.", 404);
          }
        }

        const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "INV", businessDate: input.businessDate });
        const sale = await tx.sale.create({
          data: {
            organizationId: input.organizationId,
            branchId: input.branchId,
            warehouseId: warehouse.id,
            customerId: customer.id,
            orderId: input.orderId ?? null,
            shiftId: input.shiftId ?? null,
            priceLevelId: lines[0]?.priceLevelId ?? null,
            districtId: input.districtId ?? null,
            status: "POSTED",
            subtotal: grossTotal,
            discountTotal,
            vatTotal,
            chargesTotal: charges,
            total,
            businessDate: occurredDate(input.businessDate),
            createdById: input.userId,
            items: {
              create: lines.map((line) => ({
                id: line.id,
                organizationId: input.organizationId,
                productId: line.resolved.productId,
                variantId: line.resolved.variantId ?? null,
                priceLevelId: line.priceLevelId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                discountAmount: line.discount,
                vatAmount: line.vat,
                lineTotal: line.payable,
              })),
            },
            invoice: { create: { organizationId: input.organizationId, branchId: input.branchId, customerId: customer.id, number, total } },
          },
          select: { id: true },
        });

        // the stock out and the journal, together
        const stocked = lines.filter((line) => line.resolved.stocked);
        const lotsTaken: ConsumedLot[][] = stocked.map(() => []);
        const { journalId, moved } = await postWithStock(tx, {
          organizationId: input.organizationId,
          branchId: input.branchId,
          businessDate: occurredDate(input.businessDate),
          description: `Sale ${number}`,
          createdById: input.userId,
          doc: { type: "SALE", id: sale.id },
          reference: { type: "sale", id: sale.id },
          moves: stocked.map((line, index) => ({
            lotsOut: lotsTaken[index],
            productId: line.resolved.productId,
            variantId: line.resolved.variantId,
            warehouseId: warehouse.id,
            quantity: line.quantity,
            direction: "OUT" as const,
            movementType: "SALE" as const,
            ...(input.orderId ? { releaseReserved: line.quantity } : {}),
          })),
          lines: (result) => {
            const cogs = result.out;
            const party = { type: "CUSTOMER" as const, id: customer.id };
            const journal: PostLine[] = [
              ...(total.gt(0) ? [{ role: "AR" as const, debit: total, credit: zero(), party }] : []),
              ...(salesCredit.gt(0) ? [{ role: "SALES" as const, debit: zero(), credit: salesCredit }] : []),
              ...(vatTotal.gt(0) ? [{ role: "OUTPUT_VAT" as const, debit: zero(), credit: vatTotal }] : []),
              ...(charges.gt(0) ? [{ role: "CHARGE_INCOME" as const, debit: zero(), credit: charges }] : []),
              ...(cogs.gt(0)
                ? [
                    { role: "COGS" as const, debit: cogs, credit: zero() },
                    { role: "INVENTORY" as const, debit: zero(), credit: cogs },
                  ]
                : []),
            ];
            return journal.length >= 2 ? journal : [];
          },
        });
        await Promise.all(
          stocked.map((line, index) =>
            tx.saleItem.update({
              where: { id: line.id },
              data: {
                unitCost: moved.results[index].unitCost,
                // an expiry-tracked product: which lots it came from (a return puts it back there)
                ...(lotsTaken[index].length > 0
                  ? { lots: lotsTaken[index].map((lot) => ({ lot: lot.lot, expiresOn: lot.expiresOn.toISOString().slice(0, 10), manufacturedOn: lot.manufacturedOn?.toISOString().slice(0, 10) ?? null, quantity: lot.quantity.toFixed(4) })) }
                  : {}),
              },
            }),
          ),
        );
        if (journalId) {
          await tx.sale.update({ where: { id: sale.id }, data: { journalId } });
        }
        for (const line of lines) {
          if (line.serial) {
            await sellSerial(tx, { organizationId: input.organizationId, productId: line.resolved.productId, warehouseId: warehouse.id, serial: line.serial, saleId: sale.id });
          }
        }

        // the receipts: each settles this invoice first; what is more settles the oldest debt (D22), but never more than is owed
        if (paidTotal.gt(total) && paidTotal.gt(await outstandingReceivable(input.organizationId, customer.id, tx))) {
          throw new StockRuleError("The payment is more than the customer owes.");
        }
        let toInvoice = total;
        for (const tender of tenders) {
          const part = Prisma.Decimal.min(tender.amount, toInvoice);
          toInvoice = toInvoice.minus(part);
          await takeReceipt(tx, {
            organizationId: input.organizationId,
            branchId: input.branchId,
            userId: input.userId,
            customerId: customer.id,
            businessDate: input.businessDate,
            tender,
            shiftId: input.shiftId,
            named: part.gt(0) ? [{ documentId: sale.id, amount: part.toFixed(2) }] : undefined,
          });
          await tx.salePayment.create({ data: { organizationId: input.organizationId, saleId: sale.id, method: tender.method, accountId: tender.accountId ?? null, amount: tender.amount, charge: tender.charge ?? zero() } });
        }
        if (customer.creditLimit && due.gt(0) && (await outstandingReceivable(input.organizationId, customer.id, tx)).gt(customer.creditLimit)) {
          throw new StockRuleError("The sale exceeds the customer credit limit.");
        }
        if (!customer.isSystem && shop.loyaltyEarn && shop.pointsPerHundred && shop.pointsPerHundred.gt(0)) {
          const points = total.mul(shop.pointsPerHundred).div(100).toDecimalPlaces(4);
          if (points.gt(0)) {
            await tx.loyaltyTransaction.create({
              data: { organizationId: input.organizationId, customerId: customer.id, entryType: "EARN", points, businessDate: occurredDate(input.businessDate), referenceType: "sale", referenceId: sale.id },
            });
          }
        }
        if (input.ticketId) {
          await tx.heldTicket.delete({ where: { id: input.ticketId } });
        }
        await input.inTransaction?.(tx, { id: sale.id, customerId: customer.id });
        await saveIdempotency(tx, { organizationId: input.organizationId, userId: input.userId, key: input.idempotencyKey, requestHash, entityType: "sale", entityId: sale.id });
        return { id: sale.id, number: number as string | null, replayed: false, total: decimalString(total, 2) as string | null, paid: decimalString(paidTotal, 2) as string | null, due: decimalString(due, 2) as string | null };
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
  })();
}
