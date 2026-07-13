package items

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// pinnedInput is the PATCH /items/{id}/pinned body.
type pinnedInput struct {
	// ID inlined (not embedded idPath): Huma drops an anonymously embedded path struct
	// from the OpenAPI params when the input also has a Body. See items/favorite.go.
	ID string `doc:"Item id" path:"id"`

	Body struct {
		IsPinned bool `json:"isPinned" required:"true"`
	}
}

// registerPinned wires PATCH /items/{id}/pinned. Rate-limited; 0 rows updated → 404.
func registerPinned(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID:   "set-item-pinned",
		Method:        http.MethodPatch,
		Path:          "/items/{id}/pinned",
		Summary:       "Toggle an item's pinned flag",
		Tags:          []string{tagItems},
		Security:      secured(),
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *pinnedInput) (*noContent, error) {
		userID, _ := middleware.CurrentUserID(ctx)
		if err := s.enforceItemMutation(ctx, userID); err != nil {
			return nil, err
		}

		n, err := s.Store.SetItemPinned(ctx, sqlcdb.SetItemPinnedParams{
			IsPinned: in.Body.IsPinned, ID: in.ID, Owner: userID,
		})
		if err != nil {
			s.Logger.ErrorContext(ctx, "set item pinned failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		if n == 0 {
			return nil, huma.Error404NotFound(itemNotFoundMessage)
		}
		s.Logger.InfoContext(ctx, "item pinned toggled", "itemID", in.ID, "isPinned", in.Body.IsPinned)
		return &noContent{}, nil
	})
}
