import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// P13 task 9 (U9): text on a colored background is readable (WCAG AA: 4.5 to 1 for text, 3 to 1 for large text). The colors of the design tokens are checked
// in the pairs they are used in, and every solid color the screens put behind white text (bg-[#hex]) is checked against white.

const root = fileURLToPath(new URL("../../", import.meta.url));

function luminance(hex: string) {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrast(foreground: string, background: string) {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

function tokens() {
  const css = readFileSync(join(root, "app", "globals.css"), "utf8");
  const found = new Map<string, string>();
  for (const match of css.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6});/g)) {
    found.set(match[1], match[2]);
  }
  return found;
}

test("the design tokens are readable in the pairs they are used in", () => {
  const t = tokens();
  const pairs: Array<[string, string, number]> = [
    ["text", "background", 4.5],
    ["text", "surface", 4.5],
    ["muted", "surface", 4.5],
    ["muted", "background", 4.5],
    ["muted", "surface-muted", 4.5],
    ["primary-foreground", "primary", 4.5],
    ["secondary-foreground", "secondary", 4.5],
    ["success", "success-subtle", 4.5],
    ["warning", "warning-subtle", 4.5],
    ["error", "error-subtle", 4.5],
    ["info", "info-subtle", 4.5],
    ["success", "surface", 4.5],
    ["error", "surface", 4.5],
    ["warning", "surface", 4.5],
    ["info", "surface", 4.5],
    ["primary", "surface", 4.5],
    ["sidebar-foreground", "sidebar", 4.5],
    ["sidebar-muted", "sidebar", 4.5],
  ];
  for (const [foreground, background, need] of pairs) {
    const a = t.get(foreground);
    const b = t.get(background);
    assert.ok(a && b, `token ${foreground} or ${background} is missing`);
    const ratio = contrast(a, b);
    assert.ok(ratio >= need, `${foreground} (${a}) on ${background} (${b}) is ${ratio.toFixed(2)}:1, needs ${need}:1`);
  }
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(tsx)$/.test(entry.name) && !entry.name.endsWith(".test.tsx") ? [path] : [];
  });
}

test("every solid color behind white text in the screens has at least 4.5 to 1 against white", () => {
  const weak: string[] = [];
  for (const file of [...sourceFiles(join(root, "components")), ...sourceFiles(join(root, "app"))]) {
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      // a line that puts white text on a solid background color
      if (!/text-white(?!\/)/.test(line)) {
        continue;
      }
      for (const match of line.matchAll(/bg-\[#([0-9a-fA-F]{6})\]/g)) {
        const ratio = contrast("#ffffff", `#${match[1]}`);
        if (ratio < 4.5) {
          weak.push(`${file.slice(root.length)}: #${match[1]} is ${ratio.toFixed(2)}:1`);
        }
      }
    }
  }
  assert.deepEqual(weak, [], "white text on a color that is too light");
});
