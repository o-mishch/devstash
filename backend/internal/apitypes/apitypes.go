// Package apitypes holds the wire DTOs shared across more than one domain package, so each
// emits a single OpenAPI schema component (Huma keys components by the Go type's base name,
// so the same shape defined in two packages would collide). These mirror the Next app's
// shared Zod schemas that carry a `.meta({ id })` — LightItem is reused by the item list, the
// create response, and search (search.ts imports it from items.ts), so it lives here rather
// than in any one domain.
package apitypes

import (
	"slices"
	"time"
)

// SlimItemType is the SlimItemType wire shape (name only; icon/color resolved client-side).
type SlimItemType struct {
	Name string `json:"name"`
}

// LightItem is the LightItem wire shape shared by the item list/create responses and search.
type LightItem struct {
	ID                 string       `json:"id"`
	Title              string       `json:"title"`
	CreatedAt          time.Time    `json:"createdAt"`
	ItemType           SlimItemType `json:"itemType"`
	DescriptionPreview *string      `json:"descriptionPreview"`
	ContentPreview     *string      `json:"contentPreview"`
	URL                *string      `json:"url"`
	Tags               []string     `json:"tags"`
	FileName           *string      `json:"fileName"`
	FileSize           *int32       `json:"fileSize"`
	IsFavorite         bool         `json:"isFavorite"`
	IsPinned           bool         `json:"isPinned"`
}

// LightFields is the common column set every LightItem-shaped sqlc row carries. Each query's
// row is a distinct Go struct (ListRecentItemsRow, SearchItemsRow, …) with identical fields;
// the per-query extractors normalize into this before NewLightItem maps it, so the empty→null
// and tag-default rules live in exactly one place across the items and search packages.
type LightFields struct {
	ID                 string
	Title              string
	CreatedAt          time.Time
	URL                *string
	FileName           *string
	FileSize           *int32
	IsFavorite         bool
	IsPinned           bool
	ItemTypeName       string
	DescriptionPreview string
	ContentPreview     string
	Tags               []string
}

// NewLightItem maps the normalized columns to the wire shape. Previews are stored null-or-
// nonempty (the validators coerce ""→null on write), so the SQL COALESCE(...,”) sentinel maps
// back to null here without conflating a real value with a cleared one.
func NewLightItem(f LightFields) LightItem {
	return LightItem{
		ID:                 f.ID,
		Title:              f.Title,
		CreatedAt:          f.CreatedAt,
		ItemType:           SlimItemType{Name: f.ItemTypeName},
		DescriptionPreview: EmptyToNil(f.DescriptionPreview),
		ContentPreview:     EmptyToNil(f.ContentPreview),
		URL:                f.URL,
		Tags:               DefaultTags(f.Tags),
		FileName:           f.FileName,
		FileSize:           f.FileSize,
		IsFavorite:         f.IsFavorite,
		IsPinned:           f.IsPinned,
	}
}

// MapLightRows maps a slice of a query's rows to LightItems via a per-row field extractor,
// removing the four structurally-identical list converters (one per keyset variant) that only
// differed by the distinctly-typed sqlc row.
func MapLightRows[T any](rows []T, extract func(T) LightFields) []LightItem {
	out := make([]LightItem, 0, len(rows))
	for row := range slices.Values(rows) {
		out = append(out, NewLightItem(extract(row)))
	}
	return out
}

// EmptyToNil maps the COALESCE(...,”) preview sentinel back to a null pointer.
func EmptyToNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// DefaultTags guarantees a non-nil slice so the JSON encodes [] rather than null (parity with
// the TS tags default of []). sqlc already COALESCEs to an empty array, so this is a
// belt-and-braces guard for the in-memory fakes too.
func DefaultTags(tags []string) []string {
	if tags == nil {
		return []string{}
	}
	return tags
}
