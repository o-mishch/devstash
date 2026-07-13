// Package collections implements the DevStash collections surface as Huma operations: the
// full list, single-collection read, create, update, delete, and the favorite toggle. Files
// are vertical slices — one per operation — mirroring internal/auth's Service/Deps/New
// pattern (embedded Deps, pointer-receiver methods, a narrow consumer-defined CollectionStore
// interface satisfied by the sqlc *Queries). Every query is scoped by the session userId
// (IDOR-safe). Per parity, collection operations carry NO rate-limit bucket.
package collections

import (
	"context"
	"log/slog"
	"slices"
	"time"

	"github.com/danielgtaylor/huma/v2"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// CollectionStore is the collections domain's data interface, satisfied by the sqlc *Queries
// in production and an in-memory fake in tests. Every method is keyed by the session userId
// (IDOR-safe).
type CollectionStore interface {
	ListCollections(ctx context.Context, owner string) ([]sqlcdb.ListCollectionsRow, error)
	GetCollectionByID(ctx context.Context, arg sqlcdb.GetCollectionByIDParams) (sqlcdb.GetCollectionByIDRow, error)
	GetCollectionTypeCounts(
		ctx context.Context,
		arg sqlcdb.GetCollectionTypeCountsParams,
	) ([]sqlcdb.GetCollectionTypeCountsRow, error)
	CountCollectionsByUser(ctx context.Context, owner string) (int64, error)
	CreateCollection(ctx context.Context, arg sqlcdb.CreateCollectionParams) (sqlcdb.CreateCollectionRow, error)
	UpdateCollection(ctx context.Context, arg sqlcdb.UpdateCollectionParams) (int64, error)
	DeleteCollection(ctx context.Context, arg sqlcdb.DeleteCollectionParams) (int64, error)
	SetCollectionFavorite(ctx context.Context, arg sqlcdb.SetCollectionFavoriteParams) (int64, error)
}

// Deps are the collaborators a collections Service is built from.
type Deps struct {
	Store  CollectionStore
	IDs    func() string // new-row id generator (UUIDv7 in production)
	Logger *slog.Logger
}

// Service owns every collection operation's behaviour over its injected collaborators.
type Service struct {
	Deps
}

// New builds a Service from its dependencies.
func New(d Deps) *Service {
	return &Service{Deps: d}
}

const (
	tagCollections          = "collections"
	genericErrorMessage     = "Something went wrong. Please try again."
	collectionNotFoundMsg   = "Collection not found."
	freeTierCollectionLimit = 3
	collectionNameMaxChars  = 100
	collectionDescMaxChars  = 500
)

// isPro resolves the session user's Pro entitlement read-only: isPro AND a Stripe
// subscription id present (parity with resolveProAccessFromRow). During a transient DB blip
// the full user row is absent, so it conservatively returns false.
func isPro(ctx context.Context) bool {
	user, ok := middleware.CurrentUser(ctx)
	return ok && user.IsPro && user.StripeSubscriptionId != nil
}

// Register builds the Service and wires every collection operation onto the API.
func Register(api huma.API, d Deps) {
	s := New(d)
	registerList(api, s)
	registerGet(api, s)
	registerCreate(api, s)
	registerUpdate(api, s)
	registerDelete(api, s)
	registerFavorite(api, s)
}

// secured is the session security requirement every collection operation declares.
func secured() []map[string][]string {
	return []map[string][]string{{middleware.SessionScheme: {}}}
}

// itemType is the ItemType wire shape (the type chips on a collection).
type itemType struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Icon     string `json:"icon"`
	Color    string `json:"color"`
	IsSystem bool   `json:"isSystem"`
}

// collectionWithTypes is the CollectionWithTypes wire shape.
type collectionWithTypes struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	Description   *string    `json:"description"`
	IsFavorite    bool       `json:"isFavorite"`
	CreatedAt     time.Time  `json:"createdAt"`
	ItemCount     int32      `json:"itemCount"`
	DominantColor *string    `json:"dominantColor"`
	Types         []itemType `json:"types"`
}

// mapCollection assembles a CollectionWithTypes from a base row and its (already top-4,
// count-desc) type counts. The dominant color is the first (highest-count) type's color, or
// null when the collection has no items (parity with mapCollectionBase).
func mapCollection(id, name string, description *string, isFavorite bool, createdAt time.Time,
	itemCount int32, typeCounts []sqlcdb.GetCollectionTypeCountsRow,
) collectionWithTypes {
	types := make([]itemType, 0, len(typeCounts))
	for tc := range slices.Values(typeCounts) {
		types = append(types, itemType{
			ID: tc.ID, Name: tc.Name, Icon: tc.Icon, Color: tc.Color, IsSystem: tc.IsSystem,
		})
	}
	var dominant *string
	if len(typeCounts) > 0 {
		color := typeCounts[0].Color
		dominant = &color
	}
	return collectionWithTypes{
		ID: id, Name: name, Description: description, IsFavorite: isFavorite,
		CreatedAt: createdAt, ItemCount: itemCount, DominantColor: dominant, Types: types,
	}
}
