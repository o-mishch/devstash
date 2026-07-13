package collections

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// noContent is the empty body for the 204 responses.
type noContent struct{}

// registerDelete wires DELETE /collections/{id}. The scoped delete returns 404 when no row
// matches; item_collections rows cascade.
func registerDelete(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID:   "delete-collection",
		Method:        http.MethodDelete,
		Path:          "/collections/{id}",
		Summary:       "Delete a collection",
		Tags:          []string{tagCollections},
		Security:      secured(),
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *idPath) (*noContent, error) {
		userID, _ := middleware.CurrentUserID(ctx)
		n, err := s.Store.DeleteCollection(ctx, sqlcdb.DeleteCollectionParams{ID: in.ID, Owner: userID})
		if err != nil {
			s.Logger.ErrorContext(ctx, "delete collection failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		if n == 0 {
			return nil, huma.Error404NotFound(collectionNotFoundMsg)
		}
		s.Logger.InfoContext(ctx, "collection deleted", "collectionID", in.ID)
		return &noContent{}, nil
	})
}
