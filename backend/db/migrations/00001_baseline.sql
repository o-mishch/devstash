-- +goose Up
-- Baseline migration: the DevStash schema exactly as already applied on the Neon
-- `dev` branch (introspected via `prisma migrate diff --from-empty --to-config-datasource`).
-- goose takes ownership of all schema changes from here; Prisma migrations are frozen.
-- This file is marked already-applied on existing environments (see backend/db/README),
-- so it is only ever replayed against a fresh database.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public" VERSION "1.6";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "plpgsql" WITH SCHEMA "pg_catalog" VERSION "1.0";

-- CreateEnum
CREATE TYPE "public"."ContentType" AS ENUM ('TEXT', 'FILE', 'URL');

-- CreateEnum
CREATE TYPE "public"."StripeWebhookEventStatus" AS ENUM ('processing', 'processed');

-- CreateEnum
CREATE TYPE "public"."SubscriptionInterval" AS ENUM ('month', 'year');

-- CreateTable
CREATE TABLE "public"."_ItemTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ItemTags_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "email" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_parse_job_items" (
    "id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "itemTypeName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "url" TEXT,
    "language" TEXT,
    "description" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trashed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ai_parse_job_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_parse_jobs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "sourceText" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "openaiResponseId" TEXT,
    "streamCursor" INTEGER,
    "collectionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "collectionName" TEXT,
    "sourceItemId" TEXT,
    "sourceName" TEXT,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "committedCount" INTEGER NOT NULL DEFAULT 0,
    "committedByType" JSONB,

    CONSTRAINT "ai_parse_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."collections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultTypeId" TEXT,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."item_collections" (
    "itemId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_collections_pkey" PRIMARY KEY ("itemId","collectionId")
);

-- CreateTable
CREATE TABLE "public"."item_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,

    CONSTRAINT "item_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."items" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentType" "public"."ContentType" NOT NULL,
    "content" TEXT,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "url" TEXT,
    "description" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "itemTypeId" TEXT NOT NULL,
    "imageHeight" INTEGER,
    "imageWidth" INTEGER,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stripe_webhook_events" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "public"."StripeWebhookEventStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "password" TEXT,
    "isPro" BOOLEAN NOT NULL DEFAULT false,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "editorPreferences" JSONB,
    "stripeSubscriptionStart" TIMESTAMP(3),
    "stripeCurrentPeriodEnd" TIMESTAMP(3),
    "proExpiredAt" TIMESTAMP(3),
    "stripeCancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "stripeSubscriptionInterval" "public"."SubscriptionInterval",
    "stripeLastSyncAt" TIMESTAMP(3),
    "stripeSubscriptionStatus" TEXT,
    "credentialEmail" TEXT,
    "credentialEmailVerified" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE INDEX "_ItemTags_B_index" ON "public"."_ItemTags"("B" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "public"."accounts"("provider" ASC, "providerAccountId" ASC);

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "public"."accounts"("userId" ASC);

-- CreateIndex
CREATE INDEX "ai_parse_job_items_jobId_idx" ON "public"."ai_parse_job_items"("jobId" ASC);

-- CreateIndex
CREATE INDEX "ai_parse_job_items_userId_idx" ON "public"."ai_parse_job_items"("userId" ASC);

-- CreateIndex
CREATE INDEX "ai_parse_jobs_userId_createdAt_idx" ON "public"."ai_parse_jobs"("userId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "ai_parse_jobs_userId_status_idx" ON "public"."ai_parse_jobs"("userId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "collections_description_idx" ON "public"."collections" USING GIN ("description" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "collections_name_idx" ON "public"."collections" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "collections_userId_updatedAt_idx" ON "public"."collections"("userId" ASC, "updatedAt" ASC);

-- CreateIndex
CREATE INDEX "item_collections_collectionId_idx" ON "public"."item_collections"("collectionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "item_types_name_userId_key" ON "public"."item_types"("name" ASC, "userId" ASC);

-- CreateIndex
CREATE INDEX "items_content_idx" ON "public"."items" USING GIN ("content" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "items_description_idx" ON "public"."items" USING GIN ("description" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "items_itemTypeId_idx" ON "public"."items"("itemTypeId" ASC);

-- CreateIndex
CREATE INDEX "items_title_idx" ON "public"."items" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "items_userId_createdAt_idx" ON "public"."items"("userId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "public"."sessions"("sessionToken" ASC);

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "public"."sessions"("userId" ASC);

-- CreateIndex
CREATE INDEX "stripe_webhook_events_status_createdAt_idx" ON "public"."stripe_webhook_events"("status" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "public"."tags"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_credentialEmail_key" ON "public"."users"("credentialEmail" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_stripeCustomerId_key" ON "public"."users"("stripeCustomerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_stripeSubscriptionId_key" ON "public"."users"("stripeSubscriptionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "public"."verification_tokens"("identifier" ASC, "token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "public"."verification_tokens"("token" ASC);

-- AddForeignKey
ALTER TABLE "public"."_ItemTags" ADD CONSTRAINT "_ItemTags_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_ItemTags" ADD CONSTRAINT "_ItemTags_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_parse_job_items" ADD CONSTRAINT "ai_parse_job_items_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."ai_parse_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_parse_job_items" ADD CONSTRAINT "ai_parse_job_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_parse_jobs" ADD CONSTRAINT "ai_parse_jobs_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "public"."items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_parse_jobs" ADD CONSTRAINT "ai_parse_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."collections" ADD CONSTRAINT "collections_defaultTypeId_fkey" FOREIGN KEY ("defaultTypeId") REFERENCES "public"."item_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."collections" ADD CONSTRAINT "collections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."item_collections" ADD CONSTRAINT "item_collections_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "public"."collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."item_collections" ADD CONSTRAINT "item_collections_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."item_types" ADD CONSTRAINT "item_types_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."items" ADD CONSTRAINT "items_itemTypeId_fkey" FOREIGN KEY ("itemTypeId") REFERENCES "public"."item_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."items" ADD CONSTRAINT "items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- +goose Down
-- Intentionally empty. This is a squashed baseline representing pre-existing schema;
-- rolling it back would drop every table. Recreate the database from scratch instead.
