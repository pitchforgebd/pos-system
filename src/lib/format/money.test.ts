import assert from "node:assert/strict";
import test from "node:test";

import { formatMoney } from "./money.ts";

test("formatMoney shows a currency code and two decimals", () => {
  assert.equal(formatMoney(1250.5, "USD"), "USD 1,250.50");
});
