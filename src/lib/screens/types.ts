export type ColumnKind = "text" | "money" | "date" | "badge" | "qty";

export type MockColumn = {
  key: string;
  header: string;
  kind?: ColumnKind;
};

export type MockRow = Record<string, string | number>;

export type ScreenTab = {
  label: string;
  columns: MockColumn[];
  rows: MockRow[];
};

export type FormFieldSpec = {
  key: string;
  label: string;
  kind?: "text" | "money" | "textarea" | "select" | "date";
  required?: boolean;
  options?: string[];
};

export type ScreenLink = {
  href: string;
  label: string;
  description: string;
};

export type ScreenSpec = {
  path: string;
  title: string;
  description: string;
  cta: string;
  kind: "list" | "form" | "detail" | "pos" | "import" | "settings";
  navLabel?: string;
  ctaHref?: string;
  columns?: MockColumn[];
  rows?: MockRow[];
  tabs?: ScreenTab[];
  fields?: FormFieldSpec[];
  source?: string;
  stats?: { label: string; value: string }[];
  links?: ScreenLink[];
  lineColumns?: MockColumn[];
  lineRows?: MockRow[];
};

export function text(key: string, header: string): MockColumn {
  return { key, header, kind: "text" };
}

export function money(key: string, header: string): MockColumn {
  return { key, header, kind: "money" };
}

export function date(key: string, header: string): MockColumn {
  return { key, header, kind: "date" };
}

export function badge(key: string, header: string): MockColumn {
  return { key, header, kind: "badge" };
}

export function qty(key: string, header: string): MockColumn {
  return { key, header, kind: "qty" };
}
