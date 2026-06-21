-- CreateTable
CREATE TABLE "ai_parse_jobs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "sourceText" TEXT NOT NULL,
    "error" TEXT,
    "openaiResponseId" TEXT,
    "streamCursor" INTEGER,
    "collectionName" TEXT,
    "collectionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceItemId" TEXT,
    "sourceName" TEXT,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ai_parse_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_parse_job_items" (
    "id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "itemTypeName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "url" TEXT,
    "language" TEXT,
    "description" TEXT,
    "tags" TEXT[],
    "trashed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ai_parse_job_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_parse_jobs_userId_createdAt_idx" ON "ai_parse_jobs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_parse_jobs_userId_status_idx" ON "ai_parse_jobs"("userId", "status");

-- CreateIndex
CREATE INDEX "ai_parse_job_items_jobId_idx" ON "ai_parse_job_items"("jobId");

-- CreateIndex
CREATE INDEX "ai_parse_job_items_userId_idx" ON "ai_parse_job_items"("userId");

-- AddForeignKey
ALTER TABLE "ai_parse_jobs" ADD CONSTRAINT "ai_parse_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_parse_jobs" ADD CONSTRAINT "ai_parse_jobs_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_parse_job_items" ADD CONSTRAINT "ai_parse_job_items_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ai_parse_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_parse_job_items" ADD CONSTRAINT "ai_parse_job_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
