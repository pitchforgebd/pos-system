import type { Prisma } from "@prisma/client";

import { PostingError } from "@/core/posting/errors";
import { post, type DocType, type JournalPlan, type PartyRef, type PostLine } from "@/core/posting/journal";

// The ledger engine is src/core/posting. These names stay for the modules that already import them; the old entry point is
// the same engine, and goes when the last module has moved to `post` directly.
export { PostingError };
export type JournalLineInput = PostLine;
export type { DocType, PartyRef };

export function postBalancedJournal(tx: Prisma.TransactionClient, input: JournalPlan) {
  return post(tx, input);
}
