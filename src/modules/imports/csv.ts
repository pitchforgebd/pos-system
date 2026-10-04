export function parseCsv(text: string) {
  const source = text.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      records.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    records.push(row);
  }
  const filled = records.filter((record) => record.some((cell) => cell.trim() !== ""));
  return {
    headers: (filled[0] ?? []).map((header) => header.trim()),
    rows: filled.slice(1).map((record) => record.map((cell) => cell.trim())),
  };
}

export function toCsv(headers: string[], rows: string[][]) {
  const escape = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  return `${[headers, ...rows].map((record) => record.map(escape).join(",")).join("\r\n")}\r\n`;
}

export function headerMap(headers: string[], required: string[], optional: string[]) {
  const unknown = headers.filter((header) => !required.includes(header) && !optional.includes(header));
  const missing = required.filter((header) => !headers.includes(header));
  if (unknown.length > 0 || missing.length > 0 || headers.length === 0) {
    return null;
  }
  return (row: string[]) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
}
