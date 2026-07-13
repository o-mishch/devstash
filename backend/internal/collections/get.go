package collections

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// idPath is the shared {id} path parameter for the single-collection routes.
type idPath struct {
	ID string `doc:"Collection id" path:"id"`
}

type getCollectionOutput struct {
	Body collectionWithTypes
}

// registerGet wires GET /collections/{id}. Absent row → 404.
func registerGet(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "get-collection",
		Method:      http.MethodGet,
		Path:        "/collections/{id}",
		Summary:     "Get a single collection",
		Tags:        []string{tagCollections},
		Security:    secured(),
	}, func(ctx context.Context, in *idPath) (*getCollectionOutput, error) {
		userID, _ := middleware.CurrentUserID(ctx)
		col, err := s.loadCollection(ctx, in.ID, userID)
		if err != nil {
			return nil, err
		}
		return &getCollectionOutput{Body: col}, nil
	})
}

// loadCollection reads a collection by id (scoped) plus its type chips, and maps it to the
// wire shape. Shared by GET /collections/{id} and the re-read after PATCH. Absent row → 404.
func (s *Service) loadCollection(ctx context.Context, id, userID string) (collectionWithTypes, error) {
	row, err := s.Store.GetCollectionByID(ctx, sqlcdb.GetCollectionByIDParams{ID: id, Owner: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return collectionWithTypes{}, huma.Error404NotFound(collectionNotFoundMsg)
		}
		s.Logger.ErrorContext(ctx, "get collection failed", "err", err)
		return collectionWithTypes{}, huma.Error500InternalServerError(genericErrorMessage)
	}
	counts, err := s.Store.GetCollectionTypeCounts(ctx, sqlcdb.GetCollectionTypeCountsParams{
		Owner: userID, CollectionIds: []string{id},
	})
	if err != nil {
		s.Logger.ErrorContext(ctx, "get collection: type counts failed", "err", err)
		return collectionWithTypes{}, huma.Error500InternalServerError(genericErrorMessage)
	}
	return mapCollection(row.ID, row.Name, row.Description, row.IsFavorite, row.CreatedAt, row.ItemCount, counts), nil
}
