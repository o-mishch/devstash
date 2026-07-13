package items

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// noContent is the empty body for the 204 mutation responses.
type noContent struct{}

// favoriteInput is the PATCH /items/{id}/favorite body.
type favoriteInput struct {
	// ID is declared inline (not via embedded idPath): Huma omits an anonymously
	// embedded path struct from the OpenAPI parameters when the input also has a Body,
	// which left the generated client unable to fill {id}. Runtime binding worked
	// either way; this keeps the emitted spec honest.
	ID string `doc:"Item id" path:"id"`

	Body struct {
		IsFavorite bool `json:"isFavorite" required:"true"`
	}
}

// registerFavorite wires PATCH /items/{id}/favorite. Rate-limited; 0 rows updated → 404.
func registerFavorite(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID:   "set-item-favorite",
		Method:        http.MethodPatch,
		Path:          "/items/{id}/favorite",
		Summary:       "Toggle an item's favorite flag",
		Tags:          []string{tagItems},
		Security:      secured(),
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *favoriteInput) (*noContent, error) {
		userID, _ := middleware.CurrentUserID(ctx)
		if err := s.enforceItemMutation(ctx, userID); err != nil {
			return nil, err
		}

		n, err := s.Store.SetItemFavorite(ctx, sqlcdb.SetItemFavoriteParams{
			IsFavorite: in.Body.IsFavorite, ID: in.ID, Owner: userID,
		})
		if err != nil {
			s.Logger.ErrorContext(ctx, "set item favorite failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		if n == 0 {
			return nil, huma.Error404NotFound(itemNotFoundMessage)
		}
		s.Logger.InfoContext(ctx, "item favorite toggled", "itemID", in.ID, "isFavorite", in.Body.IsFavorite)
		return &noContent{}, nil
	})
}
