-- Queries for the `me` domain: the authenticated user's own preferences, profile,
-- account deletion, and dashboard stats. Every query is scoped by the session userId
-- (IDOR-safe) — the id/owner argument is always the caller's own identity, resolved from
-- the session, never from user input.

-- name: GetEditorPreferences :one
-- GET /me/preferences source blob. The raw JSONB is normalized (defaults + clamp) in the
-- handler; a NULL column yields a nil slice, which normalizes to the defaults.
SELECT "editorPreferences" FROM users WHERE id = sqlc.arg('id');

-- name: UpdateEditorPreferences :execrows
-- PATCH /me/preferences write-back. The handler merges the partial patch onto the current
-- normalized prefs and re-normalizes before writing, so the stored blob is always valid.
UPDATE users
SET "editorPreferences" = sqlc.arg('editor_preferences'), "updatedAt" = now()
WHERE id = sqlc.arg('id');

-- name: UpdateUserName :one
-- PATCH /me/profile. Sets the display name (NULL clears it). Scoped to the session user;
-- returns the updated name + image for the response.
UPDATE users SET name = sqlc.narg('name'), "updatedAt" = now()
WHERE id = sqlc.arg('id')
RETURNING name, image;

-- name: DeleteUser :execrows
-- DELETE /me. Every inbound FK to users is ON DELETE CASCADE (accounts, sessions, items,
-- item_types, collections, ai_parse_jobs, …), so a single scoped delete removes the whole
-- account graph — no child deletes needed.
DELETE FROM users WHERE id = sqlc.arg('id');

-- name: CountFavoriteItemsByUser :one
-- Dashboard stat: the user's favorited item count.
SELECT COUNT(*)::bigint FROM items WHERE "userId" = sqlc.arg('owner') AND "isFavorite" = true;

-- name: CountFavoriteCollectionsByUser :one
-- Dashboard stat: the user's favorited collection count.
SELECT COUNT(*)::bigint FROM collections WHERE "userId" = sqlc.arg('owner') AND "isFavorite" = true;

-- name: GetItemTypeCountsByUser :many
-- Dashboard per-type distribution: every system item type with the user's item count for it
-- (0 when none), ordered by SYSTEM_TYPE_ORDER (mirrors src/lib/utils/constants.ts) so the
-- result is stable and matches the legacy getItemTypeDistribution ordering.
SELECT it.name AS name, COUNT(i.id)::bigint AS count
FROM item_types it
LEFT JOIN items i ON i."itemTypeId" = it.id AND i."userId" = sqlc.arg('owner')
WHERE it."isSystem" = true AND it."userId" IS NULL
GROUP BY it.id, it.name
ORDER BY
    CASE it.name
        WHEN 'snippet' THEN 1
        WHEN 'prompt'  THEN 2
        WHEN 'command' THEN 3
        WHEN 'note'    THEN 4
        WHEN 'file'    THEN 5
        WHEN 'image'   THEN 6
        WHEN 'link'    THEN 7
        ELSE 8
    END;
