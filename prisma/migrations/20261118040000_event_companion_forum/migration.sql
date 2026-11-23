-- CreateTable: event_companion_posts
CREATE TABLE "event_companion_posts" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departure_city" TEXT NOT NULL,
    "departure_point" TEXT NOT NULL,
    "departure_time" TEXT,
    "transport_mode" TEXT NOT NULL DEFAULT 'KRL / MRT / TransJakarta',
    "slots_available" INTEGER NOT NULL DEFAULT 3,
    "contact_note" TEXT,
    "notes" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_companion_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: event_companion_replies
CREATE TABLE "event_companion_replies" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_companion_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_companion_posts_event_id_idx" ON "event_companion_posts"("event_id");

-- CreateIndex
CREATE INDEX "event_companion_posts_author_id_idx" ON "event_companion_posts"("author_id");

-- CreateIndex
CREATE INDEX "event_companion_replies_post_id_idx" ON "event_companion_replies"("post_id");

-- AddForeignKey
ALTER TABLE "event_companion_posts" ADD CONSTRAINT "event_companion_posts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_companion_posts" ADD CONSTRAINT "event_companion_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_companion_replies" ADD CONSTRAINT "event_companion_replies_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "event_companion_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_companion_replies" ADD CONSTRAINT "event_companion_replies_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
