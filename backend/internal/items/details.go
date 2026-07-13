package items

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// itemDetails is the ItemDetails wire shape (only the fields LightItem doesn't carry),
// fetched on drawer open.
type itemDetails struct {
	Description *string         `json:"description"`
	UpdatedAt   time.Time       `json:"updatedAt"`
	Collections []collectionRef `json:"collections"`
}

type getDetailsOutput struct {
	Body itemDetails
}

// registerDetails wires GET /items/{id}/details. Absent row → 404.
func registerDetails(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "get-item-details",
		Method:      http.MethodGet,
		Path:        "/items/{id}/details",
		Summary:     "Get an item's details",
		Tags:        []string{tagItems},
		Security:    secured(),
	}, func(ctx context.Context, in *idPath) (*getDetailsOutput, error) {
		userID, _ := middleware.CurrentUserID(ctx)
		row, err := s.Store.GetItemDetails(ctx, sqlcdb.GetItemDetailsParams{ID: in.ID, Owner: userID})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, huma.Error404NotFound(itemNotFoundMessage)
			}
			s.Logger.ErrorContext(ctx, "get item details failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}

		return &getDetailsOutput{Body: itemDetails{
			Description: row.Description,
			UpdatedAt:   row.UpdatedAt,
			Collections: decodeCollections(ctx, s, row.Collections),
		}}, nil
	})
}
