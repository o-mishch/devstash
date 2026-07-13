package collections

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2/humatest"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

const testUserID = "user-1"

func discardLogger() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}

// fakeCollectionStore is a hand-written double for CollectionStore.
type fakeCollectionStore struct {
	list      []sqlcdb.ListCollectionsRow
	listErr   error
	getRow    sqlcdb.GetCollectionByIDRow
	getErr    error
	counts    []sqlcdb.GetCollectionTypeCountsRow
	countsErr error
	count     int64
	countErr  error
	createRow sqlcdb.CreateCollectionRow
	createErr error
	updateN   int64
	updateErr error
	deleteN   int64
	deleteErr error
	favN      int64
	favErr    error

	lastUpdate sqlcdb.UpdateCollectionParams
	lastOwner  string
}

func (f *fakeCollectionStore) ListCollections(_ context.Context, owner string) ([]sqlcdb.ListCollectionsRow, error) {
	f.lastOwner = owner
	return f.list, f.listErr
}

func (f *fakeCollectionStore) GetCollectionByID(
	_ context.Context, arg sqlcdb.GetCollectionByIDParams,
) (sqlcdb.GetCollectionByIDRow, error) {
	f.lastOwner = arg.Owner
	return f.getRow, f.getErr
}

func (f *fakeCollectionStore) GetCollectionTypeCounts(
	_ context.Context, arg sqlcdb.GetCollectionTypeCountsParams,
) ([]sqlcdb.GetCollectionTypeCountsRow, error) {
	f.lastOwner = arg.Owner
	return f.counts, f.countsErr
}

func (f *fakeCollectionStore) CountCollectionsByUser(_ context.Context, owner string) (int64, error) {
	f.lastOwner = owner
	return f.count, f.countErr
}

func (f *fakeCollectionStore) CreateCollection(
	_ context.Context, arg sqlcdb.CreateCollectionParams,
) (sqlcdb.CreateCollectionRow, error) {
	f.lastOwner = arg.Owner
	return f.createRow, f.createErr
}

func (f *fakeCollectionStore) UpdateCollection(_ context.Context, arg sqlcdb.UpdateCollectionParams) (int64, error) {
	f.lastUpdate = arg
	f.lastOwner = arg.Owner
	return f.updateN, f.updateErr
}

func (f *fakeCollectionStore) DeleteCollection(_ context.Context, arg sqlcdb.DeleteCollectionParams) (int64, error) {
	f.lastOwner = arg.Owner
	return f.deleteN, f.deleteErr
}

func (f *fakeCollectionStore) SetCollectionFavorite(
	_ context.Context, arg sqlcdb.SetCollectionFavoriteParams,
) (int64, error) {
	f.lastOwner = arg.Owner
	return f.favN, f.favErr
}

type fakeResolver struct{ userID string }

func (f fakeResolver) UserID(context.Context) string           { return f.userID }
func (fakeResolver) Fingerprint(context.Context) string        { return "" }
func (fakeResolver) UpdateFingerprint(context.Context, string) {}
func (fakeResolver) LastActiveAt(context.Context) time.Time    { return time.Unix(0, 0) }
func (fakeResolver) Touch(context.Context)                     {}
func (fakeResolver) Destroy(context.Context) error             { return nil }

type fakeUserByID struct{ user sqlcdb.User }

func (f fakeUserByID) GetUserByID(context.Context, string) (sqlcdb.User, error) { return f.user, nil }

func freeUser() sqlcdb.User { return sqlcdb.User{ID: testUserID, Email: "u@example.com"} }
func proUser() sqlcdb.User {
	return sqlcdb.User{ID: testUserID, Email: "u@example.com", IsPro: true, StripeSubscriptionId: new("sub_1")}
}

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

func baseDeps(store CollectionStore) Deps {
	return Deps{Store: store, IDs: func() string { return "generated-id" }, Logger: discardLogger()}
}
