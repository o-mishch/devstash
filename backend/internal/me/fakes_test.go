package me

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

// fakeStore is a hand-written double for Store. It records the userId/owner each method was
// called with so tests can assert IDOR scoping, and returns preconfigured values/errors.
type fakeStore struct {
	prefsBlob []byte
	prefsErr  error

	updatePrefsN   int64
	updatePrefsErr error

	nameRow sqlcdb.UpdateUserNameRow
	nameErr error

	deleteN   int64
	deleteErr error

	totalItems    int64
	totalItemsErr error
	favItems      int64
	favItemsErr   error
	totalColls    int64
	totalCollsErr error
	favColls      int64
	favCollsErr   error
	typeCounts    []sqlcdb.GetItemTypeCountsByUserRow
	typeCountsErr error

	activity    []sqlcdb.GetDashboardActivityRow
	activityErr error

	// Captured call inputs for IDOR / merge assertions.
	lastID           string
	lastUpdatePrefs  sqlcdb.UpdateEditorPreferencesParams
	lastNameParams   sqlcdb.UpdateUserNameParams
	lastActivityArgs sqlcdb.GetDashboardActivityParams
}

func (f *fakeStore) GetEditorPreferences(_ context.Context, id string) ([]byte, error) {
	f.lastID = id
	return f.prefsBlob, f.prefsErr
}

func (f *fakeStore) UpdateEditorPreferences(
	_ context.Context, arg sqlcdb.UpdateEditorPreferencesParams,
) (int64, error) {
	f.lastID = arg.ID
	f.lastUpdatePrefs = arg
	return f.updatePrefsN, f.updatePrefsErr
}

func (f *fakeStore) UpdateUserName(
	_ context.Context, arg sqlcdb.UpdateUserNameParams,
) (sqlcdb.UpdateUserNameRow, error) {
	f.lastID = arg.ID
	f.lastNameParams = arg
	return f.nameRow, f.nameErr
}

func (f *fakeStore) DeleteUser(_ context.Context, id string) (int64, error) {
	f.lastID = id
	return f.deleteN, f.deleteErr
}

func (f *fakeStore) CountItemsByUser(_ context.Context, owner string) (int64, error) {
	f.lastID = owner
	return f.totalItems, f.totalItemsErr
}

func (f *fakeStore) CountFavoriteItemsByUser(_ context.Context, owner string) (int64, error) {
	f.lastID = owner
	return f.favItems, f.favItemsErr
}

func (f *fakeStore) CountCollectionsByUser(_ context.Context, owner string) (int64, error) {
	f.lastID = owner
	return f.totalColls, f.totalCollsErr
}

func (f *fakeStore) CountFavoriteCollectionsByUser(_ context.Context, owner string) (int64, error) {
	f.lastID = owner
	return f.favColls, f.favCollsErr
}

func (f *fakeStore) GetItemTypeCountsByUser(
	_ context.Context, owner string,
) ([]sqlcdb.GetItemTypeCountsByUserRow, error) {
	f.lastID = owner
	return f.typeCounts, f.typeCountsErr
}

func (f *fakeStore) GetDashboardActivity(
	_ context.Context, arg sqlcdb.GetDashboardActivityParams,
) ([]sqlcdb.GetDashboardActivityRow, error) {
	f.lastID = arg.Owner
	f.lastActivityArgs = arg
	return f.activity, f.activityErr
}

// fakeSessions records whether Destroy was called and can be made to fail.
type fakeSessions struct {
	destroyed  bool
	destroyErr error
}

func (f *fakeSessions) Destroy(context.Context) error {
	f.destroyed = true
	return f.destroyErr
}

// Session middleware doubles (mirror internal/collections' fakes).
type fakeResolver struct{ userID string }

func (f fakeResolver) UserID(context.Context) string           { return f.userID }
func (fakeResolver) Fingerprint(context.Context) string        { return "" }
func (fakeResolver) UpdateFingerprint(context.Context, string) {}
func (fakeResolver) LastActiveAt(context.Context) time.Time    { return time.Unix(0, 0) }
func (fakeResolver) Touch(context.Context)                     {}
func (fakeResolver) Destroy(context.Context) error             { return nil }

type fakeUserByID struct{ user sqlcdb.User }

func (f fakeUserByID) GetUserByID(context.Context, string) (sqlcdb.User, error) { return f.user, nil }

func testUser() sqlcdb.User { return sqlcdb.User{ID: testUserID, Email: "u@example.com"} }

// testNow is the fixed clock the activity series anchors to in tests (a mid-afternoon UTC
// instant, so the UTC-calendar-date truncation is exercised, not just midnight).
var testNow = time.Date(2026, time.July, 16, 15, 4, 5, 0, time.UTC)

func baseDeps(store Store, sessions SessionDestroyer) Deps {
	return Deps{
		Store:    store,
		Sessions: sessions,
		Logger:   discardLogger(),
		Now:      func() time.Time { return testNow },
	}
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
