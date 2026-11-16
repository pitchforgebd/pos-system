import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The live server's database is MariaDB, CI and the laptops run MySQL 8. Found when the demo shop was loaded on the live site: an upsert written
// with MySQL 8's row alias ("... VALUES (...) AS incoming ON DUPLICATE KEY UPDATE x = incoming.x") is a syntax error in MariaDB. Raw SQL must use
// the form both understand (VALUES(x)); this keeps the alias form out of the code.

const root = fileURLToPath(new URL("../../", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return files(full);
    }
    return /\.tsx?$/.test(full) && !/\.test\.ts$/.test(full) ? [full] : [];
  });
}

test("raw SQL does not use the MySQL 8 only row alias of an upsert", () => {
  const found: string[] = [];
  for (const file of files(root)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (/\)\s+AS\s+(incoming|new_row|new)\s*$/i.test(line) || /\b(incoming|new_row)\.\w+/.test(line)) {
          found.push(`${relative(root, file)}:${index + 1}  ${line.trim().slice(0, 100)}`);
        }
      });
  }
  assert.deepEqual(found, [], `MySQL 8 only row alias in raw SQL (use VALUES(column), which MariaDB also understands):\n${found.join("\n")}`);
});
