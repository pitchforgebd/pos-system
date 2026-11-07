import { prisma } from "@/lib/db/client";
import { runTx } from "@/core/tx/run";
import { writeAudit } from "@/modules/auth/audit";
import { createProduct } from "@/modules/catalog/products";
import { headerMap, parseCsv, toCsv } from "@/modules/imports/csv";
import { safeImportName } from "@/modules/imports/files";
import { hashPayload, readIdempotency, saveIdempotency } from "@/modules/inventory/idempotency";
import { decimalString } from "@/core/money";
import { StockRuleError } from "@/modules/inventory/stock";

const required = ["sku", "name", "purchasePrice", "sellingPrice", "wholesalePrice", "minimumPrice"];
const optional = ["reorderLevel", "barcode"];
const rowLimit = 500;

type Actor = { organizationId: string; userId: string; ip: string; userAgent: string | null };

function present(batch: { id: string; totalRows: number; successRows: number; failedRows: number; skippedRows: number; status: string }, rows: { rowNumber: number; status: string; message: string | null }[]) {
  return {
    id: batch.id,
    status: batch.status,
    total: batch.totalRows,
    success: batch.successRows,
    failed: batch.failedRows,
    skipped: batch.skippedRows,
    rows: rows.map((row) => ({ rowNumber: row.rowNumber, status: row.status, message: row.message ?? "" })),
  };
}

export function previewProductCsv(csv: string) {
  if (csv.length > 200_000) {
    return { ok: false as const, status: 422 as const, message: "The CSV is too large." };
  }
  const parsed = parseCsv(csv);
  const map = headerMap(parsed.headers, required, optional);
  if (!map) {
    return { ok: false as const, status: 422 as const, message: "The CSV header does not match the product columns." };
  }
  if (parsed.rows.length > rowLimit) {
    return { ok: false as const, status: 422 as const, message: "A CSV can contain up to 500 rows." };
  }
  const seen = new Set<string>();
  const rows = parsed.rows.map((cells, index) => {
    const record = map(cells);
    const sku = record.sku ?? "";
    const name = record.name ?? "";
    if (!sku || !name) {
      return { rowNumber: index + 2, sku, name, status: "FAILED" as const, message: "SKU and name are required." };
    }
    if (seen.has(sku)) {
      return { rowNumber: index + 2, sku, name, status: "SKIPPED" as const, message: "That SKU is already in this file." };
    }
    seen.add(sku);
    return { rowNumber: index + 2, sku, name, status: "PENDING" as const, message: "Ready to import." };
  });
  return { ok: true as const, rows };
}

async function summary(organizationId: string, importId: string) {
  const batch = await prisma.import.findFirst({ where: { id: importId, organizationId } });
  if (!batch) {
    return null;
  }
  const rows = await prisma.importRow.findMany({ where: { importId }, orderBy: { rowNumber: "asc" } });
  return present(batch, rows);
}

