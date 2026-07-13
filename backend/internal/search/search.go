// Package search implements the DevStash global search as a single Huma operation
// (GET /search), returning matching items (LightItem) and collections (SidebarCollection).
// It is uncached and scoped by the session userId, mirroring globalSearch. The structural
// template matches internal/auth/internal/items: injected Deps on an unexported-field
// *Service, a narrow consumer-defined Store satisfied by the sqlc *Queries. Per parity,
// search carries no rate-limit bucket.
package search

import (
	"context"
	"log/slog"
	"net/http"
	"slices"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/o-mishch/devstash/backend/internal/apitypes"
	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// Store is the search domain's data interface, satisfied by the sqlc *Queries in
// production and an in-memory fake in tests. Both reads are scoped by the session userId.
type Store interface {
	SearchItems(ctx context.Context, arg sqlcdb.SearchItemsParams) ([]sqlcdb.SearchItemsRow, error)
	SearchCollections(ctx context.Context, arg sqlcdb.SearchCollectionsParams) ([]sqlcdb.SearchCollectionsRow, error)
}

// Deps are the collaborators a search Service is built from.
type Deps struct {
	Store  Store
	Logger *slog.Logger
}

// Service owns the search operation's behaviour over its injected collaborators.
type Service struct {
	Deps
}

// New builds a Service from its dependencies.
func New(d Deps) *Service {
	return &Service{Deps: d}
}

const (
	tagSearch           = "search"
	genericErrorMessage = "Something went wrong. Please try again."
)

// Register builds the Service and wires GET /search onto the API.
func Register(api huma.API, d Deps) {
	s := New(d)
	registerSearch(api, s)
}

// sidebarCollection is the SidebarCollection wire shape (no type chips, no dates).
type sidebarCollection struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Description   *string `json:"description"`
	IsFavorite    bool    `json:"isFavorite"`
	ItemCount     int32   `json:"itemCount"`
	DominantColor *string `json:"dominantColor"`
}

// searchResult is the SearchResult wire shape.
type searchResult struct {
	Items       []apitypes.LightItem `json:"items"`
	Collections []sidebarCollection  `json:"collections"`
}

// searchInput is the GET /search query. q is trimmed + presence-checked in Resolve (parity
// with searchQueryParam: z.string().trim().min(1)).
type searchInput struct {
	Q string `doc:"Search query" minLength:"1" query:"q" required:"true"`
}

// Resolve trims q and rejects an empty result.
func (in *searchInput) Resolve(_ huma.Context) []error {
	in.Q = strings.TrimSpace(in.Q)
	if in.Q == "" {
		return []error{&huma.ErrorDetail{Location: "query.q", Message: "Search query is required"}}
	}
	return nil
}

type searchOutput struct {
	Body searchResult
}

// registerSearch wires GET /search. Item hits are capped at 20, collection hits at 10; the
// two reads run against the same pg_trgm-indexed columns via ILIKE.
func registerSearch(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "global-search",
		Method:      http.MethodGet,
		Path:        "/search",
		Summary:     "Search items and collections",
		Tags:        []string{tagSearch},
		Security:    []map[string][]string{{middleware.SessionScheme: {}}},
	}, func(ctx context.Context, in *searchInput) (*searchOutput, error) {
		userID, _ := middleware.CurrentUserID(ctx)
		pattern := likePattern(in.Q)

		itemRows, err := s.Store.SearchItems(ctx, sqlcdb.SearchItemsParams{Owner: userID, Pattern: pattern})
		if err != nil {
			s.Logger.ErrorContext(ctx, "search items failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		colRows, err := s.Store.SearchCollections(ctx, sqlcdb.SearchCollectionsParams{Owner: userID, Pattern: pattern})
		if err != nil {
			s.Logger.ErrorContext(ctx, "search collections failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}

		out := searchResult{
			Items: apitypes.MapLightRows(itemRows, func(r sqlcdb.SearchItemsRow) apitypes.LightFields {
				return apitypes.LightFields{
					ID: r.ID, Title: r.Title, CreatedAt: r.CreatedAt, URL: r.Url,
					FileName: r.FileName, FileSize: r.FileSize, IsFavorite: r.IsFavorite, IsPinned: r.IsPinned,
					ItemTypeName: r.ItemTypeName, DescriptionPreview: r.DescriptionPreview,
					ContentPreview: r.ContentPreview, Tags: r.Tags,
				}
			}),
			Collections: make([]sidebarCollection, 0, len(colRows)),
		}
		for r := range slices.Values(colRows) {
			out.Collections = append(out.Collections, sidebarCollection{
				ID: r.ID, Name: r.Name, Description: r.Description, IsFavorite: r.IsFavorite,
				ItemCount: r.ItemCount, DominantColor: nil,
			})
		}
		s.Logger.InfoContext(ctx, "global search", "items", len(out.Items), "collections", len(out.Collections))
		return &searchOutput{Body: out}, nil
	})
}

// likePattern wraps the query as an ILIKE substring pattern, escaping the LIKE metacharacters
// (\ % _) first so a user's literal '%'/'_' matches literally — reproducing Prisma's
// `contains` (literal substring) rather than allowing wildcard injection.
func likePattern(q string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + replacer.Replace(q) + "%"
}
