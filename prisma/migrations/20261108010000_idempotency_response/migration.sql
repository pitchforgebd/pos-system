-- P01: a repeated request is answered with exactly the answer the first request got (N24).
-- Keys saved before this migration have no answer; they keep replaying with the module's own shape.
ALTER TABLE `idempotency_keys` ADD COLUMN `response` JSON NULL;
