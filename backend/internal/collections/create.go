package collections

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// createCollectionInput is the POST /collections body (collectionFormSchema). Trim/length
// validation runs in Resolve; the free-tier limit gate stays in the handler.
type createCollectionInput struct {
	Body struct {
		Name        string  `json:"name"                  required:"true"`
		Description *string `json:"description,omitempty"`
	}
}

// Resolve normalizes and validates the create body in place.
func (in *createCollectionInput) Resolve(_ huma.Context) []error {
	var errs []error
	if err := validateName(&in.Body.Name, "body.name"); err != nil {
		errs = append(errs, err)
	}
	if err := normalizeDescription(&in.Body.Description, "body.description"); err != nil {
		errs = append(errs, err)
	}
	return errs
}

type createCollectionOutput struct {
	Body collectionWithTypes
}

// registerCreate wires POST /collections. Enforces the free-tier collection limit, then
// inserts. A fresh collection has no items, so its type chips are empty.
func registerCreate(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID:   "create-collection",
		Method:        http.MethodPost,
		Path:          "/collections",
		Summary:       "Create a collection",
		Tags:          []string{tagCollections},
		Security:      secured(),
		DefaultStatus: http.StatusCreated,
	}, func(ctx context.Context, in *createCollectionInput) (*createCollectionOutput, error) {
		userID, _ := middleware.CurrentUserID(ctx)

		if allowed, err := s.canCreateCollection(ctx, userID); err != nil {
			s.Logger.ErrorContext(ctx, "create collection: count failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		} else if !allowed {
			return nil, huma.Error403Forbidden(
				"You have reached your free tier limit of 3 collections. Please upgrade to Pro.",
			)
		}

		row, err := s.Store.CreateCollection(ctx, sqlcdb.CreateCollectionParams{
			ID:          s.IDs(),
			Name:        in.Body.Name,
			Description: in.Body.Description,
			Owner:       userID,
		})
		if err != nil {
			s.Logger.ErrorContext(ctx, "create collection failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}

		s.Logger.InfoContext(ctx, "collection created", "collectionID", row.ID, "name", row.Name)
		return &createCollectionOutput{Body: mapCollection(
			row.ID, row.Name, row.Description, row.IsFavorite, row.CreatedAt, row.ItemCount, nil,
		)}, nil
	})
}

// canCreateCollection enforces the free-tier collection cap: Pro users are unlimited, others
// are capped at FREE_TIER_COLLECTION_LIMIT (parity with usage.ts canCreateCollection).
func (s *Service) canCreateCollection(ctx context.Context, userID string) (bool, error) {
	if isPro(ctx) {
		return true, nil
	}
	count, err := s.Store.CountCollectionsByUser(ctx, userID)
	if err != nil {
		return false, err
	}
	return count < freeTierCollectionLimit, nil
}
