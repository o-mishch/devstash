package collections

import (
	"context"
	"net/http"
	"slices"

	"github.com/danielgtaylor/huma/v2"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

type listCollectionsOutput struct {
	Body []collectionWithTypes
}

// registerList wires GET /collections (getAllCollections): every collection with its top-4
// type chips, favorites first then most-recently-updated.
func registerList(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "list-collections",
		Method:      http.MethodGet,
		Path:        "/collections",
		Summary:     "List all collections",
		Tags:        []string{tagCollections},
		Security:    secured(),
	}, func(ctx context.Context, _ *struct{}) (*listCollectionsOutput, error) {
		userID, _ := middleware.CurrentUserID(ctx)
		rows, err := s.Store.ListCollections(ctx, userID)
		if err != nil {
			s.Logger.ErrorContext(ctx, "list collections failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		if len(rows) == 0 {
			return &listCollectionsOutput{Body: []collectionWithTypes{}}, nil
		}

		ids := make([]string, 0, len(rows))
		for r := range slices.Values(rows) {
			ids = append(ids, r.ID)
		}
		counts, err := s.Store.GetCollectionTypeCounts(ctx, sqlcdb.GetCollectionTypeCountsParams{
			Owner: userID, CollectionIds: ids,
		})
		if err != nil {
			s.Logger.ErrorContext(ctx, "list collections: type counts failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		byCollection := groupTypeCounts(counts)

		out := make([]collectionWithTypes, 0, len(rows))
		for r := range slices.Values(rows) {
			out = append(out, mapCollection(
				r.ID, r.Name, r.Description, r.IsFavorite, r.CreatedAt, r.ItemCount, byCollection[r.ID],
			))
		}
		return &listCollectionsOutput{Body: out}, nil
	})
}

// groupTypeCounts buckets the flat top-4 type-count rows by collection id, preserving the
// query's count-desc order within each collection.
func groupTypeCounts(counts []sqlcdb.GetCollectionTypeCountsRow) map[string][]sqlcdb.GetCollectionTypeCountsRow {
	byCollection := make(map[string][]sqlcdb.GetCollectionTypeCountsRow)
	for tc := range slices.Values(counts) {
		byCollection[tc.CollectionId] = append(byCollection[tc.CollectionId], tc)
	}
	return byCollection
}
