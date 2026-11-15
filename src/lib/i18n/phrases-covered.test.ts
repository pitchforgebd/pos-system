import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { PHRASES } from "@/lib/i18n/phrases";

// P13: a screen that writes ph("English text") shows that text in Bangla only when the phrase dictionary has it. This reads every page and component, finds
// each ph("...") call with a plain text, and lists the ones the dictionary does not know, so a new screen cannot ship a text without its Bangla.

const root = fileURLToPath(new URL("../../", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return files(full);
    }
    return /\.tsx?$/.test(full) && !full.endsWith(".test.ts") ? [full] : [];
  });
}

// texts that are the same in both languages or are data, not words
const SAME = /^[^A-Za-z]*$|^[A-Z0-9_ ./:()#-]{1,12}$|^[{@]/;

test("every text passed to ph has its Bangla in the dictionary", () => {
  const missing: string[] = [];
  for (const file of [...files(join(root, "app")), ...files(join(root, "components"))]) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "ph" && node.arguments.length === 1) {
        const arg = node.arguments[0];
        if ((ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) && !SAME.test(arg.text) && !(arg.text in PHRASES)) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          missing.push(`${relative(root, file)}:${line + 1}  ${arg.text.slice(0, 80)}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(missing, [], `texts with no Bangla in src/lib/i18n/phrases:\n${missing.join("\n")}`);
});
