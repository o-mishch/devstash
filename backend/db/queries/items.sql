-- Items domain queries (Phase 2). Every read and write is scoped by the session
-- userId ($owner / sqlc.arg('owner')), never a path/body value (IDOR-safe). Tags are
-- written through the implicit Prisma join table "_ItemTags" (A = item id, B = tag id);
-- new tag ids come from the injected IDs func (UUIDv7), matching Phase 1.
--
-- The LightItem projection (id, title, createdAt, url, file fields, favorite/pinned,
-- itemType name, LEFT(...,150) previews, and the aggregated tag names) is repeated across
-- the four list queries and the search query. Unlike the Next app's per-type selects
-- (LIGHT_ITEM_SELECT{,_FILE,_IMAGE}), the Go queries return one uniform superset shape for
-- every type — a file/image row now carries its tags/url instead of the lossy []/null the
-- TS optimization dropped. The wire shape is a superset, never missing a field.

-- name: ListRecentItems :many
-- GET /items?type=recent. Keyset pagination on (isPinned desc, createdAt desc, id desc);
-- LIMIT is PAGE_SIZE+1 so the handler detects hasMore. A null cursor is the first page.
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
        sqlc.narg('cursor')::text IS NULL
        OR EXISTS (
            SELECT 1 FROM items c
            WHERE c.id = sqlc.narg('cursor') AND c."userId" = sqlc.arg('owner')
                AND (i."isPinned", i."createdAt", i.id) < (c."isPinned", c."createdAt", c.id)
        )
    )
GROUP BY i.id, it.name
ORDER BY i."isPinned" DESC, i."createdAt" DESC, i.id DESC
LIMIT sqlc.arg('page_limit');

-- name: ListItemsByType :many
-- GET /items?type=type&typeName=... — same keyset order, filtered to one item type name.
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
    AND it.name = sqlc.arg('type_name')
    AND (
        sqlc.narg('cursor')::text IS NULL
        OR EXISTS (
            SELECT 1 FROM items c
            WHERE c.id = sqlc.narg('cursor') AND c."userId" = sqlc.arg('owner')
                AND (i."isPinned", i."createdAt", i.id) < (c."isPinned", c."createdAt", c.id)
        )
    )
GROUP BY i.id, it.name
ORDER BY i."isPinned" DESC, i."createdAt" DESC, i.id DESC
LIMIT sqlc.arg('page_limit');

-- name: ListItemsByCollection :many
-- GET /items?type=collection&collectionId=... — same keyset order, membership-filtered.
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
    AND EXISTS (
        SELECT 1 FROM item_collections ic
        WHERE ic."itemId" = i.id AND ic."collectionId" = sqlc.arg('collection_id')
    )
    AND (
        sqlc.narg('cursor')::text IS NULL
        OR EXISTS (
            SELECT 1 FROM items c
            WHERE c.id = sqlc.narg('cursor') AND c."userId" = sqlc.arg('owner')
                AND (i."isPinned", i."createdAt", i.id) < (c."isPinned", c."createdAt", c.id)
        )
    )
GROUP BY i.id, it.name
ORDER BY i."isPinned" DESC, i."createdAt" DESC, i.id DESC
LIMIT sqlc.arg('page_limit');

-- name: ListFavoriteItems :many
-- GET /items?type=favorites — favorites use a distinct order (updatedAt desc, id desc),
-- so the keyset compares the (updatedAt, id) tuple instead of (isPinned, createdAt, id).
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
    AND i."isFavorite" = true
    AND (
        sqlc.narg('cursor')::text IS NULL
        OR EXISTS (
            SELECT 1 FROM items c
            WHERE c.id = sqlc.narg('cursor') AND c."userId" = sqlc.arg('owner')
                AND (i."updatedAt", i.id) < (c."updatedAt", c.id)
        )
    )
GROUP BY i.id, it.name
ORDER BY i."updatedAt" DESC, i.id DESC
LIMIT sqlc.arg('page_limit');

