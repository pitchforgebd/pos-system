import { Prisma, type DocumentType } from "@prisma/client";

import { fiscalYear } from "@/core/time";

// Document numbers count per type and per fiscal year: INV-2627-000001 is the first invoice of the fiscal year
// July 2026 to June 2027 (D10, I12). The counter has no gaps: it is a row that is locked and increased inside the
// same transaction as the document, so a document that is not saved gives its number back.

/** INV-2627-000042. The label is the fiscal year as a number (2627), shown with at least four digits. */
export function formatDocumentNumber(documentType: DocumentType, label: number, value: number) {
  return `${documentType}-${String(label).padStart(4, "0")}-${String(value).padStart(6, "0")}`;
}

/**
 * The next number of `documentType` for the fiscal year that contains `businessDate` (the document's own date, so a
 * late entry dated last June still counts in last year). Call it inside the transaction that saves the document.
 */
export async function allocateNumber(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; documentType: DocumentType; businessDate: string },
) {
  const organization = await tx.organization.findUnique({
    where: { id: input.organizationId },
    select: { fiscalYearStartMonth: true },
  });
  if (!organization) {
    throw new Error("Organization not found.");
  }
  const label = Number(fiscalYear(input.businessDate, organization.fiscalYearStartMonth).label);
  const where = {
    organizationId_documentType_fiscalYear: {
      organizationId: input.organizationId,
      documentType: input.documentType,
      fiscalYear: label,
    },
  };
  const existing = await tx.documentSequence.findUnique({ where });
  if (!existing) {
    try {
      await tx.documentSequence.create({
        data: {
          organizationId: input.organizationId,
          documentType: input.documentType,
          fiscalYear: label,
          lastValue: 0,
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
    }
  }
  const locked = await tx.$queryRaw<Array<{ id: string; lastValue: number }>>`
    SELECT id, lastValue FROM document_sequences
    WHERE organizationId = ${input.organizationId}
      AND documentType = ${input.documentType}
      AND fiscalYear = ${label}
    FOR UPDATE
  `;
  const row = locked[0];
  if (!row) {
    throw new Error("Document sequence was not locked.");
  }
  const next = Number(row.lastValue) + 1;
  // updateMany, not update: update re-reads the row from this transaction's snapshot, which cannot
  // see a sequence another request created and committed a moment ago (first number of the year).
  await tx.documentSequence.updateMany({ where: { id: row.id }, data: { lastValue: next } });
  return formatDocumentNumber(input.documentType, label, next);
}
