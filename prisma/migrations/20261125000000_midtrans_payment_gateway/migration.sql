-- Non-destructive additive migration for Midtrans Snap payment gateway support
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "payment_method" TEXT NOT NULL DEFAULT 'midtrans_snap',
  ADD COLUMN IF NOT EXISTS "payment_provider" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_token" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_redirect_url" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_reference" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "payment_metadata" JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS "orders_payment_reference_idx" ON "orders"("payment_reference");

ALTER TABLE "billing_transactions"
  ALTER COLUMN "payment_method" SET DEFAULT 'payment_gateway',
  ADD COLUMN IF NOT EXISTS "payment_provider" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_token" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_redirect_url" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_reference" TEXT,
  ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "payment_metadata" JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS "billing_transactions_payment_reference_idx" ON "billing_transactions"("payment_reference");
