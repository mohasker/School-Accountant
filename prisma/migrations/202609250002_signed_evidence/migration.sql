ALTER TABLE "Evidence" ADD COLUMN "certificateId" UUID;
ALTER TABLE "Evidence" ADD CONSTRAINT signed_certificate_fk FOREIGN KEY ("certificateId", "caseId") REFERENCES "Certificate"(id,"caseId") ON DELETE RESTRICT;
ALTER TABLE "Evidence" ADD CONSTRAINT signed_certificate_required CHECK ((code IN (13,14) AND "certificateId" IS NOT NULL) OR (code BETWEEN 1 AND 12 AND "certificateId" IS NULL));
