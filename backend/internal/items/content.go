package items

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// itemContent is the ItemContent wire shape, fetched separately for content-bearing types.
type itemContent struct {
	Content  *string `json:"content"`
	Language *string `json:"language"`
}

type getContentOutput struct {
	Body itemContent
}

// registerContent wires GET /items/{id}/content. Absent row → 404.
func registerContent(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "get-item-content",
		Method:      http.MethodGet,
		Path:        "/items/{id}/content",
		Summary:     "Get an item's content",
		Tags:        []string{tagItems},
		Security:    secured(),
	}, func(ctx context.Context, in *idPath) (*getContentOutput, error) {
		userID, _ := middleware.CurrentUserID(ctx)
		row, err := s.Store.GetItemContent(ctx, sqlcdb.GetItemContentParams{ID: in.ID, Owner: userID})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, huma.Error404NotFound(itemNotFoundMessage)
			}
			s.Logger.ErrorContext(ctx, "get item content failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}

		return &getContentOutput{Body: itemContent{Content: row.Content, Language: row.Language}}, nil
	})
}
