-- Stock documents (opening, own stock, adjustment, damage, expiry, take-off) are numbered STK-<fiscal year>-<n>.
ALTER TABLE `document_sequences` MODIFY `documentType` ENUM('STK', 'INV', 'PUR', 'RET', 'QUO', 'REQ', 'TRF', 'PAY', 'EXP', 'VCH') NOT NULL;
