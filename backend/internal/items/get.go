package items

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"

	"github.com/o-mishch/devstash/backend/internal/apitypes"
	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// idPath is the shared {id} path parameter for the single-item routes.
type idPath struct {
	ID string `doc:"Item id" path:"id"`
}

// fullItem is the FullItem wire shape (LightItem & ItemDetails & ItemContent) returned by
// GET /items/{id} — the whole drawer shape.
type fullItem struct {
	ID                 string                `json:"id"`
	Title              string                `json:"title"`
	CreatedAt          time.Time             `json:"createdAt"`
	ItemType           apitypes.SlimItemType `json:"itemType"`
	DescriptionPreview *string               `json:"descriptionPreview"`
	ContentPreview     *string               `json:"contentPreview"`
	URL                *string               `json:"url"`
	Tags               []string              `json:"tags"`
	FileName           *string               `json:"fileName"`
	FileSize           *int32                `json:"fileSize"`
	IsFavorite         bool                  `json:"isFavorite"`
	IsPinned           bool                  `json:"isPinned"`
	Description        *string               `json:"description"`
	UpdatedAt          time.Time             `json:"updatedAt"`
	Collections        []collectionRef       `json:"collections"`
	Content            *string               `json:"content"`
	Language           *string               `json:"language"`
}

type getItemOutput struct {
	Body fullItem
}

// registerGet wires GET /items/{id} — the single item, IDOR-scoped. Powers the deep-link
// drawer. Absent row → 404.
func registerGet(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "get-item",
		Method:      http.MethodGet,
		Path:        "/items/{id}",
		Summary:     "Get a single item",
		Tags:        []string{tagItems},
		Security:    secured(),
	}, func(ctx context.Context, in *idPath) (*getItemOutput, error) {
		userID, _ := middleware.CurrentUserID(ctx)
		row, err := s.Store.GetItemByID(ctx, sqlcdb.GetItemByIDParams{ID: in.ID, Owner: userID})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, huma.Error404NotFound(itemNotFoundMessage)
			}
			s.Logger.ErrorContext(ctx, "get item failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}

		return &getItemOutput{Body: fullItem{
			ID:                 row.ID,
			Title:              row.Title,
			CreatedAt:          row.CreatedAt,
			ItemType:           apitypes.SlimItemType{Name: row.ItemTypeName},
			DescriptionPreview: previewOf(row.Description),
			ContentPreview:     previewOf(row.Content),
			URL:                row.Url,
			Tags:               apitypes.DefaultTags(row.Tags),
			FileName:           row.FileName,
			FileSize:           row.FileSize,
			IsFavorite:         row.IsFavorite,
			IsPinned:           row.IsPinned,
			Description:        row.Description,
			UpdatedAt:          row.UpdatedAt,
			Collections:        decodeCollections(ctx, s, row.Collections),
			Content:            row.Content,
			Language:           row.Language,
		}}, nil
	})
}

// previewLen is the 150-character text-preview length (parity with toFullItem's slice(0,150)).
const previewLen = 150

// previewOf builds a LightItem preview from a full text field: the first 150 characters, or
// null when the field is null (matches item.description ? description.slice(0,150) : null).
func previewOf(full *string) *string {
	if full == nil {
		return nil
	}
	runes := []rune(*full)
	if len(runes) > previewLen {
		runes = runes[:previewLen]
	}
	p := string(runes)
	return &p
}

// decodeCollections unmarshals the jsonb collections aggregate into the {id,name} pairs,
// guaranteeing a non-nil slice. A malformed blob is logged and treated as empty rather than
// failing the read.
func decodeCollections(ctx context.Context, s *Service, raw []byte) []collectionRef {
	if len(raw) == 0 {
		return []collectionRef{}
	}
	var cols []collectionRef
	if err := json.Unmarshal(raw, &cols); err != nil {
		s.Logger.ErrorContext(ctx, "decode item collections failed", "err", err)
		return []collectionRef{}
	}
	if cols == nil {
		return []collectionRef{}
	}
	return cols
}
