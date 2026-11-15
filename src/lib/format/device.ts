/** A short, readable name for a browser's User-Agent text ("Chrome on Windows"); the unknown ones come back cut short. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const text = (userAgent ?? "").trim();
  if (!text) {
    return "";
  }
  const browser = /Edg(?:e|A|iOS)?\//.test(text)
    ? "Edge"
    : /OPR\/|Opera/.test(text)
      ? "Opera"
      : /Firefox\//.test(text)
        ? "Firefox"
        : /(Chrome|CriOS)\//.test(text)
          ? "Chrome"
          : /Safari\//.test(text) && /Version\//.test(text)
            ? "Safari"
            : /node|undici|curl|python|okhttp/i.test(text)
              ? "Script"
              : "";
  const system = /Windows/.test(text)
    ? "Windows"
    : /Android/.test(text)
      ? "Android"
      : /iPhone|iPad|iOS/.test(text)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(text)
          ? "macOS"
          : /Linux/.test(text)
            ? "Linux"
            : "";
  if (browser && system) {
    return `${browser} on ${system}`;
  }
  return browser || system || text.slice(0, 40);
}
