package items

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// registerDelete wires DELETE /items/{id}. Rate-limited; the scoped delete returns 404 when
// no row matches. File-blob cleanup (deleteStoredFile) is Phase 3 (S3) and not done here.
func registerDelete(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID:   "delete-item",
		Method:        http.MethodDelete,
		Path:          "/items/{id}",
		Summary:       "Delete an item",
		Tags:          []string{tagItems},
		Security:      secured(),
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *idPath) (*noContent, error) {
		userID, _ := middleware.CurrentUserID(ctx)
		if err := s.enforceItemMutation(ctx, userID); err != nil {
			return nil, err
		}

		n, err := s.Store.DeleteItem(ctx, sqlcdb.DeleteItemParams{ID: in.ID, Owner: userID})
		if err != nil {
			s.Logger.ErrorContext(ctx, "delete item failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		if n == 0 {
			return nil, huma.Error404NotFound(itemNotFoundMessage)
		}
		s.Logger.InfoContext(ctx, "item deleted", "itemID", in.ID)
		return &noContent{}, nil
	})
}
