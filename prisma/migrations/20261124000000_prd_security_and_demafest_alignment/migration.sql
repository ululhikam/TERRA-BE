-- PRD & Master Plan Alignment Migration: Missing Columns, CHECK Constraints, Indexes & Full Core RLS

-- 1. Add missing columns idempotently
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "parent_event_id" TEXT;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "theme_color" TEXT;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "faq" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "event_schedules" ADD COLUMN IF NOT EXISTS "track" TEXT;

ALTER TABLE "event_tasks" ADD COLUMN IF NOT EXISTS "labels" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "event_tasks" ADD COLUMN IF NOT EXISTS "checklists" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "event_tasks" ADD COLUMN IF NOT EXISTS "created_by" TEXT;

ALTER TABLE "ticket_types" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "ticket_types" ADD COLUMN IF NOT EXISTS "sale_start_at" TEXT;
ALTER TABLE "ticket_types" ADD COLUMN IF NOT EXISTS "sale_end_at" TEXT;
ALTER TABLE "ticket_types" ADD COLUMN IF NOT EXISTS "benefits" TEXT;
ALTER TABLE "ticket_types" ADD COLUMN IF NOT EXISTS "terms" TEXT;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_proof_url" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_notes" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "verified_by" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMP(3);

ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "sponsors" ADD COLUMN IF NOT EXISTS "logo_url" TEXT;

ALTER TABLE "event_documents" ADD COLUMN IF NOT EXISTS "file_type" TEXT;
ALTER TABLE "event_documents" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "event_documents" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "event_surveys" ADD COLUMN IF NOT EXISTS "questions" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "activity_logs" ADD COLUMN IF NOT EXISTS "entity_id" TEXT;

-- 2. Missing indexes
CREATE INDEX IF NOT EXISTS "events_start_at_idx" ON "events"("start_at");
CREATE INDEX IF NOT EXISTS "events_parent_event_id_idx" ON "events"("parent_event_id");

-- 3. Monetary and quota CHECK constraints (guarded against existing duplicates/legacy rows)
DO $$ BEGIN
  ALTER TABLE "events" ADD CONSTRAINT "chk_events_capacity_nonneg" CHECK ("capacity" >= 0);
EXCEPTION WHEN duplicate_object OR check_violation THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ticket_types" ADD CONSTRAINT "chk_ticket_types_price_nonneg" CHECK ("price" >= 0);
EXCEPTION WHEN duplicate_object OR check_violation THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ticket_types" ADD CONSTRAINT "chk_ticket_types_qty_bounds" CHECK ("quantity" >= 0 AND "sold_quantity" >= 0 AND "sold_quantity" <= "quantity");
EXCEPTION WHEN duplicate_object OR check_violation THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "chk_orders_totals_nonneg" CHECK ("subtotal" >= 0 AND "total" >= 0);
EXCEPTION WHEN duplicate_object OR check_violation THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "event_budgets" ADD CONSTRAINT "chk_event_budgets_amount_nonneg" CHECK ("amount" >= 0);
EXCEPTION WHEN duplicate_object OR check_violation THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "finance_incomes" ADD CONSTRAINT "chk_finance_incomes_amount_nonneg" CHECK ("amount" >= 0);
EXCEPTION WHEN duplicate_object OR check_violation THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "finance_expenses" ADD CONSTRAINT "chk_finance_expenses_amount_nonneg" CHECK ("amount" >= 0);
EXCEPTION WHEN duplicate_object OR check_violation THEN NULL; END $$;

-- 4. Enable Row Level Security (RLS) on ALL core & companion tables
DO $$
DECLARE
  tbl TEXT;
  tbls TEXT[] := ARRAY[
    'customers', 'organizers', 'admins',
    'organizations', 'organization_members',
    'categories', 'events',
    'team_members', 'team_invites',
    'event_schedules', 'event_tasks', 'task_comments',
    'ticket_types', 'orders', 'order_items', 'participants', 'tickets', 'checkin_logs',
    'event_budgets', 'finance_incomes', 'finance_expenses',
    'vendors', 'sponsors', 'event_documents', 'event_surveys',
    'organizer_verifications', 'event_moderation_logs', 'event_reports',
    'user_notifications', 'activity_logs',
    'event_companion_posts', 'event_companion_replies'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    END IF;
  END LOOP;
END $$;

-- Public Marketplace Read Policies (PostgREST / anon / authenticated clients)
DROP POLICY IF EXISTS "public_read_active_categories" ON "categories";
CREATE POLICY "public_read_active_categories" ON "categories"
  FOR SELECT USING ("is_active" = true);

DROP POLICY IF EXISTS "public_read_organizations" ON "organizations";
CREATE POLICY "public_read_organizations" ON "organizations"
  FOR SELECT USING ("deleted_at" IS NULL);

DROP POLICY IF EXISTS "public_read_published_events" ON "events";
CREATE POLICY "public_read_published_events" ON "events"
  FOR SELECT USING ("publication_status" = 'Published' AND "status" <> 'Cancelled' AND "deleted_at" IS NULL);

DROP POLICY IF EXISTS "public_read_published_ticket_types" ON "ticket_types";
CREATE POLICY "public_read_published_ticket_types" ON "ticket_types"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "events" e
      WHERE e."id" = "ticket_types"."event_id"
        AND e."publication_status" = 'Published'
        AND e."deleted_at" IS NULL
    )
  );
