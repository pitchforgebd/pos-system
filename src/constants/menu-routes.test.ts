import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// P04 task 10 (L3, L4, LV-7): the menu only offers what exists. Every menu link has a real page, there are no sample screens, no
// catch-all page that invents one, and no wording that says a screen is only a sample. (That each page answers 200 is checked against
// the production build.)

const srcRoot = fileURLToPath(new URL("../", import.meta.url));
const pagesRoot = join(srcRoot, "app", "(dashboard)");
const navText = readFileSync(join(srcRoot, "constants", "reference-nav.ts"), "utf8");

function pagePaths() {
  const found = new Set<string>();
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full, `${prefix}/${name}`);
      } else if (name === "page.tsx") {
        found.add(prefix || "/");
      }
    }
  };
  walk(pagesRoot, "");
  return found;
}

test("every menu link opens a real page", () => {
  const pages = pagePaths();
  const hrefs = [...new Set([...navText.matchAll(/href: "([^"]+)"/g)].map((match) => match[1].split("?")[0]))];
  assert.ok(hrefs.length > 50, "the menu is read");
  const without = hrefs.filter((href) => !pages.has(href));
  assert.deepEqual(without, []);
});

test("no menu entry is a label for something that is not there", () => {
  const entries = [...navText.matchAll(/kind: "link", label: "([^"]+)"(, href: "[^"]+")?/g)];
  assert.deepEqual(entries.filter((entry) => !entry[2]).map((entry) => entry[1]), [], "a link without an href is a dead menu line");
});

test("there is no catch-all page, no sample screen code and no sample data", () => {
  const dead = [
    join(pagesRoot, "[...slug]"),
    join(srcRoot, "components", "screens"),
    join(srcRoot, "lib", "screens"),
    join(srcRoot, "lib", "mock"),
  ].filter((path) => existsSync(path));
  assert.deepEqual(dead.map((path) => path.split(sep).slice(-2).join("/")), []);
});

test("no page or menu line says it is a sample, or that a screen is only on a reference list", () => {
  const offenders: string[] = [];
  const scan = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        scan(full);
      } else if (/\.(tsx?|ts)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        const text = readFileSync(full, "utf8");
        if (/sample (screen|data|invoice|rows)|still on the reference list|reference screen/i.test(text)) {
          offenders.push(full.slice(srcRoot.length).split(sep).join("/"));
        }
      }
    }
  };
  scan(join(srcRoot, "app"));
  scan(join(srcRoot, "components"));
  scan(join(srcRoot, "constants"));
  assert.deepEqual(offenders, []);
});
