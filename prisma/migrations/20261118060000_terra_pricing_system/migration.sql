-- CreateTable: pricing_plans
CREATE TABLE "pricing_plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "price_idr" INTEGER NOT NULL DEFAULT 0,
    "billing_model" TEXT NOT NULL DEFAULT 'per_event',
    "is_popular" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "max_active_events" INTEGER NOT NULL DEFAULT 1,
    "max_participants" INTEGER NOT NULL DEFAULT 100,
    "max_team_members" INTEGER NOT NULL DEFAULT 3,
    "max_storage_mb" INTEGER NOT NULL DEFAULT 50,
    "allowed_modules" JSONB NOT NULL DEFAULT '[]',
    "features" JSONB NOT NULL DEFAULT '[]',
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "early_access_price_idr" INTEGER,
    "early_access_limit" INTEGER NOT NULL DEFAULT 100,
    "early_access_starts_at" TIMESTAMP(3),
    "early_access_ends_at" TIMESTAMP(3),
    "community_discount_pct" INTEGER NOT NULL DEFAULT 0,
    "allow_downgrade" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable: bundle_packages
CREATE TABLE "bundle_packages" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL DEFAULT 'pro',
    "event_quota" INTEGER NOT NULL DEFAULT 3,
    "bundle_price_idr" INTEGER NOT NULL DEFAULT 299000,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bundle_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable: promo_codes
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "promo_type" TEXT NOT NULL DEFAULT 'promo',
    "discount_type" TEXT NOT NULL DEFAULT 'percent',
    "discount_value" INTEGER NOT NULL DEFAULT 0,
    "applies_to_plan" TEXT,
    "requires_verification" BOOLEAN NOT NULL DEFAULT false,
    "max_redemptions" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: event_subscriptions
CREATE TABLE "event_subscriptions" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL DEFAULT 'free',
    "plan_name" TEXT NOT NULL DEFAULT 'FREE',
    "price_snapshot_idr" INTEGER NOT NULL DEFAULT 0,
    "limits_snapshot" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "is_trial" BOOLEAN NOT NULL DEFAULT false,
    "trial_started_at" TIMESTAMP(3),
    "trial_ends_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: organization_bundle_credits
CREATE TABLE "organization_bundle_credits" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "bundle_id" TEXT,
    "bundle_name" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL,
    "total_credits" INTEGER NOT NULL,
    "remaining_credits" INTEGER NOT NULL,
    "transaction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_bundle_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable: billing_transactions
CREATE TABLE "billing_transactions" (
    "id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "organizer_id" TEXT NOT NULL,
    "event_id" TEXT,
    "target_type" TEXT NOT NULL DEFAULT 'event_plan',
    "plan_code" TEXT NOT NULL,
    "plan_name" TEXT NOT NULL,
    "bundle_id" TEXT,
    "promo_code" TEXT,
    "community_org_proof" TEXT,
    "payment_method" TEXT NOT NULL DEFAULT 'manual_whatsapp',
    "base_price_idr" INTEGER NOT NULL DEFAULT 0,
    "discount_idr" INTEGER NOT NULL DEFAULT 0,
    "upgrade_credit_idr" INTEGER NOT NULL DEFAULT 0,
    "final_amount_idr" INTEGER NOT NULL DEFAULT 0,
    "plan_snapshot" JSONB NOT NULL DEFAULT '{}',
    "payment_proof_url" TEXT,
    "payment_notes" TEXT,
    "admin_notes" TEXT,
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: billing_audit_logs
CREATE TABLE "billing_audit_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "event_id" TEXT,
    "actor_id" TEXT,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "from_plan" TEXT,
    "to_plan" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pricing_plans_code_key" ON "pricing_plans"("code");
CREATE UNIQUE INDEX "bundle_packages_code_key" ON "bundle_packages"("code");
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");
CREATE UNIQUE INDEX "event_subscriptions_event_id_key" ON "event_subscriptions"("event_id");
CREATE INDEX "event_subscriptions_organization_id_idx" ON "event_subscriptions"("organization_id");
CREATE INDEX "event_subscriptions_plan_code_idx" ON "event_subscriptions"("plan_code");
CREATE INDEX "organization_bundle_credits_organization_id_idx" ON "organization_bundle_credits"("organization_id");
CREATE UNIQUE INDEX "billing_transactions_invoice_number_key" ON "billing_transactions"("invoice_number");
CREATE INDEX "billing_transactions_organization_id_idx" ON "billing_transactions"("organization_id");
CREATE INDEX "billing_transactions_organizer_id_idx" ON "billing_transactions"("organizer_id");
CREATE INDEX "billing_transactions_event_id_idx" ON "billing_transactions"("event_id");
CREATE INDEX "billing_transactions_status_idx" ON "billing_transactions"("status");
CREATE INDEX "billing_audit_logs_organization_id_idx" ON "billing_audit_logs"("organization_id");
CREATE INDEX "billing_audit_logs_event_id_idx" ON "billing_audit_logs"("event_id");

-- AddForeignKey
ALTER TABLE "event_subscriptions" ADD CONSTRAINT "event_subscriptions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_subscriptions" ADD CONSTRAINT "event_subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_bundle_credits" ADD CONSTRAINT "organization_bundle_credits_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_transactions" ADD CONSTRAINT "billing_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_transactions" ADD CONSTRAINT "billing_transactions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Supabase Row Level Security (RLS) Integration
ALTER TABLE "pricing_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bundle_packages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promo_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_bundle_credits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_audit_logs" ENABLE ROW LEVEL SECURITY;

-- Public catalog read policies for active pricing plans and bundles
CREATE POLICY "public_read_pricing_plans" ON "pricing_plans" FOR SELECT USING ("is_active" = true);
CREATE POLICY "public_read_bundle_packages" ON "bundle_packages" FOR SELECT USING ("is_active" = true);

-- Organization-scoped read policies for Supabase authenticated JWT clients
CREATE POLICY "org_read_event_subscriptions" ON "event_subscriptions" FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM "organization_members" om
    WHERE om."organization_id" = "event_subscriptions"."organization_id"
      AND om."user_id" = auth.uid()::text
  )
);

CREATE POLICY "org_read_bundle_credits" ON "organization_bundle_credits" FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM "organization_members" om
    WHERE om."organization_id" = "organization_bundle_credits"."organization_id"
      AND om."user_id" = auth.uid()::text
  )
);

CREATE POLICY "org_read_billing_transactions" ON "billing_transactions" FOR SELECT USING (
  "billing_transactions"."organizer_id" = auth.uid()::text
  OR EXISTS (
    SELECT 1 FROM "organization_members" om
    WHERE om."organization_id" = "billing_transactions"."organization_id"
      AND om."user_id" = auth.uid()::text
  )
);
