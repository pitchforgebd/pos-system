import { Prisma, type DocumentType } from "@prisma/client";

export async function allocateNumber(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; documentType: DocumentType; year: number },
) {
  const where = {
    organizationId_documentType_year: {
      organizationId: input.organizationId,
      documentType: input.documentType,
      year: input.year,
    },
  };
  const existing = await tx.documentSequence.findUnique({ where });
  if (!existing) {
    try {
      await tx.documentSequence.create({
        data: {
          organizationId: input.organizationId,
          documentType: input.documentType,
          year: input.year,
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
      AND year = ${input.year}
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
  return `${input.documentType}-${input.year}-${String(next).padStart(6, "0")}`;
}

export function documentYear(occurredOn: string) {
  return Number(occurredOn.slice(0, 4));
}
