/**
 * A business rule said no (not found, conflict, or a rule such as "the period is locked").
 * Every service error that should reach the user as a 4xx answer extends this class, so one check
 * (`error instanceof RuleError`) maps them all, and `defineRoute` does exactly that.
 */
export type RuleStatus = 404 | 409 | 422;

// The production build can include this module in more than one bundle, and then `instanceof` fails between the
// copies. Every RuleError carries this mark, and `instanceof RuleError` also accepts any object that has it.
const MARK = Symbol.for("meridian.ruleError");

export class RuleError extends Error {
  status: RuleStatus;
  readonly [MARK] = true;

  constructor(message: string, status: RuleStatus = 422) {
    super(message);
    this.name = "RuleError";
    this.status = status;
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    if (Function.prototype[Symbol.hasInstance].call(this, value)) {
      return true;
    }
    // Only the base class accepts a marked object from another copy; the subclasses keep the ordinary check.
    return this === RuleError && typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[MARK] === true;
  }
}
