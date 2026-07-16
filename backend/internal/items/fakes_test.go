package items

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2/humatest"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
	"github.com/o-mishch/devstash/backend/internal/ratelimit"
)

const testUserID = "user-1"

func discardLogger() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}

// fakeItemStore is a hand-written double for ItemStore. Each method returns a canned value
// (and optional error) and records the params it was called with, so tests assert owner
// scoping and drive the handler branches without a real database.
type fakeItemStore struct {
	recent     []sqlcdb.ListRecentItemsRow
	byType     []sqlcdb.ListItemsByTypeRow
	byColl     []sqlcdb.ListItemsByCollectionRow
	favorites  []sqlcdb.ListFavoriteItemsRow
	listErr    error
	getRow     sqlcdb.GetItemByIDRow
	getErr     error
	detailsRow sqlcdb.GetItemDetailsRow
	detailsErr error
	contentRow sqlcdb.GetItemContentRow
	contentErr error
	authRow    sqlcdb.GetItemForAuthRow
	authErr    error
	typeID     string
	typeErr    error
	count      int64
	countErr   error
	createRow  sqlcdb.CreateItemRow
	createErr  error
	updateRow  sqlcdb.UpdateItemRow
	updateErr  error
	deleteN    int64
	deleteErr  error
	favN       int64
	favErr     error
	pinN       int64
	pinErr     error

	lastCreate sqlcdb.CreateItemParams
	lastUpdate sqlcdb.UpdateItemParams
	lastOwner  string
	// lastPageLimit records the LIMIT the handler asked the store for, so a test can assert
	// the caller-supplied `limit` was clamped before it ever reached the query.
	lastPageLimit int32
}

func (f *fakeItemStore) ListRecentItems(
	_ context.Context, arg sqlcdb.ListRecentItemsParams,
) ([]sqlcdb.ListRecentItemsRow, error) {
	f.lastOwner = arg.Owner
	f.lastPageLimit = arg.PageLimit
	return f.recent, f.listErr
}

func (f *fakeItemStore) ListItemsByType(
	_ context.Context, arg sqlcdb.ListItemsByTypeParams,
) ([]sqlcdb.ListItemsByTypeRow, error) {
	f.lastOwner = arg.Owner
	f.lastPageLimit = arg.PageLimit
	return f.byType, f.listErr
}

func (f *fakeItemStore) ListItemsByCollection(
	_ context.Context, arg sqlcdb.ListItemsByCollectionParams,
) ([]sqlcdb.ListItemsByCollectionRow, error) {
	f.lastOwner = arg.Owner
	f.lastPageLimit = arg.PageLimit
	return f.byColl, f.listErr
}

func (f *fakeItemStore) ListFavoriteItems(
	_ context.Context, arg sqlcdb.ListFavoriteItemsParams,
) ([]sqlcdb.ListFavoriteItemsRow, error) {
	f.lastOwner = arg.Owner
	f.lastPageLimit = arg.PageLimit
	return f.favorites, f.listErr
}

func (f *fakeItemStore) GetItemByID(_ context.Context, arg sqlcdb.GetItemByIDParams) (sqlcdb.GetItemByIDRow, error) {
	f.lastOwner = arg.Owner
	return f.getRow, f.getErr
}

func (f *fakeItemStore) GetItemDetails(
	_ context.Context, arg sqlcdb.GetItemDetailsParams,
) (sqlcdb.GetItemDetailsRow, error) {
	f.lastOwner = arg.Owner
	return f.detailsRow, f.detailsErr
}

func (f *fakeItemStore) GetItemContent(
	_ context.Context, arg sqlcdb.GetItemContentParams,
) (sqlcdb.GetItemContentRow, error) {
	f.lastOwner = arg.Owner
	return f.contentRow, f.contentErr
}

func (f *fakeItemStore) GetItemForAuth(
	_ context.Context, arg sqlcdb.GetItemForAuthParams,
) (sqlcdb.GetItemForAuthRow, error) {
	f.lastOwner = arg.Owner
	return f.authRow, f.authErr
}