-- name: GetItemByID :one
-- GET /items/{id}: the full drawer shape (FullItem). Returns raw description/content so
-- the handler computes the 150-char previews (parity with toFullItem's slice(0,150)).
SELECT
    i.id,
    i.title,
    i."createdAt",
    i."updatedAt",
    i.url,
    i."fileName",
    i."fileSize",
    i."isFavorite",
    i."isPinned",
    i.description,
    i.content,
    i.language,
    it.name AS "itemTypeName",
    COALESCE(array_agg(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), '{}'::text[])::text[] AS tags,
    COALESCE(
        jsonb_agg(DISTINCT jsonb_build_object('id', col.id, 'name', col.name))
            FILTER (WHERE col.id IS NOT NULL),
        '[]'::jsonb
    )::jsonb AS collections
FROM items i
JOIN item_types it ON it.id = i."itemTypeId"
LEFT JOIN "_ItemTags" itag ON itag."A" = i.id
LEFT JOIN tags t ON t.id = itag."B"
LEFT JOIN item_collections ic ON ic."itemId" = i.id
LEFT JOIN collections col ON col.id = ic."collectionId"
WHERE i.id = sqlc.arg('id') AND i."userId" = sqlc.arg('owner')
GROUP BY i.id, it.name;

-- name: GetItemDetails :one
-- GET /items/{id}/details: only the fields LightItem doesn't carry.
SELECT
    i.description,
    i."updatedAt",
    COALESCE(
        jsonb_agg(DISTINCT jsonb_build_object('id', col.id, 'name', col.name))
            FILTER (WHERE col.id IS NOT NULL),
        '[]'::jsonb
    )::jsonb AS collections
FROM items i
LEFT JOIN item_collections ic ON ic."itemId" = i.id
LEFT JOIN collections col ON col.id = ic."collectionId"
WHERE i.id = sqlc.arg('id') AND i."userId" = sqlc.arg('owner')
GROUP BY i.id;

-- name: GetItemContent :one
-- GET /items/{id}/content: content + language for content-bearing types.
SELECT content, language FROM items
WHERE id = sqlc.arg('id') AND "userId" = sqlc.arg('owner');

-- name: GetItemForAuth :one
-- Server-only mutation guard (PATCH/DELETE): the item's id, current type id + name, and
-- file reference so the handler can enforce the Pro gate and the source-type retype guard,
-- and reuse the current type id when a PATCH does not retype (no extra lookup).
SELECT i.id, i."itemTypeId", i."fileUrl", i."fileName", it.name AS "itemTypeName"
FROM items i
JOIN item_types it ON it.id = i."itemTypeId"
WHERE i.id = sqlc.arg('id') AND i."userId" = sqlc.arg('owner');

-- name: GetItemTypeByName :one
-- Resolve an item type name to its id, preferring the system type (userId NULL) over a
-- user's same-named custom type (parity: systemTypes.find(...) ?? custom lookup).
SELECT id FROM item_types
WHERE name = sqlc.arg('name') AND ("userId" IS NULL OR "userId" = sqlc.arg('owner'))
ORDER BY ("userId" IS NULL) DESC
LIMIT 1;

-- name: CreateItem :one
-- POST /items. One statement: resolve the type, insert the item, connect-or-create its
-- tags (ON CONFLICT(name) keeps the existing row and its id — the injected id is used only
-- for genuinely new tags), link the tags and the owned collections, then return the
-- LightItem shape. An unknown type resolves to zero rows → the item is never inserted → the
-- final SELECT returns no rows (ErrNoRows), which the handler maps to a 500 (parity: a
-- createItem returning null → "Failed to create item.").
WITH resolved_type AS (
    SELECT it0.id FROM item_types it0
    WHERE it0.name = sqlc.arg('item_type_name')
        AND (it0."userId" IS NULL OR it0."userId" = sqlc.arg('owner'))
    ORDER BY (it0."userId" IS NULL) DESC
    LIMIT 1
),
new_item AS (
    INSERT INTO items (
        id, "userId", "itemTypeId", title, "contentType",
        description, content, url, "fileUrl", "fileName", "fileSize",
        "imageWidth", "imageHeight", language, "updatedAt"
    )
    SELECT
        sqlc.arg('id'), sqlc.arg('owner'), rt.id, sqlc.arg('title'), sqlc.arg('content_type'),
        sqlc.narg('description'), sqlc.narg('content'), sqlc.narg('url'),
        sqlc.narg('file_url'), sqlc.narg('file_name'), sqlc.narg('file_size'),
        sqlc.narg('image_width'), sqlc.narg('image_height'), sqlc.narg('language'), now()
    FROM resolved_type rt
    RETURNING *
),
ins_tags AS (
    INSERT INTO tags (id, name)
    SELECT unnest(sqlc.arg('tag_ids')::text[]), unnest(sqlc.arg('tag_names')::text[])
    WHERE EXISTS (SELECT 1 FROM new_item)
    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, name
),
link_tags AS (
    INSERT INTO "_ItemTags" ("A", "B")
    SELECT ni.id, itg.id FROM new_item ni CROSS JOIN ins_tags itg
    ON CONFLICT ("A", "B") DO NOTHING
),
link_cols AS (
    INSERT INTO item_collections ("itemId", "collectionId", "addedAt")
    SELECT ni.id, c.id, now()
    FROM new_item ni
    JOIN collections c ON c.id = ANY(sqlc.arg('collection_ids')::text[]) AND c."userId" = sqlc.arg('owner')
    ON CONFLICT ("itemId", "collectionId") DO NOTHING
)
SELECT
    ni.id,
    ni.title,
    ni."createdAt",
    ni.url,
    ni."fileName",
    ni."fileSize",
    ni."isFavorite",
    ni."isPinned",
    sqlc.arg('item_type_name')::text AS "itemTypeName",
    COALESCE(LEFT(ni.description, 150), '')::text AS "descriptionPreview",
    COALESCE(LEFT(ni.content, 150), '')::text AS "contentPreview",
    COALESCE((SELECT array_agg(name ORDER BY name) FROM ins_tags), '{}'::text[])::text[] AS tags
FROM new_item ni;

-- name: UpdateItem :one
-- PATCH /items/{id}. The handler resolves the final item-type id first (the retyped target,
-- or the item's current type id when the PATCH does not retype), so item_type_id is always
-- supplied. One statement: update the scoped row, reconcile its tag and collection links to
-- the new set, and return the ItemSavedDetails shape. No matching row → zero-row update →
-- ErrNoRows, mapped to 404 by the handler.
--
-- Reconciliation runs in one snapshot, so it cannot delete-then-reinsert the same link (the
-- reinsert wouldn't see the delete and would collide with the still-live PK row). Instead it
-- computes the final link set once (ins_tags resolves names→ids), deletes only links NOT in
-- that set, and inserts the set with ON CONFLICT DO NOTHING — delete and insert touch disjoint
-- (A,B) pairs, so a kept tag/collection is left untouched rather than removed and re-added.
WITH upd AS (
    UPDATE items AS itm SET
        title = sqlc.arg('title'),
        description = sqlc.narg('description'),
        content = sqlc.narg('content'),
        url = sqlc.narg('url'),
        language = sqlc.narg('language'),
        "itemTypeId" = sqlc.arg('item_type_id'),
        "updatedAt" = now()
    WHERE itm.id = sqlc.arg('id') AND itm."userId" = sqlc.arg('owner')
    RETURNING itm.*
),
ins_tags AS (
    INSERT INTO tags (id, name)
    SELECT unnest(sqlc.arg('tag_ids')::text[]), unnest(sqlc.arg('tag_names')::text[])
    WHERE EXISTS (SELECT 1 FROM upd)
    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, name
),
del_tags AS (
    DELETE FROM "_ItemTags"
    WHERE "A" IN (SELECT id FROM upd)
        AND "B" <> ALL(ARRAY(SELECT id FROM ins_tags))
),
del_cols AS (
    DELETE FROM item_collections
    WHERE "itemId" IN (SELECT id FROM upd)
        AND "collectionId" <> ALL(sqlc.arg('collection_ids')::text[])
),
link_tags AS (
    INSERT INTO "_ItemTags" ("A", "B")
    SELECT u.id, itg.id FROM upd u CROSS JOIN ins_tags itg
    ON CONFLICT ("A", "B") DO NOTHING
),
link_cols AS (
    INSERT INTO item_collections ("itemId", "collectionId", "addedAt")
    SELECT u.id, c.id, now()
    FROM upd u
    JOIN collections c ON c.id = ANY(sqlc.arg('collection_ids')::text[]) AND c."userId" = sqlc.arg('owner')
    ON CONFLICT ("itemId", "collectionId") DO NOTHING
)
SELECT
    u.description,
    u."updatedAt",
    u.url,
    u."isFavorite",
    u."isPinned",
    COALESCE((SELECT array_agg(name ORDER BY name) FROM ins_tags), '{}'::text[])::text[] AS tags,
    COALESCE(
        (
            SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.name)
            FROM collections c
            WHERE c.id = ANY(sqlc.arg('collection_ids')::text[]) AND c."userId" = sqlc.arg('owner')
        ),
        '[]'::jsonb
    )::jsonb AS collections
FROM upd u;

-- name: DeleteItem :execrows
-- DELETE /items/{id}. Scoped delete; returns the affected-row count (0 → 404).
DELETE FROM items WHERE id = sqlc.arg('id') AND "userId" = sqlc.arg('owner');

-- name: SetItemFavorite :execrows
-- PATCH /items/{id}/favorite. Scoped update; 0 rows → 404. updatedAt is bumped to match
-- Prisma's @updatedAt (the favorites list orders by updatedAt, so the toggle must move it).
UPDATE items SET "isFavorite" = sqlc.arg('is_favorite'), "updatedAt" = now()
WHERE id = sqlc.arg('id') AND "userId" = sqlc.arg('owner');

-- name: SetItemPinned :execrows
-- PATCH /items/{id}/pinned. Scoped update; 0 rows → 404. updatedAt is bumped to match
-- Prisma's @updatedAt.
UPDATE items SET "isPinned" = sqlc.arg('is_pinned'), "updatedAt" = now()
WHERE id = sqlc.arg('id') AND "userId" = sqlc.arg('owner');

-- name: CountItemsByUser :one
-- Free-tier gate (canCreateItem): the user's total item count.
SELECT COUNT(*)::bigint FROM items WHERE "userId" = sqlc.arg('owner');
