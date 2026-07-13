package collections

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// updateCollectionInput is the PATCH /collections/{id} body (collectionFormSchema.partial() +
// isFavorite). Every field is optional; an omitted field is left unchanged.
//
// Description presence: a plain *string can't distinguish an absent key from an explicit null.
// The two real client shapes are the edit dialog ({name, description}) and the favorite toggle
// ({isFavorite}) — description only ever travels alongside name — so a present Name marks a
// description-bearing edit (descriptionSet), letting an edit clear description to null without
// the favorite-only PATCH wiping it.
type updateCollectionInput struct {
	idPath

	Body struct {
		Name        *string `json:"name,omitempty"`
		Description *string `json:"description,omitempty"`
		IsFavorite  *bool   `json:"isFavorite,omitempty"`
	}
}

// Resolve validates the provided fields in place.
func (in *updateCollectionInput) Resolve(_ huma.Context) []error {
	var errs []error
	if in.Body.Name != nil {
		if err := validateName(in.Body.Name, "body.name"); err != nil {
			errs = append(errs, err)
		}
	}
	if err := normalizeDescription(&in.Body.Description, "body.description"); err != nil {
		errs = append(errs, err)
	}
	return errs
}

type updateCollectionOutput struct {
	Body collectionWithTypes
}

// registerUpdate wires PATCH /collections/{id}. The scoped update returns 404 when no row
// matches; on success the collection is re-read (with its type chips) and returned.
func registerUpdate(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "update-collection",
		Method:      http.MethodPatch,
		Path:        "/collections/{id}",
		Summary:     "Update a collection",
		Tags:        []string{tagCollections},
		Security:    secured(),
	}, func(ctx context.Context, in *updateCollectionInput) (*updateCollectionOutput, error) {
		userID, _ := middleware.CurrentUserID(ctx)

		n, err := s.Store.UpdateCollection(ctx, sqlcdb.UpdateCollectionParams{
			Name:           in.Body.Name,
			DescriptionSet: in.Body.Name != nil,
			Description:    in.Body.Description,
			IsFavorite:     in.Body.IsFavorite,
			ID:             in.ID,
			Owner:          userID,
		})
		if err != nil {
			s.Logger.ErrorContext(ctx, "update collection failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		if n == 0 {
			return nil, huma.Error404NotFound(collectionNotFoundMsg)
		}

		col, err := s.loadCollection(ctx, in.ID, userID)
		if err != nil {
			return nil, err
		}
		s.Logger.InfoContext(ctx, "collection updated", "collectionID", in.ID)
		return &updateCollectionOutput{Body: col}, nil
	})
}
