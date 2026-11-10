import { Prisma } from "@prisma/client";

import { applyMovement, type MovementInput, type MovementResult } from "@/core/stock";
import { PostingError } from "@/core/posting/errors";
import { post, type JournalPlan, type PostLine } from "@/core/posting/journal";

// The stock part of the posting engine (P03 task 3). A document that moves stock posts the movements and its journal in one
// go: each movement is applied (balance, average cost, lots, ledger row) and says what it cost, the journal is built from those
// costs, and the engine checks that the inventory account moved by exactly what the stock moved, branch by branch (I3). The
// journal and the stock are the caller's transaction: if either is refused, neither is kept.

type Db = Prisma.TransactionClient;

/** One movement of a document. The document's organization, user, day and reference are filled in from the plan. */
export type StockMove = Omit<MovementInput, "organizationId" | "userId" | "referenceType" | "referenceId" | "businessDate" | "branchId"> & {
  /** The branch the stock is in; the plan's branch when left out (a transfer names the destination's). */
  branchId?: string;
  /** Value this movement at what the movement with this index (an earlier one of the document) was valued at: a transfer's stock in. */
  unitCostFrom?: number;
};

export type MovedStock = {
  results: Array<MovementResult & { move: StockMove; branchId: string }>;
  /** What the stock that came in is worth, money, two decimals. */
  in: Prisma.Decimal;
  /** What the stock that went out is worth. */
  out: Prisma.Decimal;
  /** The change in stock value of a branch: in minus out (the plan's branch when none is given). */
  net(branchId?: string): Prisma.Decimal;
};

export type StockPlan = Omit<JournalPlan, "lines"> & {
  /** The document the movements belong to (written on every ledger row). */
  reference: { type: string; id: string };
  moves: StockMove[];
  /** The journal lines, built from what the movements cost. No lines at all is allowed only when no branch's stock value changed. */
  lines: (moved: MovedStock) => PostLine[];
};

/** Applies the movements, then posts the journal made from their cost. Returns the journal id and what moved. */
export async function postWithStock(tx: Db, plan: StockPlan): Promise<{ journalId: string | null; moved: MovedStock }> {
  const results: MovedStock["results"] = [];
  for (const move of plan.moves) {
    const branchId = move.branchId ?? plan.branchId;
    const { unitCostFrom, ...rest } = move;
    const result = await applyMovement(tx, {
      ...rest,
      ...(unitCostFrom !== undefined ? { unitCost: results[unitCostFrom].unitCost } : {}),
      organizationId: plan.organizationId,
      branchId,
      userId: plan.createdById,
      referenceType: plan.reference.type,
      referenceId: plan.reference.id,
      businessDate: plan.businessDate,
    });
    results.push({ ...result, move, branchId });
  }
  const sum = (direction: "IN" | "OUT") =>
    results.filter((row) => row.move.direction === direction).reduce((total, row) => total.plus(row.totalCost), new Prisma.Decimal(0));
  const moved: MovedStock = {
    results,
    in: sum("IN"),
    out: sum("OUT"),
    net: (branchId = plan.branchId) =>
      results
        .filter((row) => row.branchId === branchId)
        .reduce((total, row) => (row.move.direction === "IN" ? total.plus(row.totalCost) : total.minus(row.totalCost)), new Prisma.Decimal(0)),
  };
  const { lines, ...rest } = plan;
  const stockNet = new Map<string, Prisma.Decimal>();
  for (const row of results) {
    const change = row.move.direction === "IN" ? row.totalCost : row.totalCost.neg();
    stockNet.set(row.branchId, (stockNet.get(row.branchId) ?? new Prisma.Decimal(0)).plus(change));
  }
  const journalLines = lines(moved);
  if (journalLines.length === 0) {
    // Stock moved between two warehouses of one branch: the books do not change, so there is no journal (the stock must not have changed value).
    for (const change of stockNet.values()) {
      if (!change.eq(0)) {
        throw new PostingError("The stock changed value but the document has no journal lines (I3).");
      }
    }
    return { journalId: null, moved };
  }
  const journalId = await post(tx, { ...rest, lines: journalLines, stockNet: results.length > 0 ? stockNet : undefined });
  return { journalId, moved };
}
