package collections

import (
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
)

func TestListCollections(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		store      *fakeCollectionStore
		wantStatus int
		wantBody   string
	}{
		{
			name: "with type chips",
			store: &fakeCollectionStore{
				list: []sqlcdb.ListCollectionsRow{{ID: "c1", Name: "Col", ItemCount: 2}},
				counts: []sqlcdb.GetCollectionTypeCountsRow{
					{CollectionId: "c1", ID: "t1", Name: "snippet", Color: "#111", Count: 2},
				},
			},
			wantStatus: http.StatusOK,
			wantBody:   `"dominantColor":"#111"`,
		},
		{name: "empty", store: &fakeCollectionStore{}, wantStatus: http.StatusOK, wantBody: `[]`},
		{
			name:       "list error is 500",
			store:      &fakeCollectionStore{listErr: pgx.ErrTxClosed},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "type-counts error is 500",
			store: &fakeCollectionStore{
				list:      []sqlcdb.ListCollectionsRow{{ID: "c1", Name: "Col"}},
				countsErr: pgx.ErrTxClosed,
			},
			wantStatus: http.StatusInternalServerError,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			api := newTestAPI(t, baseDeps(tc.store), freeUser())
			resp := api.Get("/collections")
			if resp.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", resp.Code, tc.wantStatus, resp.Body.String())
			}
			if tc.wantStatus == http.StatusOK {
				if tc.store.lastOwner != testUserID {
					t.Errorf("owner = %q, want %q (IDOR scope)", tc.store.lastOwner, testUserID)
				}
				if !strings.Contains(resp.Body.String(), tc.wantBody) {
					t.Errorf("body = %s, want to contain %s", resp.Body.String(), tc.wantBody)
				}
			}
		})
	}
}

func TestGetCollection(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		store      *fakeCollectionStore
		wantStatus int
	}{
		{
			name:       "found",
			store:      &fakeCollectionStore{getRow: sqlcdb.GetCollectionByIDRow{ID: "c1", Name: "Col"}},
			wantStatus: http.StatusOK,
		},
		{name: "not found is 404", store: &fakeCollectionStore{getErr: pgx.ErrNoRows}, wantStatus: http.StatusNotFound},
		{
			name:       "error is 500",
			store:      &fakeCollectionStore{getErr: pgx.ErrTxClosed},
			wantStatus: http.StatusInternalServerError,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			resp := newTestAPI(t, baseDeps(tc.store), freeUser()).Get("/collections/c1")
			if resp.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", resp.Code, tc.wantStatus, resp.Body.String())
			}
		})
	}
}

func TestCreateCollection(t *testing.T) {
	t.Parallel()
	okRow := sqlcdb.CreateCollectionRow{ID: "c1", Name: "New", ItemCount: 0}
	tests := []struct {
		name       string
		user       sqlcdb.User
		store      *fakeCollectionStore
		body       map[string]any
		wantStatus int
	}{
		{
			name:       "success",
			user:       freeUser(),
			store:      &fakeCollectionStore{createRow: okRow, count: 0},
			body:       map[string]any{"name": "New"},
			wantStatus: http.StatusCreated,
		},
		{
			name:       "free-tier limit is 403",
			user:       freeUser(),
			store:      &fakeCollectionStore{count: 3},
			body:       map[string]any{"name": "New"},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "pro bypasses limit",
			user:       proUser(),
			store:      &fakeCollectionStore{createRow: okRow, count: 99},
			body:       map[string]any{"name": "New"},
			wantStatus: http.StatusCreated,
		},
		{
			name:       "empty name is 422",
			user:       freeUser(),
			store:      &fakeCollectionStore{},
			body:       map[string]any{"name": "   "},
			wantStatus: http.StatusUnprocessableEntity,
		},
		{
			name:       "create error is 500",
			user:       freeUser(),
			store:      &fakeCollectionStore{createErr: pgx.ErrTxClosed},
			body:       map[string]any{"name": "New"},
			wantStatus: http.StatusInternalServerError,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			resp := newTestAPI(t, baseDeps(tc.store), tc.user).Post("/collections", tc.body)
			if resp.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", resp.Code, tc.wantStatus, resp.Body.String())
			}
		})
	}
}

