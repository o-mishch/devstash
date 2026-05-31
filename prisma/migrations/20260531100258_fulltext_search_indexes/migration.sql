-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- DropIndex
DROP INDEX "items_userId_idx";

-- CreateIndex
CREATE INDEX "collections_name_idx" ON "collections" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "collections_description_idx" ON "collections" USING GIN ("description" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "items_title_idx" ON "items" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "items_description_idx" ON "items" USING GIN ("description" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "items_content_idx" ON "items" USING GIN ("content" gin_trgm_ops);
