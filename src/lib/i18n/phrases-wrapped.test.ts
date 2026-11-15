import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// P13: every screen reads its words through the catalog (t) or the phrase dictionary (ph). Text written straight between JSX tags, or into a text attribute,
// with English words in it is a screen that shows English to a person who chose Bangla. This test reads the source (the TypeScript syntax tree, not a regular
// expression) of every page and component under src/app/(dashboard) and src/components, and lists the English text not passed through t or ph.

const root = fileURLToPath(new URL("../../", import.meta.url));

// words that are the same in both languages: brand and technical terms
const ALLOWED = new Set([
  "SKU", "IMEI", "VAT", "BIN", "TIN", "CSV", "Excel", "bKash", "Nagad", "DBBL", "Ctrl", "POS", "OK", "ID", "A4", "UTC", "CRM", "SMS", "EAN", "PDF", "QR", "URL", "NID",
  "Meridian", "Walk", "in", "KG", "kg", "N", "A", "F2", "F4", "F6", "F9", "F10", "Enter", "Esc", "Tab", "COD", "ERP", "API", "HTML", "JSON", "BDT", "Tk", "pcs", "ml", "gm",
  "Bangla", "English", "Chrome", "Wi", "Fi",
]);
const TEXT_ATTRIBUTES = new Set(["placeholder", "aria-label", "title", "alt", "label", "caption", "description", "emptyMessage"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return files(full);
    }
    return full.endsWith(".tsx") ? [full] : [];
  });
}

function englishWords(text: string) {
  return (text.match(/[A-Za-z][A-Za-z'’-]+/g) ?? []).filter((word) => !ALLOWED.has(word));
}

test("no page or component writes English text straight into its markup", () => {
  const found: string[] = [];
  for (const file of [...files(join(root, "app/(dashboard)")), ...files(join(root, "components"))]) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      let text: string | null = null;
      if (ts.isJsxText(node)) {
        text = node.getText().replace(/\s+/g, " ").trim();
      } else if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText()) && node.initializer && ts.isStringLiteral(node.initializer)) {
        text = node.initializer.text;
      }
      if (text && englishWords(text).length > 0) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        found.push(`${relative(root, file)}:${line + 1}  ${text.slice(0, 70)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(found, [], `English text written straight into the markup (pass it through t or ph):\n${found.join("\n")}`);
});