func TestUpdateCollection(t *testing.T) {
	t.Parallel()

	t.Run("edit sends name+description marks description set", func(t *testing.T) {
		t.Parallel()
		store := &fakeCollectionStore{updateN: 1, getRow: sqlcdb.GetCollectionByIDRow{ID: "c1", Name: "New"}}
		resp := newTestAPI(
			t,
			baseDeps(store),
			freeUser(),
		).Patch("/collections/c1", map[string]any{"name": "New", "description": nil})
		if resp.Code != http.StatusOK {
			t.Fatalf("status = %d; body = %s", resp.Code, resp.Body.String())
		}
		if !store.lastUpdate.DescriptionSet {
			t.Error("DescriptionSet = false, want true when name is present")
		}
		if store.lastUpdate.Owner != testUserID {
			t.Errorf("owner = %q, want %q (IDOR scope)", store.lastUpdate.Owner, testUserID)
		}
	})

	t.Run("favorite-only patch leaves description unset", func(t *testing.T) {
		t.Parallel()
		store := &fakeCollectionStore{updateN: 1, getRow: sqlcdb.GetCollectionByIDRow{ID: "c1", Name: "Col"}}
		resp := newTestAPI(t, baseDeps(store), freeUser()).Patch("/collections/c1", map[string]any{"isFavorite": true})
		if resp.Code != http.StatusOK {
			t.Fatalf("status = %d; body = %s", resp.Code, resp.Body.String())
		}
		if store.lastUpdate.DescriptionSet {
			t.Error("DescriptionSet = true, want false for a favorite-only patch")
		}
	})

	t.Run("not found is 404", func(t *testing.T) {
		t.Parallel()
		resp := newTestAPI(
			t,
			baseDeps(&fakeCollectionStore{updateN: 0}),
			freeUser(),
		).Patch("/collections/c1", map[string]any{"name": "X"})
		if resp.Code != http.StatusNotFound {
			t.Fatalf("status = %d; body = %s", resp.Code, resp.Body.String())
		}
	})

	t.Run("update error is 500", func(t *testing.T) {
		t.Parallel()
		resp := newTestAPI(
			t,
			baseDeps(&fakeCollectionStore{updateErr: pgx.ErrTxClosed}),
			freeUser(),
		).Patch("/collections/c1", map[string]any{"name": "X"})
		if resp.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d; body = %s", resp.Code, resp.Body.String())
		}
	})
}

func TestDeleteAndFavoriteCollection(t *testing.T) {
	t.Parallel()
	if resp := newTestAPI(
		t,
		baseDeps(&fakeCollectionStore{deleteN: 1}),
		freeUser(),
	).Delete("/collections/c1"); resp.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d; body = %s", resp.Code, resp.Body.String())
	}
	if resp := newTestAPI(
		t,
		baseDeps(&fakeCollectionStore{deleteN: 0}),
		freeUser(),
	).Delete("/collections/c1"); resp.Code != http.StatusNotFound {
		t.Fatalf("delete not-found status = %d", resp.Code)
	}
	if resp := newTestAPI(
		t,
		baseDeps(&fakeCollectionStore{favN: 1}),
		freeUser(),
	).Patch("/collections/c1/favorite", map[string]any{"isFavorite": true}); resp.Code != http.StatusNoContent {
		t.Fatalf("favorite status = %d; body = %s", resp.Code, resp.Body.String())
	}
	if resp := newTestAPI(
		t,
		baseDeps(&fakeCollectionStore{favN: 0}),
		freeUser(),
	).Patch("/collections/c1/favorite", map[string]any{"isFavorite": true}); resp.Code != http.StatusNotFound {
		t.Fatalf("favorite not-found status = %d", resp.Code)
	}
}
