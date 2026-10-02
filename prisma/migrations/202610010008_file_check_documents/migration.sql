-- Paper-file check: documents always required, and the external (Claude / ChatGPT) reading switch.
ALTER TABLE "Tenant" ADD COLUMN "checkDocs" JSONB NOT NULL DEFAULT '["QUOTE", "CR", "DELIVERY_NOTE", "RECEIPT", "INVOICE", "IBAN", "UNDERTAKING"]';
ALTER TABLE "Tenant" ADD COLUMN "checkPrompt" BOOLEAN NOT NULL DEFAULT true;
