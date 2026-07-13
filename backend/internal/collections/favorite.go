package collections

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// favoriteInput is the PATCH /collections/{id}/favorite body.
type favoriteInput struct {
	// ID inlined (not embedded idPath): Huma drops an anonymously embedded path struct
	// from the OpenAPI params when the input also has a Body. See items/favorite.go.
	ID string `doc:"Collection id" path:"id"`

	Body struct {
		IsFavorite bool `json:"isFavorite" required:"true"`
	}
}

// registerFavorite wires PATCH /collections/{id}/favorite. 0 rows updated → 404.
func registerFavorite(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID:   "set-collection-favorite",
		Method:        http.MethodPatch,
		Path:          "/collections/{id}/favorite",
		Summary:       "Toggle a collection's favorite flag",
		Tags:          []string{tagCollections},
		Security:      secured(),
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *favoriteInput) (*noContent, error) {
		userID, _ := middleware.CurrentUserID(ctx)
		n, err := s.Store.SetCollectionFavorite(ctx, sqlcdb.SetCollectionFavoriteParams{
			IsFavorite: in.Body.IsFavorite, ID: in.ID, Owner: userID,
		})
		if err != nil {
			s.Logger.ErrorContext(ctx, "set collection favorite failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		if n == 0 {
			return nil, huma.Error404NotFound(collectionNotFoundMsg)
		}
		s.Logger.InfoContext(
			ctx,
			"collection favorite toggled",
			"collectionID",
			in.ID,
			"isFavorite",
			in.Body.IsFavorite,
		)
		return &noContent{}, nil
	})
}
