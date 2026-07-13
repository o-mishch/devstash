package search

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2/humatest"
	"github.com/jackc/pgx/v5"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

const testUserID = "user-1"

func discardLogger() *slog.Logger { return slog.New(slog.DiscardHandler) }

type fakeStore struct {
	items       []sqlcdb.SearchItemsRow
	itemsErr    error
	collections []sqlcdb.SearchCollectionsRow
	colErr      error

	lastItemsPattern string
	lastOwner        string
}

func (f *fakeStore) SearchItems(
	_ context.Context,
	arg sqlcdb.SearchItemsParams,
) ([]sqlcdb.SearchItemsRow, error) {
	f.lastItemsPattern = arg.Pattern
	f.lastOwner = arg.Owner
	return f.items, f.itemsErr
}

func (f *fakeStore) SearchCollections(
	_ context.Context, arg sqlcdb.SearchCollectionsParams,
) ([]sqlcdb.SearchCollectionsRow, error) {
	return f.collections, f.colErr
}

type fakeResolver struct{ userID string }

func (f fakeResolver) UserID(context.Context) string           { return f.userID }
func (fakeResolver) Fingerprint(context.Context) string        { return "" }
func (fakeResolver) UpdateFingerprint(context.Context, string) {}
func (fakeResolver) LastActiveAt(context.Context) time.Time    { return time.Unix(0, 0) }
func (fakeResolver) Touch(context.Context)                     {}
func (fakeResolver) Destroy(context.Context) error             { return nil }

type fakeUserByID struct{}

func (fakeUserByID) GetUserByID(context.Context, string) (sqlcdb.User, error) {
	return sqlcdb.User{ID: testUserID}, nil
}

func newTestAPI(t *testing.T, store Store) humatest.TestAPI {
	t.Helper()
	_, api := humatest.New(t)
	api.UseMiddleware(middleware.RequireSession(api, fakeResolver{userID: testUserID}, fakeUserByID{}, discardLogger()))
	Register(api, Deps{Store: store, Logger: discardLogger()})
	return api
}

func TestSearchSuccess(t *testing.T) {
	t.Parallel()
	store := &fakeStore{
		items: []sqlcdb.SearchItemsRow{{ID: "i1", Title: "hit", ItemTypeName: "snippet", Tags: []string{"go"}}},
		collections: []sqlcdb.SearchCollectionsRow{
			{ID: "c1", Name: "Col", IsFavorite: true, ItemCount: 3},
		},
	}
	resp := newTestAPI(t, store).Get("/search?q=hit")
	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", resp.Code, resp.Body.String())
	}
	body := resp.Body.String()
	if !strings.Contains(body, `"hit"`) || !strings.Contains(body, `"Col"`) {
		t.Errorf("unexpected body = %s", body)
	}
	// SidebarCollection dominantColor is always null in search.
	if !strings.Contains(body, `"dominantColor":null`) {
		t.Errorf("expected dominantColor null; body = %s", body)
	}
	if store.lastOwner != testUserID {
		t.Errorf("owner = %q, want %q (IDOR scope)", store.lastOwner, testUserID)
	}
}

func TestSearchEscapesWildcards(t *testing.T) {
	t.Parallel()
	store := &fakeStore{}
	resp := newTestAPI(t, store).Get("/search?q=50%25_off")
	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", resp.Code, resp.Body.String())
	}
	// The % and _ in the query must be escaped so they match literally, not as wildcards.
	if want := `%50\%\_off%`; store.lastItemsPattern != want {
		t.Errorf("pattern = %q, want %q", store.lastItemsPattern, want)
	}
}

func TestSearchEmptyQueryIs422(t *testing.T) {
	t.Parallel()
	// A whitespace-only q passes minLength but the resolver trims it to empty → 422.
	resp := newTestAPI(t, &fakeStore{}).Get("/search?q=%20%20")
	if resp.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422; body = %s", resp.Code, resp.Body.String())
	}
}

func TestSearchMissingQueryIs422(t *testing.T) {
	t.Parallel()
	resp := newTestAPI(t, &fakeStore{}).Get("/search")
	if resp.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422; body = %s", resp.Code, resp.Body.String())
	}
}

func TestStoreErrorIs500(t *testing.T) {
	t.Parallel()
	resp := newTestAPI(t, &fakeStore{itemsErr: pgx.ErrTxClosed}).Get("/search?q=x")
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body = %s", resp.Code, resp.Body.String())
	}
}