export async function confirmProductImport(input: Actor & { idempotencyKey: string; fileName: string; csv: string }) {
  const fileName = safeImportName(input.fileName);
  if (!fileName) {
    return { ok: false as const, status: 422 as const, message: "That file type is not accepted." };
  }
  const preview = previewProductCsv(input.csv);
  if (!preview.ok) {
    return preview;
  }
  const requestHash = hashPayload({ kind: "products", csv: input.csv });
  const started = await runTx(async (tx) => {
    const existing = await readIdempotency(tx, { organizationId: input.organizationId, key: input.idempotencyKey, requestHash });
    if (existing === "mismatch") {
      throw new StockRuleError("This idempotency key was already used for a different request.", 409);
    }
    if (existing) {
      return { id: existing.entityId, fresh: false };
    }
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
      entityType: "product_import",
      entityId: batch.id,
    });
    return { id: batch.id, fresh: true };
  });
  const done = new Set((await prisma.importRow.findMany({ where: { importId: started.id }, select: { rowNumber: true } })).map((row) => row.rowNumber));
  const parsed = parseCsv(input.csv);
  const map = headerMap(parsed.headers, required, optional);
  if (!map) {
    return { ok: false as const, status: 422 as const, message: "The CSV header does not match the product columns." };
  }
  const seen = new Set<string>();
  for (const [index, cells] of parsed.rows.entries()) {
    const rowNumber = index + 2;
    const record = map(cells);
    const sku = record.sku ?? "";
    if (done.has(rowNumber)) {
      seen.add(sku);
      continue;
    }
    let status: "IMPORTED" | "SKIPPED" | "FAILED" = "FAILED";
    let message = "The row was not imported.";
    if (!sku || !record.name) {
      message = "SKU and name are required.";
    } else if (seen.has(sku)) {
      status = "SKIPPED";
      message = "That SKU is already in this file.";
    } else {
      seen.add(sku);
      const existing = await prisma.product.findFirst({ where: { organizationId: input.organizationId, liveSku: sku }, select: { id: true } });
      if (existing) {
        status = "SKIPPED";
        message = "That SKU already exists.";
      } else {
        const created = await createProduct({
          organizationId: input.organizationId,
          actorId: input.userId,
          sku,
          name: record.name,
          purchasePrice: record.purchasePrice ?? "",
          sellingPrice: record.sellingPrice ?? "",
          wholesalePrice: record.wholesalePrice ?? "",
          minimumPrice: record.minimumPrice ?? "",
          reorderLevel: record.reorderLevel || "0",
          barcode: record.barcode || undefined,
          trackStock: true,
          trackExpiry: false,
          trackBatch: false,
          trackSerial: false,
          warrantyAvailable: false,
          ip: input.ip,
          userAgent: input.userAgent,
        });
        if (created.ok) {
          status = "IMPORTED";
          message = `${sku}: Imported.`;
        } else {
          message = created.message;
        }
      }
    }
    await prisma.importRow.create({
      data: { organizationId: input.organizationId, importId: started.id, rowNumber, status, message: message.slice(0, 255) },
    });
  }
  const rows = await prisma.importRow.findMany({ where: { importId: started.id } });
  const counts = {
    totalRows: rows.length,
    successRows: rows.filter((row) => row.status === "IMPORTED").length,
    failedRows: rows.filter((row) => row.status === "FAILED").length,
    skippedRows: rows.filter((row) => row.status === "SKIPPED").length,
  };
  const batch = await prisma.import.update({ where: { id: started.id }, data: { ...counts, status: "COMPLETED" } });
  if (started.fresh) {
    await writeAudit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "import",
      module: "products",
      entityType: "import",
      entityId: batch.id,
      after: counts,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }
  return { ok: true as const, ...present(batch, rows.sort((left, right) => left.rowNumber - right.rowNumber)), replayed: !started.fresh };
}

export async function latestProductImport(organizationId: string) {
  const batch = await prisma.import.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  if (!batch) {
    return null;
  }
  return summary(organizationId, batch.id);
}

export async function exportProducts(organizationId: string) {
  const count = await prisma.product.count({ where: { organizationId, deletedAt: null } });
  if (count > 2000) {
    return { ok: false as const, status: 422 as const, message: "Export is limited to 2000 products." };
  }
  const rows = await prisma.product.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { sku: "asc" },
    select: {
      sku: true,
      name: true,
      purchasePrice: true,
      sellingPrice: true,
      wholesalePrice: true,
      minimumPrice: true,
      reorderLevel: true,
      barcodes: { take: 1, select: { barcode: true } },
    },
  });
  const csv = toCsv(
    [...required, ...optional],
    rows.map((row) => [
      row.sku,
      row.name,
      decimalString(row.purchasePrice, 2),
      decimalString(row.sellingPrice, 2),
      decimalString(row.wholesalePrice, 2),
      decimalString(row.minimumPrice, 2),
      decimalString(row.reorderLevel, 4),
      row.barcodes[0]?.barcode ?? "",
    ]),
  );
  return { ok: true as const, csv };
}
