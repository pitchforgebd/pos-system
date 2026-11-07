/**
 * A business rule said no (not found, conflict, or a rule such as "the period is locked").
 * Every service error that should reach the user as a 4xx answer extends this class, so one check
 * (`error instanceof RuleError`) maps them all, and `defineRoute` will do exactly that.
 */
export type RuleStatus = 404 | 409 | 422;

export class RuleError extends Error {
  status: RuleStatus;

  constructor(message: string, status: RuleStatus = 422) {
    super(message);
    this.name = "RuleError";
    this.status = status;
  }
}
