import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { headerMap, parseCsv } from "@/modules/imports/csv";
import { safeImportName } from "@/modules/imports/files";
import { hashPayload, readIdempotency, saveIdempotency } from "@/modules/inventory/idempotency";
import { postOpeningStock } from "@/modules/inventory/documents";
import { StockRuleError } from "@/modules/inventory/stock";

const required = ["sku", "quantity"];
const optional = ["unitCost", "lot", "manufacturedOn", "expiresOn", "rack"];
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

type Actor = {
  organizationId: string;
  branchId: string;
  userId: string;
  warehouseId?: string;
  idempotencyKey: string;
  fileName: string;
  csv: string;
  occurredOn: string;
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

export async function confirmOpeningImport(input: Actor) {
  const fileName = safeImportName(input.fileName);
  if (!fileName) {
    return { ok: false as const, status: 422 as const, message: "That file type is not accepted." };
  }
  const preview = previewOpeningCsv(input.csv);
  if (!preview.ok) {
    return preview;
  }
  if (!datePattern.test(input.occurredOn)) {
    return { ok: false as const, status: 422 as const, message: "Enter the opening date as YYYY-MM-DD." };
  }
  const requestHash = hashPayload({ kind: "opening", csv: input.csv, occurredOn: input.occurredOn, warehouseId: input.warehouseId ?? null });
  let fresh = false;
  const started = await prisma.$transaction(async (tx) => {
    const existing = await readIdempotency(tx, { organizationId: input.organizationId, key: input.idempotencyKey, requestHash });
    if (existing === "mismatch") {
      throw new StockRuleError("This idempotency key was already used for a different request.", 409);
    }
    if (existing) {
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
  const done = new Set((await prisma.importRow.findMany({ where: { importId: started }, select: { rowNumber: true } })).map((row) => row.rowNumber));
  for (const [index, cells] of preview.parsed.rows.entries()) {
    const rowNumber = index + 2;
    if (done.has(rowNumber)) {
      continue;
    }
    const record = preview.map(cells);
    const sku = record.sku ?? "";
    let status: "IMPORTED" | "FAILED" = "FAILED";
    let message = "The row was not imported.";
    const manufacturedOn = record.manufacturedOn ?? "";
    const expiresOn = record.expiresOn ?? "";
    if ((manufacturedOn && !datePattern.test(manufacturedOn)) || (expiresOn && !datePattern.test(expiresOn))) {
      message = "Dates use YYYY-MM-DD.";
    } else {
      const product = sku
        ? await prisma.product.findFirst({ where: { organizationId: input.organizationId, liveSku: sku, deletedAt: null }, select: { id: true } })
        : null;
      if (!product) {
        message = "That record was not found.";
      } else {
        const posted = await postOpeningStock({
          organizationId: input.organizationId,
          branchId: input.branchId,
          userId: input.userId,
          warehouseId: input.warehouseId,
          idempotencyKey: hashPayload({ importId: started, rowNumber }),
          occurredOn: input.occurredOn,
          lines: [
            {
              productId: product.id,
              quantity: record.quantity ?? "",
              unitCost: record.unitCost || undefined,
              lot: record.lot || undefined,
              manufacturedOn: manufacturedOn || undefined,
              expiresOn: expiresOn || undefined,
            },
          ],
          ip: input.ip,
          userAgent: input.userAgent,
        });
        if (posted.ok) {
          status = "IMPORTED";
          message = `${sku}: Posted.`;
        } else {
          message = posted.message;
        }
      }
    }
    await prisma.importRow.create({
      data: { organizationId: input.organizationId, importId: started, rowNumber, status, message: message.slice(0, 255) },
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