func (f *fakeItemStore) GetItemTypeByName(_ context.Context, _ sqlcdb.GetItemTypeByNameParams) (string, error) {
	return f.typeID, f.typeErr
}

func (f *fakeItemStore) CountItemsByUser(_ context.Context, owner string) (int64, error) {
	f.lastOwner = owner
	return f.count, f.countErr
}

func (f *fakeItemStore) CreateItem(_ context.Context, arg sqlcdb.CreateItemParams) (sqlcdb.CreateItemRow, error) {
	f.lastCreate = arg
	return f.createRow, f.createErr
}

func (f *fakeItemStore) UpdateItem(_ context.Context, arg sqlcdb.UpdateItemParams) (sqlcdb.UpdateItemRow, error) {
	f.lastUpdate = arg
	return f.updateRow, f.updateErr
}

func (f *fakeItemStore) DeleteItem(_ context.Context, arg sqlcdb.DeleteItemParams) (int64, error) {
	f.lastOwner = arg.Owner
	return f.deleteN, f.deleteErr
}

func (f *fakeItemStore) SetItemFavorite(_ context.Context, arg sqlcdb.SetItemFavoriteParams) (int64, error) {
	f.lastOwner = arg.Owner
	return f.favN, f.favErr
}

func (f *fakeItemStore) SetItemPinned(_ context.Context, arg sqlcdb.SetItemPinnedParams) (int64, error) {
	f.lastOwner = arg.Owner
	return f.pinN, f.pinErr
}

// fakeLimiter is a controllable ratelimit.Limiter: allow by default, or deny / error.
type fakeLimiter struct {
	deny bool
	err  error
}

func (f fakeLimiter) Allow(_ context.Context, _, _ string) (ratelimit.Decision, error) {
	if f.err != nil {
		return ratelimit.Decision{}, f.err
	}
	return ratelimit.Decision{Allowed: !f.deny, RetryAfter: time.Minute}, nil
}

// fakeResolver satisfies middleware.SessionResolver with a fixed user id and an empty
// fingerprint (the test user has no password, so the envelope check is a no-op).
type fakeResolver struct{ userID string }

func (f fakeResolver) UserID(context.Context) string           { return f.userID }
func (fakeResolver) Fingerprint(context.Context) string        { return "" }
func (fakeResolver) UpdateFingerprint(context.Context, string) {}
func (fakeResolver) LastActiveAt(context.Context) time.Time    { return time.Unix(0, 0) }
func (fakeResolver) Touch(context.Context)                     {}
func (fakeResolver) Destroy(context.Context) error             { return nil }

// fakeUserByID satisfies middleware.UserByIDStore, returning the session user so the
// middleware stashes it (drives isPro).
type fakeUserByID struct{ user sqlcdb.User }

func (f fakeUserByID) GetUserByID(context.Context, string) (sqlcdb.User, error) {
	return f.user, nil
}

// freeUser is the default non-Pro session user.
func freeUser() sqlcdb.User {
	return sqlcdb.User{ID: testUserID, Email: "u@example.com"}
}

// proUser is a Pro session user (isPro + a Stripe subscription id).
func proUser() sqlcdb.User {
	return sqlcdb.User{ID: testUserID, Email: "u@example.com", IsPro: true, StripeSubscriptionId: new("sub_1")}
}

// newTestAPI builds a humatest API with the real session middleware wired to fakes, so the
// item handlers see a resolved CurrentUserID/CurrentUser exactly as in production.
func newTestAPI(t *testing.T, d Deps, user sqlcdb.User) humatest.TestAPI {
	t.Helper()
	if d.Logger == nil {
		d.Logger = discardLogger()
	}
	_, api := humatest.New(t)
	api.UseMiddleware(
		middleware.RequireSession(api, fakeResolver{userID: user.ID}, fakeUserByID{user: user}, discardLogger()),
	)
	Register(api, d)
	return api
}

// baseDeps builds Deps with the given store and an always-allow limiter.
func baseDeps(store ItemStore) Deps {
	return Deps{
		Store:   store,
		Limiter: fakeLimiter{},
		IDs:     func() string { return "generated-id" },
		Logger:  discardLogger(),
		Cfg:     Config{FailClosed: true},
	}
}
