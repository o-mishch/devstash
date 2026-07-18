/**
 * Free-plan item cap. Mirrors the Go backend's `freeTierItemLimit`
 * (backend/internal/items/constants.go) — a per-stack copy kept in sync by value, per
 * `.agents/rules/boundary.md`. Drives the dashboard/settings usage bars and slot counts.
 */
export const FREE_TIER_ITEM_LIMIT = 50

/**
 * Free-plan collection cap. Mirrors the Go backend's `freeTierCollectionLimit`
 * (backend/internal/collections/collections.go) — a per-stack copy kept in sync by value, per
 * `.agents/rules/boundary.md`. Drives the dashboard/settings usage bars and the pricing table.
 */
export const FREE_TIER_COLLECTION_LIMIT = 3
