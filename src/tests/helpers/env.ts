import { readFileSync } from "node:fs";

// Loads .env the way the existing tests do (a value already in the environment wins) and sets the
// test defaults. Import this file first in every test that uses the harness, before anything that
// opens a database connection.
try {
  for (const line of readFileSync(new URL("../../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^"|"$/g, "");
    }
  }
} catch {
  // DATABASE_URL may come from the environment instead.
}
process.env.AUTH_SECRET ??= "test-secret-harness-value-0123456789";
process.env.BCRYPT_COST = "4";
