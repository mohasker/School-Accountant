-- Round 2 (trial feedback): suppliers can be entered by name from a quote, the school records its
-- purchasing officer, the quote report keeps its date, and the system administrator can purge data.
ALTER TABLE "Supplier" ALTER COLUMN "cr" DROP NOT NULL;
ALTER TABLE "School" ADD COLUMN "purchasingOfficer" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Case" ADD COLUMN "reportDate" DATE;

-- History stays append-only; only an explicit administrator purge (set_config('madar.purge', 'on', true)
-- inside its transaction) may delete rows, never update them.
CREATE OR REPLACE FUNCTION reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('madar.purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Financial history is append-only';
END;
$$;

-- Items keep the order in which they were entered (quote report, assignment letter, certificate).
ALTER TABLE "Item" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
