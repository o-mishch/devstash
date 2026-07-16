// Package me implements the DevStash "current user" surface as Huma operations: read/update
// editor preferences, update the display profile, delete the account, and the dashboard stats
// aggregate. Files are vertical slices — one per operation — mirroring internal/collections'
// Service/Deps/New pattern (embedded Deps, pointer-receiver methods, a narrow consumer-defined
// Store interface satisfied by the sqlc *Queries). Every query is scoped by the session
// userId (IDOR-safe): the caller's identity always comes from middleware.CurrentUserID(ctx),
// never from the request body, query, or path.
package me

import (
	"context"
	"log/slog"

	"github.com/danielgtaylor/huma/v2"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// Store is the me domain's data interface, satisfied by the sqlc *Queries in production and
// an in-memory fake in tests. Every method is keyed by the session userId (IDOR-safe).
type Store interface {
	GetEditorPreferences(ctx context.Context, id string) ([]byte, error)
	UpdateEditorPreferences(ctx context.Context, arg sqlcdb.UpdateEditorPreferencesParams) (int64, error)
	UpdateUserName(ctx context.Context, arg sqlcdb.UpdateUserNameParams) (sqlcdb.UpdateUserNameRow, error)
	DeleteUser(ctx context.Context, id string) (int64, error)
	CountItemsByUser(ctx context.Context, owner string) (int64, error)
	CountFavoriteItemsByUser(ctx context.Context, owner string) (int64, error)
	CountCollectionsByUser(ctx context.Context, owner string) (int64, error)
	CountFavoriteCollectionsByUser(ctx context.Context, owner string) (int64, error)
	GetItemTypeCountsByUser(ctx context.Context, owner string) ([]sqlcdb.GetItemTypeCountsByUserRow, error)
}

// SessionDestroyer revokes the caller's session. Satisfied by *session.Manager in production
// (the same Destroy that auth's logout calls) and a fake in tests. Kept narrow: the me domain
// only needs to tear the session down after an account delete.
type SessionDestroyer interface {
	Destroy(ctx context.Context) error
}

// Deps are the collaborators a me Service is built from.
type Deps struct {
	Store    Store
	Sessions SessionDestroyer
	Logger   *slog.Logger
}

// Service owns every me operation's behaviour over its injected collaborators.
type Service struct {
	Deps
}

// New builds a Service from its dependencies.
func New(d Deps) *Service {
	return &Service{Deps: d}
}

const (
	tagMe               = "me"
	genericErrorMessage = "Something went wrong. Please try again."
	userNameMaxChars    = 100
)

// Register builds the Service and wires every me operation onto the API.
func Register(api huma.API, d Deps) {
	s := New(d)
	registerGetPreferences(api, s)
	registerUpdatePreferences(api, s)
	registerUpdateProfile(api, s)
	registerDeleteAccount(api, s)
	registerStats(api, s)
}

// secured is the session security requirement every me operation declares.
func secured() []map[string][]string {
	return []map[string][]string{{middleware.SessionScheme: {}}}
}
