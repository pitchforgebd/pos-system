import { Prisma } from "@prisma/client";
import { money } from "@/core/money";

import { StockRuleError } from "@/modules/inventory/stock";

export function returnLineAmount(input: {
  sourceQuantity: Prisma.Decimal;
  unitAmount: Prisma.Decimal;
  sourceTotal: Prisma.Decimal;
  priorQuantities: Prisma.Decimal[];
  quantity: Prisma.Decimal;
}) {
  let usedQuantity = new Prisma.Decimal(0);
  let usedAmount = new Prisma.Decimal(0);
  let nextAmount = new Prisma.Decimal(0);
  for (const quantity of [...input.priorQuantities, input.quantity]) {
    const remaining = input.sourceQuantity.minus(usedQuantity);
    if (quantity.gt(remaining)) {
      throw new StockRuleError("The return is greater than the quantity still eligible.");
    }
    nextAmount = quantity.eq(remaining) ? money(input.sourceTotal.minus(usedAmount)) : money(quantity.mul(input.unitAmount));
    usedQuantity = usedQuantity.plus(quantity);
    usedAmount = usedAmount.plus(nextAmount);
  }
  return nextAmount;
}
