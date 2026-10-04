const blocked = new Set(["exe", "js", "mjs", "cjs", "sh", "bat", "cmd", "php", "html", "htm", "svg"]);

export function safeImportName(name: string) {
  const base = name.replaceAll("\\", "/").split("/").pop()?.trim() || "";
  const extension = base.includes(".") ? (base.split(".").pop()?.toLowerCase() ?? "") : "";
  if (!base || blocked.has(extension)) {
    return null;
  }
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 255);
  return cleaned || null;
}
