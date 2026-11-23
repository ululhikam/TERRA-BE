-- Create dedicated role tables first for zero-downtime data migration
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "avatar_url" TEXT,
    "phone" TEXT,
    "bio" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'email',
    "email_verified" BOOLEAN NOT NULL DEFAULT true,
    "otp_code_hash" TEXT,
    "otp_expires_at" TIMESTAMP(3),
    "otp_attempts" INTEGER NOT NULL DEFAULT 0,
    "is_suspended" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organizers" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "avatar_url" TEXT,
    "phone" TEXT,
    "bio" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'email',
    "email_verified" BOOLEAN NOT NULL DEFAULT true,
    "otp_code_hash" TEXT,
    "otp_expires_at" TIMESTAMP(3),
    "otp_attempts" INTEGER NOT NULL DEFAULT 0,
    "is_suspended" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "avatar_url" TEXT,
    "phone" TEXT,
    "bio" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'email',
    "email_verified" BOOLEAN NOT NULL DEFAULT true,
    "otp_code_hash" TEXT,
    "otp_expires_at" TIMESTAMP(3),
    "otp_attempts" INTEGER NOT NULL DEFAULT 0,
    "is_suspended" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_username_key" ON "customers"("username");
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");
CREATE UNIQUE INDEX "organizers_username_key" ON "organizers"("username");
CREATE UNIQUE INDEX "organizers_email_key" ON "organizers"("email");
CREATE UNIQUE INDEX "admins_username_key" ON "admins"("username");
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- Migrate existing rows from "users" into dedicated role tables
INSERT INTO "customers" (
    "id", "full_name", "username", "email", "password_hash", "avatar_url", "phone", "bio",
    "provider", "email_verified", "otp_code_hash", "otp_expires_at", "otp_attempts",
    "is_suspended", "created_at", "updated_at"
)
SELECT
    "id", "full_name", "username", "email", "password_hash", "avatar_url", "phone", "bio",
    "provider", "email_verified", "otp_code_hash", "otp_expires_at", "otp_attempts",
    "is_suspended", "created_at", "updated_at"
FROM "users"
WHERE "role" = 'customer'
   OR "id" IN (SELECT DISTINCT "customer_id" FROM "orders" WHERE "customer_id" IS NOT NULL)
   OR "id" IN (SELECT DISTINCT "user_id" FROM "participants" WHERE "user_id" IS NOT NULL)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "organizers" (
    "id", "full_name", "username", "email", "password_hash", "avatar_url", "phone", "bio",
    "provider", "email_verified", "otp_code_hash", "otp_expires_at", "otp_attempts",
    "is_suspended", "created_at", "updated_at"
)
SELECT
    "id", "full_name", "username", "email", "password_hash", "avatar_url", "phone", "bio",
    "provider", "email_verified", "otp_code_hash", "otp_expires_at", "otp_attempts",
    "is_suspended", "created_at", "updated_at"
FROM "users"
WHERE "role" = 'organizer'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "admins" (
    "id", "full_name", "username", "email", "password_hash", "avatar_url", "phone", "bio",
    "provider", "email_verified", "otp_code_hash", "otp_expires_at", "otp_attempts",
    "is_suspended", "created_at", "updated_at"
)
SELECT
    "id", "full_name", "username", "email", "password_hash", "avatar_url", "phone", "bio",
    "provider", "email_verified", "otp_code_hash", "otp_expires_at", "otp_attempts",
    "is_suspended", "created_at", "updated_at"
FROM "users"
WHERE "role" = 'admin'
ON CONFLICT ("id") DO NOTHING;

-- Drop old ForeignKeys referencing "users"
ALTER TABLE "activity_logs" DROP CONSTRAINT "activity_logs_user_id_fkey";
ALTER TABLE "events" DROP CONSTRAINT "events_created_by_fkey";
ALTER TABLE "orders" DROP CONSTRAINT "orders_customer_id_fkey";
ALTER TABLE "organization_members" DROP CONSTRAINT "organization_members_user_id_fkey";
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_created_by_fkey";
ALTER TABLE "participants" DROP CONSTRAINT "participants_user_id_fkey";
ALTER TABLE "task_comments" DROP CONSTRAINT "task_comments_user_id_fkey";
ALTER TABLE "team_members" DROP CONSTRAINT "team_members_user_id_fkey";
ALTER TABLE "user_notifications" DROP CONSTRAINT "user_notifications_user_id_fkey";

-- AlterTable
ALTER TABLE "user_notifications" ADD COLUMN "user_role" TEXT NOT NULL DEFAULT 'organizer';

-- DropTable
DROP TABLE "users";

-- AddForeignKey pointing to role-specific tables
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "organizers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "organizers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "organizers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "organizers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "participants" ADD CONSTRAINT "participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "organizer_verifications" ADD CONSTRAINT "organizer_verifications_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "event_moderation_logs" ADD CONSTRAINT "event_moderation_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "event_reports" ADD CONSTRAINT "event_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "organizers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
