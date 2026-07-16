package items

import (
	"context"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/o-mishch/devstash/backend/internal/apitypes"
	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// listItemsInput is the GET /items query. Resolve enforces the discriminated-union rule
// (valid `type`, and the type-specific field required per variant), matching
// fetchItemsQuerySchema, so the handler switch only ever sees a valid shape.
//
// Limit carries no minimum/maximum Huma tag on purpose: those tags reject with a 422, but an
// out-of-range limit must fall back to the page size, not fail the request. clampLimit is the
// bound, and the doc string is how the contract reaches the generated client.
//
// That doc string states the fallback behaviour without naming the page size: a struct tag must
// be a constant expression, so any number written here would be a second copy of itemsPageSize
// that the compiler cannot keep honest — and this string is published, so a stale copy would
// mean the contract lies to every client. Callers do not need the ceiling: exceeding it clamps
// silently rather than erroring, so there is nothing for them to branch on.
type listItemsInput struct {
	Type         string `doc:"Query variant: recent|type|collection|favorites"           query:"type"         required:"true"`
	TypeName     string `doc:"Item type name (required when type=type)"                  query:"typeName"`
	CollectionID string `doc:"Collection id (required when type=collection)"             query:"collectionId"`
	Cursor       string `doc:"Keyset cursor: last id of the previous page"               query:"cursor"`
	Limit        int    `doc:"Max items to return; out of range falls back to page size" query:"limit"`
}

// Resolve validates the query variant: `type` must be one of the four modes, and `type` /
// `collection` require their companion field (parity with fetchItemsQuerySchema).
func (in *listItemsInput) Resolve(_ huma.Context) []error {
	switch in.Type {
	case "recent", "favorites":
		return nil
	case "type":
		if strings.TrimSpace(in.TypeName) == "" {
			return []error{&huma.ErrorDetail{Location: "query.typeName", Message: "Item type is required."}}
		}
	case "collection":
		if strings.TrimSpace(in.CollectionID) == "" {
			return []error{&huma.ErrorDetail{Location: "query.collectionId", Message: "Collection is required."}}
		}
	default:
		return []error{&huma.ErrorDetail{Location: "query.type", Message: "Invalid item query type.", Value: in.Type}}
	}
	return nil
}

// itemsPage is the ItemsPage wire shape — a keyset page of LightItems. Total is the size of
// the whole filtered set, not of Items: a count badge rendered from len(Items) would claim a
// user with 57 favorites has 20. It is present on every page and identical across them.
type itemsPage struct {
	Items      []apitypes.LightItem `doc:"The requested page of items"      json:"items"`
	NextCursor *string              `doc:"Cursor for the next page, if any" json:"nextCursor"`
	HasMore    bool                 `doc:"Whether another page follows"     json:"hasMore"`
	Total      int64                `doc:"Total items matching the filter"  json:"total"`
}

type listItemsOutput struct {
	Body itemsPage
}

// registerList wires GET /items. The four query variants map to the four list store methods;
// each fetches the clamped limit + 1 rows so the handler can detect hasMore, and carries the
// filtered-set total back alongside the page.
func registerList(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "list-items",
		Method:      http.MethodGet,
		Path:        "/items",
		Summary:     "List items (recent, by type, by collection, or favorites)",
		Tags:        []string{tagItems},
		Security:    secured(),
	}, func(ctx context.Context, in *listItemsInput) (*listItemsOutput, error) {
		userID, _ := middleware.CurrentUserID(ctx)
		cursor := cursorPtr(in.Cursor)
		pageSize := clampLimit(in.Limit)
		// Fetch one extra row so the handler can detect hasMore without a second count.
		fetch := pageSize + 1

		var (
			items []apitypes.LightItem
			total int64
			err   error
		)
		// Resolve has already validated the variant, so every case is reachable-safe.
		switch in.Type {
		case "type":
			items, total, err = s.listByType(ctx, userID, in.TypeName, cursor, fetch)
		case "collection":
			items, total, err = s.listByCollection(ctx, userID, in.CollectionID, cursor, fetch)
		case "favorites":
			items, total, err = s.listFavorites(ctx, userID, cursor, fetch)
		default: // "recent"
			items, total, err = s.listRecent(ctx, userID, cursor, fetch)
		}
		if err != nil {
			s.Logger.ErrorContext(ctx, "list items failed", "type", in.Type, "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}

		// int(pageSize) is a widening conversion (int is 64-bit) — never lossy.
		return &listItemsOutput{Body: page(items, total, int(pageSize))}, nil
	})
}

func (s *Service) listRecent(
	ctx context.Context,
	userID string,
	cursor *string,
	limit int32,
) ([]apitypes.LightItem, int64, error) {
	rows, err := s.Store.ListRecentItems(ctx, sqlcdb.ListRecentItemsParams{
		Owner: userID, Cursor: cursor, PageLimit: limit,
	})
	if err != nil {
		return nil, 0, err
	}
	items := apitypes.MapLightRows(rows, func(r sqlcdb.ListRecentItemsRow) apitypes.LightFields {
		return apitypes.LightFields{
			ID: r.ID, Title: r.Title, CreatedAt: r.CreatedAt, URL: r.Url,
			FileName: r.FileName, FileSize: r.FileSize, IsFavorite: r.IsFavorite, IsPinned: r.IsPinned,
			ItemTypeName: r.ItemTypeName, DescriptionPreview: r.DescriptionPreview,
			ContentPreview: r.ContentPreview, Tags: r.Tags,
		}
	})
	return items, totalOf(rows, func(r sqlcdb.ListRecentItemsRow) int64 { return r.Total }), nil
}

func (s *Service) listByType(
	ctx context.Context, userID, typeName string, cursor *string, limit int32,
) ([]apitypes.LightItem, int64, error) {
	rows, err := s.Store.ListItemsByType(ctx, sqlcdb.ListItemsByTypeParams{
		Owner: userID, TypeName: typeName, Cursor: cursor, PageLimit: limit,
	})
	if err != nil {
		return nil, 0, err
	}
	items := apitypes.MapLightRows(rows, func(r sqlcdb.ListItemsByTypeRow) apitypes.LightFields {
		return apitypes.LightFields{
			ID: r.ID, Title: r.Title, CreatedAt: r.CreatedAt, URL: r.Url,
			FileName: r.FileName, FileSize: r.FileSize, IsFavorite: r.IsFavorite, IsPinned: r.IsPinned,
			ItemTypeName: r.ItemTypeName, DescriptionPreview: r.DescriptionPreview,
			ContentPreview: r.ContentPreview, Tags: r.Tags,
		}
	})
	return items, totalOf(rows, func(r sqlcdb.ListItemsByTypeRow) int64 { return r.Total }), nil
}

func (s *Service) listByCollection(
	ctx context.Context, userID, collectionID string, cursor *string, limit int32,
) ([]apitypes.LightItem, int64, error) {
	rows, err := s.Store.ListItemsByCollection(ctx, sqlcdb.ListItemsByCollectionParams{
		Owner: userID, CollectionID: collectionID, Cursor: cursor, PageLimit: limit,
	})
	if err != nil {
		return nil, 0, err
	}
	items := apitypes.MapLightRows(rows, func(r sqlcdb.ListItemsByCollectionRow) apitypes.LightFields {
		return apitypes.LightFields{
			ID: r.ID, Title: r.Title, CreatedAt: r.CreatedAt, URL: r.Url,
			FileName: r.FileName, FileSize: r.FileSize, IsFavorite: r.IsFavorite, IsPinned: r.IsPinned,
			ItemTypeName: r.ItemTypeName, DescriptionPreview: r.DescriptionPreview,
			ContentPreview: r.ContentPreview, Tags: r.Tags,
		}
	})
	return items, totalOf(rows, func(r sqlcdb.ListItemsByCollectionRow) int64 { return r.Total }), nil
}

func (s *Service) listFavorites(
	ctx context.Context,
	userID string,
	cursor *string,
	limit int32,
) ([]apitypes.LightItem, int64, error) {
	rows, err := s.Store.ListFavoriteItems(ctx, sqlcdb.ListFavoriteItemsParams{
		Owner: userID, Cursor: cursor, PageLimit: limit,
	})
	if err != nil {
		return nil, 0, err
	}
	items := apitypes.MapLightRows(rows, func(r sqlcdb.ListFavoriteItemsRow) apitypes.LightFields {
		return apitypes.LightFields{
			ID: r.ID, Title: r.Title, CreatedAt: r.CreatedAt, URL: r.Url,
			FileName: r.FileName, FileSize: r.FileSize, IsFavorite: r.IsFavorite, IsPinned: r.IsPinned,
			ItemTypeName: r.ItemTypeName, DescriptionPreview: r.DescriptionPreview,
			ContentPreview: r.ContentPreview, Tags: r.Tags,
		}
	})
	return items, totalOf(rows, func(r sqlcdb.ListFavoriteItemsRow) int64 { return r.Total }), nil
}

// totalOf reads the filtered-set count off the page's first row. The count rides on every row
// (a CROSS JOINed single-row CTE), so the first is representative.
//
// Zero rows yields 0, which is only AUTHORITATIVE on a cursor-free page: there, no rows really
// does mean the filter matched nothing. On a cursored page zero rows means "nothing at or after
// this cursor", which a non-empty set can also produce (a cursor past the end, or a hand-crafted
// one) — so that 0 would be a lie. Reading total off the first page is what keeps it honest, and
// callers do exactly that; nextCursor is only ever issued when hasMore, so the client cannot
// walk into the lying case on its own.
func totalOf[T any](rows []T, extract func(T) int64) int64 {
	if len(rows) == 0 {
		return 0
	}
	return extract(rows[0])
}

// clampLimit bounds the caller-supplied page limit. A caller may only ask for FEWER items than
// the server page size, never more: an absent (0), zero, negative, or oversized limit all fall
// back to itemsPageSize, so no query can widen the read past what the server budgeted. The
// int32 return is the store's LIMIT type; the conversion is overflow-free because the guard
// above has already bounded limit to [1, itemsPageSize].
func clampLimit(limit int) int32 {
	if limit <= 0 || limit > itemsPageSize {
		return itemsPageSize
	}
	return int32(limit)
}

// page slices the fetched rows (limit+1) down to a page and derives the id-cursor: hasMore is
// set when the extra row was returned, and nextCursor is the last kept item's id. total passes
// through untouched — it describes the whole filtered set, not this slice of it.
func page(items []apitypes.LightItem, total int64, limit int) itemsPage {
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	if items == nil {
		items = []apitypes.LightItem{}
	}
	var next *string
	if hasMore && len(items) > 0 {
		id := items[len(items)-1].ID
		next = &id
	}
	return itemsPage{Items: items, NextCursor: next, HasMore: hasMore, Total: total}
}

// cursorPtr maps an empty cursor query value to nil (the first page).
func cursorPtr(cursor string) *string {
	if cursor == "" {
		return nil
	}
	return &cursor
}
