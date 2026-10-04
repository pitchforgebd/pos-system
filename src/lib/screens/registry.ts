import { adminScreens } from "./admin.ts";
import { catalogScreens } from "./catalog.ts";
import { commerceScreens } from "./commerce.ts";
import { engageScreens } from "./engage.ts";
import { financeScreens } from "./finance.ts";
import { partyScreens } from "./parties.ts";
import type { MockRow, ScreenSpec } from "./types.ts";

export const screens: ScreenSpec[] = [
  ...commerceScreens,
  ...catalogScreens,
  ...partyScreens,
  ...financeScreens,
  ...engageScreens,
  ...adminScreens,
];

const byPath = new Map(screens.map((screen) => [screen.path, screen]));

export function concreteScreenPaths() {
  return screens.filter((screen) => !screen.path.includes(":")).map((screen) => screen.path);
}

export function resolveScreen(slug: string[]) {
  const path = `/${slug.join("/")}`;
  const exact = byPath.get(path);
  if (exact) {
    return { spec: exact, record: null as MockRow | null };
  }

  for (const spec of screens) {
    if (!spec.path.includes(":")) {
      continue;
    }
    const parts = spec.path.split("/").filter(Boolean);
    if (parts.length !== slug.length) {
      continue;
    }
    const params: Record<string, string> = {};
    const matched = parts.every((part, index) => {
      if (part.startsWith(":")) {
        params[part.slice(1)] = slug[index] ?? "";
        return true;
      }
      return part === slug[index];
    });
    if (!matched || !spec.source) {
      continue;
    }
    const source = byPath.get(spec.source);
    const record = source?.rows?.find((row) => String(row.id) === params.id) ?? source?.tabs?.[0]?.rows.find((row) => String(row.id) === params.id) ?? null;
    return { spec, record };
  }

  return null;
}

export function sectionNav(path: string) {
  const root = `/${path.split("/").filter(Boolean)[0]}`;
  return screens
    .filter((screen) => !screen.path.includes(":") && (screen.path === root || screen.path.startsWith(`${root}/`)))
    .map((screen) => ({ href: screen.path, label: screen.navLabel ?? screen.title }));
}

export function breadcrumbsFor(path: string, currentLabel?: string) {
  const parts = path.split("/").filter(Boolean);
  const crumbs: { label: string; href?: string }[] = [{ label: "Home", href: "/dashboard" }];
  let acc = "";
  parts.forEach((part, index) => {
    const last = index === parts.length - 1;
    if (part.startsWith(":")) {
      crumbs.push({ label: currentLabel ?? part });
      return;
    }
    acc += `/${part}`;
    const screen = byPath.get(acc);
    const label = screen?.navLabel ?? screen?.title ?? part;
    crumbs.push(last ? { label } : { label, href: acc });
  });
  return crumbs;
}
