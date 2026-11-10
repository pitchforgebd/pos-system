import { RuleError, type RuleStatus } from "@/core/errors/rule-error";

/** The ledger refused an entry (unbalanced, a party missing, a closed account, a locked day ...). Reaches the user as a 4xx answer. */
export class PostingError extends RuleError {
  constructor(message: string, status: RuleStatus = 422) {
    super(message, status);
    this.name = "PostingError";
  }
}
