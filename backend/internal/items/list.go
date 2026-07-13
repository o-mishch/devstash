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
type listItemsInput struct {
	Type         string `query:"type"         required:"true"`
	TypeName     string `query:"typeName"`
	CollectionID string `query:"collectionId"`
	Cursor       string `query:"cursor"`
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

// itemsPage is the ItemsPage wire shape — a keyset page of LightItems.
type itemsPage struct {
	Items      []apitypes.LightItem `json:"items"`
	NextCursor *string              `json:"nextCursor"`
	HasMore    bool                 `json:"hasMore"`
}

type listItemsOutput struct {
	Body itemsPage
}

// registerList wires GET /items. The four query variants map to the four list store
// methods; each fetches PAGE_SIZE+1 rows so the handler can detect hasMore.
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
		limit := int32(itemsPageSize + 1)

		var (
			items []apitypes.LightItem
			err   error
		)
		// Resolve has already validated the variant, so every case is reachable-safe.
		switch in.Type {
		case "type":
			items, err = s.listByType(ctx, userID, in.TypeName, cursor, limit)
		case "collection":
			items, err = s.listByCollection(ctx, userID, in.CollectionID, cursor, limit)
		case "favorites":
			items, err = s.listFavorites(ctx, userID, cursor, limit)
		default: // "recent"
			items, err = s.listRecent(ctx, userID, cursor, limit)
		}
		if err != nil {
			s.Logger.ErrorContext(ctx, "list items failed", "type", in.Type, "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}

		return &listItemsOutput{Body: page(items)}, nil
	})
}

func (s *Service) listRecent(
	ctx context.Context,
	userID string,
	cursor *string,
	limit int32,
) ([]apitypes.LightItem, error) {
	rows, err := s.Store.ListRecentItems(ctx, sqlcdb.ListRecentItemsParams{
		Owner: userID, Cursor: cursor, PageLimit: limit,
	})
	if err != nil {
		return nil, err
	}
	return apitypes.MapLightRows(rows, func(r sqlcdb.ListRecentItemsRow) apitypes.LightFields {
		return apitypes.LightFields{
			ID: r.ID, Title: r.Title, CreatedAt: r.CreatedAt, URL: r.Url,
			FileName: r.FileName, FileSize: r.FileSize, IsFavorite: r.IsFavorite, IsPinned: r.IsPinned,
			ItemTypeName: r.ItemTypeName, DescriptionPreview: r.DescriptionPreview,
			ContentPreview: r.ContentPreview, Tags: r.Tags,
		}
	}), nil
}

func (s *Service) listByType(
	ctx context.Context, userID, typeName string, cursor *string, limit int32,
) ([]apitypes.LightItem, error) {
	rows, err := s.Store.ListItemsByType(ctx, sqlcdb.ListItemsByTypeParams{
		Owner: userID, TypeName: typeName, Cursor: cursor, PageLimit: limit,
	})
	if err != nil {
		return nil, err
	}
	return apitypes.MapLightRows(rows, func(r sqlcdb.ListItemsByTypeRow) apitypes.LightFields {
		return apitypes.LightFields{
			ID: r.ID, Title: r.Title, CreatedAt: r.CreatedAt, URL: r.Url,
			FileName: r.FileName, FileSize: r.FileSize, IsFavorite: r.IsFavorite, IsPinned: r.IsPinned,
			ItemTypeName: r.ItemTypeName, DescriptionPreview: r.DescriptionPreview,
			ContentPreview: r.ContentPreview, Tags: r.Tags,
		}
	}), nil
}

func (s *Service) listByCollection(
	ctx context.Context, userID, collectionID string, cursor *string, limit int32,
) ([]apitypes.LightItem, error) {
	rows, err := s.Store.ListItemsByCollection(ctx, sqlcdb.ListItemsByCollectionParams{
		Owner: userID, CollectionID: collectionID, Cursor: cursor, PageLimit: limit,
	})
	if err != nil {
		return nil, err
	}
	return apitypes.MapLightRows(rows, func(r sqlcdb.ListItemsByCollectionRow) apitypes.LightFields {
		return apitypes.LightFields{
			ID: r.ID, Title: r.Title, CreatedAt: r.CreatedAt, URL: r.Url,
			FileName: r.FileName, FileSize: r.FileSize, IsFavorite: r.IsFavorite, IsPinned: r.IsPinned,
			ItemTypeName: r.ItemTypeName, DescriptionPreview: r.DescriptionPreview,
			ContentPreview: r.ContentPreview, Tags: r.Tags,
		}
	}), nil
}

func (s *Service) listFavorites(
	ctx context.Context,
	userID string,
	cursor *string,
	limit int32,
) ([]apitypes.LightItem, error) {
	rows, err := s.Store.ListFavoriteItems(ctx, sqlcdb.ListFavoriteItemsParams{
		Owner: userID, Cursor: cursor, PageLimit: limit,
	})
	if err != nil {
		return nil, err
	}
	return apitypes.MapLightRows(rows, func(r sqlcdb.ListFavoriteItemsRow) apitypes.LightFields {
		return apitypes.LightFields{
			ID: r.ID, Title: r.Title, CreatedAt: r.CreatedAt, URL: r.Url,
			FileName: r.FileName, FileSize: r.FileSize, IsFavorite: r.IsFavorite, IsPinned: r.IsPinned,
			ItemTypeName: r.ItemTypeName, DescriptionPreview: r.DescriptionPreview,
			ContentPreview: r.ContentPreview, Tags: r.Tags,
		}
	}), nil
}

// page slices the fetched rows (PAGE_SIZE+1) down to a page and derives the id-cursor:
// hasMore is set when the extra row was returned, and nextCursor is the last kept item's id.
func page(items []apitypes.LightItem) itemsPage {
	hasMore := len(items) > itemsPageSize
	if hasMore {
		items = items[:itemsPageSize]
	}
	if items == nil {
		items = []apitypes.LightItem{}
	}
	var next *string
	if hasMore && len(items) > 0 {
		id := items[len(items)-1].ID
		next = &id
	}
	return itemsPage{Items: items, NextCursor: next, HasMore: hasMore}
}

// cursorPtr maps an empty cursor query value to nil (the first page).
func cursorPtr(cursor string) *string {
	if cursor == "" {
		return nil
	}
	return &cursor
}
