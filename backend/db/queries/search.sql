-- Search domain queries (Phase 2). Uncached global search, scoped by session userId.
-- Fuzzy substring match via ILIKE against the pg_trgm GIN-indexed columns (parity with the
-- Next app's `contains`/`insensitive` mode — NOT a tsvector rewrite). The query term is
-- wrapped as '%' || $query || '%' by the caller-supplied pattern arg.

-- name: SearchItems :many
-- Item hits: title/description/content/tag-name ILIKE, capped at 20, updatedAt desc.
-- Returns the same LightItem projection as the item list (so a search hit opens a fully
-- hydrated drawer).
SELECT
    i.id,
    i.title,
    i."createdAt",
    i.url,
    i."fileName",
    i."fileSize",
    i."isFavorite",
    i."isPinned",
    it.name AS "itemTypeName",
    COALESCE(LEFT(i.description, 150), '')::text AS "descriptionPreview",
    COALESCE(LEFT(i.content, 150), '')::text AS "contentPreview",
    COALESCE(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.name IS NOT NULL), '{}'::text[])::text[] AS tags
FROM items i
JOIN item_types it ON it.id = i."itemTypeId"
LEFT JOIN "_ItemTags" itag ON itag."A" = i.id
LEFT JOIN tags t ON t.id = itag."B"
WHERE i."userId" = sqlc.arg('owner')
    AND (
        i.title ILIKE sqlc.arg('pattern')
        OR i.description ILIKE sqlc.arg('pattern')
        OR i.content ILIKE sqlc.arg('pattern')
        OR EXISTS (
            SELECT 1 FROM "_ItemTags" it2
            JOIN tags tg ON tg.id = it2."B"
            WHERE it2."A" = i.id AND tg.name ILIKE sqlc.arg('pattern')
        )
    )
GROUP BY i.id, it.name
ORDER BY i."updatedAt" DESC
LIMIT 20;

-- name: SearchCollections :many
-- Collection hits: name/description ILIKE, capped at 10, updatedAt desc. Returns the
-- SidebarCollection shape (no type chips, no dates); dominantColor is always null in search
-- (parity with mapSidebarCollection's default).
SELECT
    c.id,
    c.name,
    c.description,
    c."isFavorite",
    (SELECT COUNT(*)::int FROM item_collections ic WHERE ic."collectionId" = c.id) AS "itemCount"
FROM collections c
WHERE c."userId" = sqlc.arg('owner')
    AND (
        c.name ILIKE sqlc.arg('pattern')
        OR c.description ILIKE sqlc.arg('pattern')
    )
ORDER BY c."updatedAt" DESC
LIMIT 10;
