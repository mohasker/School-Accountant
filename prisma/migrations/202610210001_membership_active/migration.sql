-- The schools an accountant currently works in: an inactive link keeps the school and its history
-- reachable but leaves it out of the accountant's totals, reminders and the supervision screen.
ALTER TABLE "Membership" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
