package me

import (
	"context"
	"net/http"
	"slices"

	"github.com/danielgtaylor/huma/v2"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// itemTypeCount is the per-type distribution entry (ItemTypeCount wire shape).
type itemTypeCount struct {
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

// statsOutput is the GET /stats response: the dashboard aggregate (mirrors legacy getItemStats +
// getCollectionStats + getItemTypeDistribution).
type statsOutput struct {
	Body struct {
		TotalItems          int64           `json:"totalItems"`
		FavoriteItems       int64           `json:"favoriteItems"`
		TotalCollections    int64           `json:"totalCollections"`
		FavoriteCollections int64           `json:"favoriteCollections"`
		ItemTypeCounts      []itemTypeCount `json:"itemTypeCounts"`
	}
}

// registerStats wires GET /stats — the dashboard totals plus the per-type item distribution. All
// five aggregates are scoped by the session user.
func registerStats(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "get-stats",
		Method:      http.MethodGet,
		Path:        "/stats",
		Summary:     "Get the current user's dashboard stats",
		Tags:        []string{tagMe},
		Security:    secured(),
	}, func(ctx context.Context, _ *struct{}) (*statsOutput, error) {
		userID, _ := middleware.CurrentUserID(ctx)

		totalItems, err := s.Store.CountItemsByUser(ctx, userID)
		if err != nil {
			return nil, s.statsError(ctx, err)
		}
		favoriteItems, err := s.Store.CountFavoriteItemsByUser(ctx, userID)
		if err != nil {
			return nil, s.statsError(ctx, err)
		}
		totalCollections, err := s.Store.CountCollectionsByUser(ctx, userID)
		if err != nil {
			return nil, s.statsError(ctx, err)
		}
		favoriteCollections, err := s.Store.CountFavoriteCollectionsByUser(ctx, userID)
		if err != nil {
			return nil, s.statsError(ctx, err)
		}
		typeRows, err := s.Store.GetItemTypeCountsByUser(ctx, userID)
		if err != nil {
			return nil, s.statsError(ctx, err)
		}

		out := &statsOutput{}
		out.Body.TotalItems = totalItems
		out.Body.FavoriteItems = favoriteItems
		out.Body.TotalCollections = totalCollections
		out.Body.FavoriteCollections = favoriteCollections
		out.Body.ItemTypeCounts = mapTypeCounts(typeRows)
		return out, nil
	})
}

// statsError logs the underlying error and returns the opaque 500.
func (s *Service) statsError(ctx context.Context, err error) error {
	s.Logger.ErrorContext(ctx, "me: stats aggregation failed", "err", err)
	return huma.Error500InternalServerError(genericErrorMessage)
}

// mapTypeCounts converts the sqlc rows to the wire shape, preserving the query's
// SYSTEM_TYPE_ORDER ordering. Always a non-nil slice so the JSON is [] not null.
func mapTypeCounts(rows []sqlcdb.GetItemTypeCountsByUserRow) []itemTypeCount {
	counts := make([]itemTypeCount, 0, len(rows))
	for row := range slices.Values(rows) {
		counts = append(counts, itemTypeCount{Name: row.Name, Count: row.Count})
	}
	return counts
}
