-- Certificate gate switch and the invoice total entered at delivery.
ALTER TABLE "Tenant" ADD COLUMN "certGate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Delivery" ADD COLUMN "invoiceAmount" DECIMAL(18,2);
