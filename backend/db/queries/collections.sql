-- Collections domain queries (Phase 2). Every read and write is scoped by the session
-- userId (IDOR-safe). itemCount is the count of item_collections rows for the collection.
-- The per-collection top-4 item-type breakdown is fetched separately via
-- GetCollectionTypeCounts (the ROW_NUMBER() window ported 1:1 from getCollectionTypeCounts).

-- name: ListCollections :many
-- GET /collections (getAllCollections): favorites first, then most-recently-updated. Type
-- chips are joined on in the handler via GetCollectionTypeCounts.
SELECT
    c.id,
    c.name,
    c.description,
    c."isFavorite",
    c."createdAt",
    (SELECT COUNT(*)::int FROM item_collections ic WHERE ic."collectionId" = c.id) AS "itemCount"
FROM collections c
WHERE c."userId" = sqlc.arg('owner')
ORDER BY c."isFavorite" DESC, c."updatedAt" DESC;

-- name: GetCollectionByID :one
-- GET /collections/{id} and the re-read after create/update. Base shape; type chips joined
-- on separately.
SELECT
    c.id,
    c.name,
    c.description,
    c."isFavorite",
    c."createdAt",
    (SELECT COUNT(*)::int FROM item_collections ic WHERE ic."collectionId" = c.id) AS "itemCount"
FROM collections c
WHERE c.id = sqlc.arg('id') AND c."userId" = sqlc.arg('owner');

-- name: GetCollectionTypeCounts :many
-- The top-4 item types per collection, ranked by count (ROW_NUMBER() OVER PARTITION BY
-- collectionId). Ported 1:1 from getCollectionTypeCounts. Takes the set of collection ids
-- the handler is rendering, and scopes them by the session owner so the query is IDOR-safe
-- on its own (not merely because its callers pass owner-scoped ids).
WITH type_counts AS (
    SELECT
        ic."collectionId",
        it.id,
        it.name,
        it.icon,
        it.color,
        it."isSystem",
        COUNT(*)::int AS count
    FROM item_collections ic
    JOIN collections co ON co.id = ic."collectionId" AND co."userId" = sqlc.arg('owner')
    JOIN items i ON ic."itemId" = i.id
    JOIN item_types it ON i."itemTypeId" = it.id
    WHERE ic."collectionId" = ANY(sqlc.arg('collection_ids')::text[])
    GROUP BY ic."collectionId", it.id, it.name, it.icon, it.color, it."isSystem"
),
ranked AS (
    SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY "collectionId" ORDER BY count DESC) AS rn
    FROM type_counts
)
SELECT "collectionId", id, name, icon, color, "isSystem", count
FROM ranked
WHERE rn <= 4
ORDER BY "collectionId", count DESC;

-- name: CreateCollection :one
-- POST /collections. itemCount is always 0 for a fresh collection.
INSERT INTO collections (id, name, description, "userId", "updatedAt")
VALUES (sqlc.arg('id'), sqlc.arg('name'), sqlc.narg('description'), sqlc.arg('owner'), now())
RETURNING id, name, description, "isFavorite", "createdAt", 0::int AS "itemCount";

-- name: UpdateCollection :execrows
-- PATCH /collections/{id}. A partial update: name and isFavorite fall back to the current
-- value when omitted (COALESCE); description is set only when the caller marks it provided
-- (description_set), so it can be explicitly cleared to NULL without a null param being
-- mistaken for "unchanged". Scoped; 0 rows → 404.
UPDATE collections SET
    name = COALESCE(sqlc.narg('name'), name),
    description = CASE WHEN sqlc.arg('description_set')::bool THEN sqlc.narg('description') ELSE description END,
    "isFavorite" = COALESCE(sqlc.narg('is_favorite'), "isFavorite"),
    "updatedAt" = now()
WHERE id = sqlc.arg('id') AND "userId" = sqlc.arg('owner');

-- name: DeleteCollection :execrows
-- DELETE /collections/{id}. Scoped delete; 0 rows → 404. item_collections rows cascade.
DELETE FROM collections WHERE id = sqlc.arg('id') AND "userId" = sqlc.arg('owner');

-- name: SetCollectionFavorite :execrows
-- PATCH /collections/{id}/favorite. Scoped update; 0 rows → 404.
UPDATE collections SET "isFavorite" = sqlc.arg('is_favorite'), "updatedAt" = now()
WHERE id = sqlc.arg('id') AND "userId" = sqlc.arg('owner');

-- name: CountCollectionsByUser :one
-- Free-tier gate (canCreateCollection): the user's total collection count.
SELECT COUNT(*)::bigint FROM collections WHERE "userId" = sqlc.arg('owner');
