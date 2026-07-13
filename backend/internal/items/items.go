// Package items implements the DevStash items surface as Huma operations: the paginated
// list, single-item read, create, update, delete, favorite/pinned toggles, and the
// lazily-fetched content/details reads. Files are vertical slices — one per operation
// (create.go, list.go, get.go, …) — each owning its Huma handler and request/response
// structs. The structural template mirrors internal/auth: collaborators are injected as
// Deps (the exported constructor input) and held on an unexported-field *Service; the data
// dependency sits behind a narrow, consumer-defined ItemStore interface satisfied by the
// sqlc *Queries in production and an in-memory fake in tests. Every query is scoped by the
// session userId (IDOR-safe); item mutations spend the BucketItemMutation rate-limit budget.
package items

import (
	"context"
	"log/slog"
	"slices"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
	"github.com/o-mishch/devstash/backend/internal/ratelimit"
)

// ItemStore is the items domain's data interface, satisfied by the sqlc *Queries in
// production and an in-memory fake in tests. It is items-scoped (not a global Querier):
// only the reads and writes the item operations perform. Every method is keyed by a
// server-derived owner (the session userId), never raw user input (IDOR-safe).
type ItemStore interface {
	ListRecentItems(ctx context.Context, arg sqlcdb.ListRecentItemsParams) ([]sqlcdb.ListRecentItemsRow, error)
	ListItemsByType(ctx context.Context, arg sqlcdb.ListItemsByTypeParams) ([]sqlcdb.ListItemsByTypeRow, error)
	ListItemsByCollection(
		ctx context.Context,
		arg sqlcdb.ListItemsByCollectionParams,
	) ([]sqlcdb.ListItemsByCollectionRow, error)
	ListFavoriteItems(ctx context.Context, arg sqlcdb.ListFavoriteItemsParams) ([]sqlcdb.ListFavoriteItemsRow, error)
	GetItemByID(ctx context.Context, arg sqlcdb.GetItemByIDParams) (sqlcdb.GetItemByIDRow, error)
	GetItemDetails(ctx context.Context, arg sqlcdb.GetItemDetailsParams) (sqlcdb.GetItemDetailsRow, error)
	GetItemContent(ctx context.Context, arg sqlcdb.GetItemContentParams) (sqlcdb.GetItemContentRow, error)
	GetItemForAuth(ctx context.Context, arg sqlcdb.GetItemForAuthParams) (sqlcdb.GetItemForAuthRow, error)
	GetItemTypeByName(ctx context.Context, arg sqlcdb.GetItemTypeByNameParams) (string, error)
	CountItemsByUser(ctx context.Context, owner string) (int64, error)
	CreateItem(ctx context.Context, arg sqlcdb.CreateItemParams) (sqlcdb.CreateItemRow, error)
	UpdateItem(ctx context.Context, arg sqlcdb.UpdateItemParams) (sqlcdb.UpdateItemRow, error)
	DeleteItem(ctx context.Context, arg sqlcdb.DeleteItemParams) (int64, error)
	SetItemFavorite(ctx context.Context, arg sqlcdb.SetItemFavoriteParams) (int64, error)
	SetItemPinned(ctx context.Context, arg sqlcdb.SetItemPinnedParams) (int64, error)
}

// Config carries the non-secret item settings the handlers need.
type Config struct {
	// FailClosed makes the rate limiter deny on a Redis outage (429) instead of allowing
	// through. Mirrors auth.Config.FailClosed (RATE_LIMIT_FAIL_OPEN inverts it in dev).
	FailClosed bool
}

// Deps are the collaborators an items Service is built from. It is the exported constructor
// input (Register/New take it) and is embedded verbatim in Service.
type Deps struct {
	Store   ItemStore
	Limiter ratelimit.Limiter
	IDs     func() string // new-row id generator (UUIDv7 in production), for items + tags
	Logger  *slog.Logger
	Cfg     Config
}

// Service owns every item operation's behaviour over its injected collaborators. Built once
// via New and shared across all operations — the handlers are stateless closures over it.
type Service struct {
	Deps
}

// New builds a Service from its dependencies.
func New(d Deps) *Service {
	return &Service{Deps: d}
}

// tagItems is the OpenAPI tag grouping all item operations.
const tagItems = "items"

// genericErrorMessage is the opaque body returned on any 500 — it never leaks the
// underlying failure (which is logged instead), matching internal/auth.
const genericErrorMessage = "Something went wrong. Please try again."

// itemNotFoundMessage mirrors the Next app's ErrorMessage.ITEM_NOT_FOUND.
const itemNotFoundMessage = "Item not found."

// Register builds the Service and wires every item operation onto the API.
func Register(api huma.API, d Deps) {
	s := New(d)
	registerList(api, s)
	registerGet(api, s)
	registerCreate(api, s)
	registerUpdate(api, s)
	registerDelete(api, s)
	registerFavorite(api, s)
	registerPinned(api, s)
	registerContent(api, s)
	registerDetails(api, s)
}

// secured is the session security requirement every item operation declares.
func secured() []map[string][]string {
	return []map[string][]string{{middleware.SessionScheme: {}}}
}

// enforceItemMutation spends one BucketItemMutation token for the userId. Copied from the
// auth Service.enforceLimit: on a Redis outage it fails closed (429) unless Cfg.FailClosed
// is false (local dev only), so an internet-facing deploy never silently drops the guard.
func (s *Service) enforceItemMutation(ctx context.Context, userID string) error {
	dec, err := s.Limiter.Allow(ctx, ratelimit.BucketItemMutation, userID)
	if err != nil {
		if s.Cfg.FailClosed {
			s.Logger.ErrorContext(ctx, "item rate limiter unavailable, failing closed", "err", err)
			return huma.Error429TooManyRequests("Too many attempts. Please try again in a moment.")
		}
		s.Logger.WarnContext(ctx, "item rate limiter unavailable, failing open", "err", err)
		return nil
	}
	if !dec.Allowed {
		return huma.Error429TooManyRequests("Too many attempts. Please try again in a moment.")
	}
	return nil
}

// isPro resolves the session user's Pro entitlement read-only: isPro AND a Stripe
// subscription id present (parity with resolveProAccessFromRow — no Stripe API call). During
// a transient DB blip the full user row is absent, so it conservatively returns false.
func isPro(ctx context.Context) bool {
	user, ok := middleware.CurrentUser(ctx)
	return ok && user.IsPro && user.StripeSubscriptionId != nil
}

// collectionRef is the {id, name} pair a detail/full item lists its collections as.
type collectionRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// normalizeOptional trims a client string and coerces empty to null (parity with the Zod
// .transform((v) => v || null) on description/content/url/language).
func normalizeOptional(s *string) *string {
	if s == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*s)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// normalizeTags trims each tag, drops the empties, and de-duplicates (keeping first
// occurrence) — parity with z.array(z.string().trim().min(1)) plus the connect-or-create's
// implicit idempotence. De-duplication is required, not cosmetic: the create/update SQL feeds
// the names into a single INSERT ... SELECT unnest(...) ON CONFLICT (name) DO UPDATE, and two
// equal names in one such statement is a hard "cannot affect row a second time" error.
// Returns a non-nil slice.
func normalizeTags(tags []string) []string {
	out := make([]string, 0, len(tags))
	seen := make(map[string]struct{}, len(tags))
	for t := range slices.Values(tags) {
		trimmed := strings.TrimSpace(t)
		if trimmed == "" {
			continue
		}
		if _, dup := seen[trimmed]; dup {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}
