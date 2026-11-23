-- AlterTable: Add subscription fields to organizers table
ALTER TABLE "organizers"
ADD COLUMN "subscription_plan" TEXT NOT NULL DEFAULT 'free_trial',
ADD COLUMN "subscription_status" TEXT NOT NULL DEFAULT 'trialing',
ADD COLUMN "subscription_expires_at" TIMESTAMP(3);

-- Preserve active access for existing organizers (30 days default window)
UPDATE "organizers"
SET
  "subscription_plan" = 'pro_monthly',
  "subscription_status" = 'active',
  "subscription_expires_at" = NOW() + INTERVAL '30 days'
WHERE "subscription_expires_at" IS NULL;
