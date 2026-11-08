-- P01 (D10, I12): document numbers count per type and per fiscal year (INV-2627-000001), not per calendar year.
-- The sequence column `year` (a calendar year) becomes `fiscalYear` and holds the fiscal-year label as a number
-- (2627 = July 2026 to June 2027). Rows written before this migration keep their old calendar-year value; no
-- fiscal-year label looks like one (the second half of a label is the first half plus one), so they are never
-- used again and numbers already issued are untouched.
--
-- The unique index is created before the old one is dropped: the foreign key on organizationId needs an index
-- that starts with that column at every moment.
ALTER TABLE `document_sequences` RENAME COLUMN `year` TO `fiscalYear`;
CREATE UNIQUE INDEX `document_sequences_organizationId_documentType_fiscalYear_key` ON `document_sequences`(`organizationId`, `documentType`, `fiscalYear`);
DROP INDEX `document_sequences_organizationId_documentType_year_key` ON `document_sequences`;
