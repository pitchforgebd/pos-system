import { prisma } from "@/lib/db/client";
import { isIsoDate } from "@/lib/format/date";
import { writeAudit } from "@/modules/auth/audit";
import { headerMap, parseCsv } from "@/modules/imports/csv";
import { safeImportName } from "@/modules/imports/files";
import { hashPayload, idempotentTransaction, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { postOpeningStock, type StockLine } from "@/modules/inventory/documents";
import { parseMoney, parseQuantity } from "@/core/money";
import { StockRuleError } from "@/modules/inventory/stock";

const required = ["sku", "quantity"];
const optional = ["unitCost", "lot", "manufacturedOn", "expiresOn", "rack"];
type Actor = {
  organizationId: string;
  branchId: string;
  userId: string;
  warehouseId?: string;
  idempotencyKey: string;
  fileName: string;
  csv: string;
  businessDate: string;
  ip: string;
  userAgent: string | null;
};

export function previewOpeningCsv(csv: string) {
  if (csv.length > 200_000) {
    return { ok: false as const, status: 422 as const, message: "The CSV is too large." };
  }
  const parsed = parseCsv(csv);
  const map = headerMap(parsed.headers, required, optional);
  if (!map) {
    return { ok: false as const, status: 422 as const, message: "The CSV header does not match the opening-stock columns." };
  }
  if (parsed.rows.length > 500) {
    return { ok: false as const, status: 422 as const, message: "A CSV can contain up to 500 rows." };
  }
  return { ok: true as const, parsed, map };
}

type RowOutcome = { rowNumber: number; sku: string; status: "IMPORTED" | "FAILED"; message: string; line?: StockLine };

export async function confirmOpeningImport(input: Actor) {
  const fileName = safeImportName(input.fileName);
  if (!fileName) {
    return { ok: false as const, status: 422 as const, message: "That file type is not accepted." };
  }
  const preview = previewOpeningCsv(input.csv);
  if (!preview.ok) {
    return preview;
  }
  if (!isIsoDate(input.businessDate)) {
    return { ok: false as const, status: 422 as const, message: "Enter the opening date as YYYY-MM-DD." };
  }
  const requestHash = hashPayload({ kind: "opening", csv: input.csv, businessDate: input.businessDate, warehouseId: input.warehouseId ?? null });
  let fresh = false;
  const started = await idempotentTransaction(async (tx) => {
    const existing = await readIdempotency(tx, { organizationId: input.organizationId, key: input.idempotencyKey, requestHash });
    if (existing === "mismatch") {
      throw new StockRuleError("This idempotency key was already used for a different request.", 409);
    }
    if (existing) {
      fresh = false;
      return existing.entityId;
    }
    fresh = true;
    const batch = await tx.import.create({
      data: {
        organizationId: input.organizationId,
        fileName,
        status: "PENDING",
        createdById: input.userId,
      },
      select: { id: true },
    });
    await saveIdempotency(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      key: input.idempotencyKey,
      requestHash,
      entityType: "opening_import",
      entityId: batch.id,
    });
    return batch.id;
  });

  // Every run checks the whole file, so a resumed import builds exactly the same document.
  const outcomes: RowOutcome[] = [];
  for (const [index, cells] of preview.parsed.rows.entries()) {
    const rowNumber = index + 2;
    const record = preview.map(cells);
    const sku = record.sku ?? "";
    const manufacturedOn = record.manufacturedOn ?? "";
    const expiresOn = record.expiresOn ?? "";
    const fail = (message: string): RowOutcome => ({ rowNumber, sku, status: "FAILED", message });
    if ((manufacturedOn && !isIsoDate(manufacturedOn)) || (expiresOn && !isIsoDate(expiresOn))) {
      outcomes.push(fail("Dates use YYYY-MM-DD."));
      continue;
    }
    const product = sku
      ? await prisma.product.findFirst({
          where: { organizationId: input.organizationId, liveSku: sku, deletedAt: null },
          select: { id: true, trackExpiry: true },
        })
      : null;
    if (!product) {
      outcomes.push(fail("That record was not found."));
      continue;
    }
    if (!parseQuantity(record.quantity ?? "")) {
      outcomes.push(fail("Enter a quantity greater than zero with up to four decimals."));
      continue;
    }
    if (record.unitCost && !parseMoney(record.unitCost)) {
      outcomes.push(fail("Enter a unit cost with up to two decimals."));
      continue;
    }
    if (product.trackExpiry && (!record.lot || !expiresOn)) {
      outcomes.push(fail("Expiry-tracked products need a lot and an expiry date."));
      continue;
    }
    outcomes.push({
      rowNumber,
      sku,
      status: "IMPORTED",
      message: `${sku}: Posted.`,
      line: {
        productId: product.id,
        quantity: record.quantity ?? "",
        unitCost: record.unitCost || undefined,
        lot: record.lot || undefined,
        manufacturedOn: manufacturedOn || undefined,
        expiresOn: expiresOn || undefined,
      },
    });
  }

  // All valid rows go into one opening-stock document, in one transaction. If it cannot be
  // posted, nothing is posted and each of those rows says why.
  const lines = outcomes.flatMap((outcome) => (outcome.line ? [outcome.line] : []));
  if (lines.length > 0) {
    const posted = await postOpeningStock({
      organizationId: input.organizationId,
      branchId: input.branchId,
      userId: input.userId,
      warehouseId: input.warehouseId,
      idempotencyKey: hashPayload({ importId: started }),
      businessDate: input.businessDate,
      lines,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    if (!posted.ok) {
      for (const outcome of outcomes) {
        if (outcome.line) {
          outcome.status = "FAILED";
          outcome.message = posted.message;
        }
      }
    }
  }

  const done = new Set((await prisma.importRow.findMany({ where: { importId: started }, select: { rowNumber: true } })).map((row) => row.rowNumber));
  const missing = outcomes.filter((outcome) => !done.has(outcome.rowNumber));
  if (missing.length > 0) {
    await prisma.importRow.createMany({
      data: missing.map((outcome) => ({
        organizationId: input.organizationId,
        importId: started,
        rowNumber: outcome.rowNumber,
        status: outcome.status,
        message: outcome.message.slice(0, 255),
      })),
    });
  }
  const rows = await prisma.importRow.findMany({ where: { importId: started }, orderBy: { rowNumber: "asc" } });
  const counts = {
    totalRows: rows.length,
    successRows: rows.filter((row) => row.status === "IMPORTED").length,
    failedRows: rows.filter((row) => row.status === "FAILED").length,
    skippedRows: rows.filter((row) => row.status === "SKIPPED").length,
  };
  await prisma.import.update({ where: { id: started }, data: { ...counts, status: "COMPLETED" } });
  if (fresh) {
    await writeAudit({
      organizationId: input.organizationId,
      branchId: input.branchId,
      userId: input.userId,
      action: "import",
      module: "inventory",
      entityType: "import",
      entityId: started,
      after: counts,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }
  return {
    ok: true as const,
    id: started,
    ...counts,
    replayed: !fresh,
    rows: rows.map((row) => ({ rowNumber: row.rowNumber, status: row.status, message: row.message ?? "" })),
  };
}
