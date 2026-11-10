import { Prisma } from "@prisma/client";

import { PARTY_ROLES } from "@/core/ledger/roles";

type Db = Prisma.TransactionClient;

export type PartyLineViolation = { lineId: string; problem: string };

// Built from constants (the role names and party kinds in roles.ts), never from input.
const roleList = Prisma.raw(
  Object.keys(PARTY_ROLES)
    .map((role) => `'${role}'`)
    .join(", "),
);
const expectedKind = Prisma.raw(`CASE r.role ${Object.entries(PARTY_ROLES).map(([role, kind]) => `WHEN '${role}' THEN '${kind}'`).join(" ")} END`);

/**
 * I2 over everything already in the ledger: a receivable, payable, advance or courier line has a party of the right kind, and
 * no other line has one. The engine refuses a bad line before it is written; this finds one that got in some other way (an
 * old row, a direct insert), so a test or the daily check can name the line. An empty list means the ledger holds.
 */
export async function partyLineViolations(db: Db, organizationId: string): Promise<PartyLineViolation[]> {
  const rows = await db.$queryRaw<{ id: string; role: string | null; partyType: string | null }[]>`
    SELECT l.id, r.role, l.partyType
    FROM journal_lines l
    LEFT JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role IN (${roleList})
    WHERE l.organizationId = ${organizationId}
      AND (
        (r.role IS NULL AND (l.partyId IS NOT NULL OR l.partyType IS NOT NULL))
        OR (r.role IS NOT NULL AND (l.partyId IS NULL OR l.partyType IS NULL OR l.partyType <> ${expectedKind}))
      )
    ORDER BY l.id
  `;
  return rows.map((row) => ({
    lineId: row.id,
    problem: row.role
      ? row.partyType
        ? `${row.role} line about a ${row.partyType.toLowerCase()}, expected a ${PARTY_ROLES[row.role as keyof typeof PARTY_ROLES].toLowerCase()}`
        : `${row.role} line without a party`
      : "a party on a line that is not receivable, payable or advance",
  }));
}
