package items

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
)

// --- list ---

func TestListItems(t *testing.T) {
	t.Parallel()

	// 21 recent rows (PAGE_SIZE+1) drives hasMore + nextCursor.
	recent := make([]sqlcdb.ListRecentItemsRow, 21)
	for i := range recent {
		recent[i] = sqlcdb.ListRecentItemsRow{
			ID:           "id-" + string(rune('a'+i)),
			Title:        "t",
			ItemTypeName: "snippet",
			Tags:         []string{},
		}
	}

	tests := []struct {
		name        string
		query       string
		store       *fakeItemStore
		wantStatus  int
		wantHasMore bool
		wantLen     int
	}{
		{
			name:        "recent paginates with hasMore",
			query:       "/items?type=recent",
			store:       &fakeItemStore{recent: recent},
			wantStatus:  http.StatusOK,
			wantHasMore: true,
			wantLen:     20,
		},
		{
			name:  "favorites",
			query: "/items?type=favorites",
			store: &fakeItemStore{
				favorites: []sqlcdb.ListFavoriteItemsRow{
					{ID: "f1", Title: "t", ItemTypeName: "note", Tags: []string{}},
				},
			},
			wantStatus: http.StatusOK,
			wantLen:    1,
		},
		{
			name:       "type missing typeName is 422",
			query:      "/items?type=type",
			store:      &fakeItemStore{},
			wantStatus: http.StatusUnprocessableEntity,
		},
		{
			name:       "collection missing collectionId is 422",
			query:      "/items?type=collection",
			store:      &fakeItemStore{},
			wantStatus: http.StatusUnprocessableEntity,
		},
		{
			name:       "invalid type is 422",
			query:      "/items?type=bogus",
			store:      &fakeItemStore{},
			wantStatus: http.StatusUnprocessableEntity,
		},
		{
			name:       "store error is 500",
			query:      "/items?type=recent",
			store:      &fakeItemStore{listErr: pgx.ErrTxClosed},
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			api := newTestAPI(t, baseDeps(tc.store), freeUser())
			resp := api.Get(tc.query)
			if resp.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", resp.Code, tc.wantStatus, resp.Body.String())
			}
			if tc.wantStatus != http.StatusOK {
				return
			}
			if tc.store.lastOwner != testUserID {
				t.Errorf("store owner = %q, want %q (IDOR scope)", tc.store.lastOwner, testUserID)
			}
			body := resp.Body.String()
			if tc.wantHasMore && !strings.Contains(body, `"hasMore":true`) {
				t.Errorf("expected hasMore true; body = %s", body)
			}
		})
	}
}

func TestListTypeAndCollectionScope(t *testing.T) {
	t.Parallel()
	store := &fakeItemStore{
		byType: []sqlcdb.ListItemsByTypeRow{{ID: "i", Title: "t", ItemTypeName: "snippet", Tags: []string{}}},
	}
	api := newTestAPI(t, baseDeps(store), freeUser())
	if resp := api.Get("/items?type=type&typeName=snippet"); resp.Code != http.StatusOK {
		t.Fatalf("type list status = %d; body = %s", resp.Code, resp.Body.String())
	}

	store2 := &fakeItemStore{
		byColl: []sqlcdb.ListItemsByCollectionRow{{ID: "i", Title: "t", ItemTypeName: "link", Tags: []string{}}},
	}
	api2 := newTestAPI(t, baseDeps(store2), freeUser())
	if resp := api2.Get("/items?type=collection&collectionId=c1"); resp.Code != http.StatusOK {
		t.Fatalf("collection list status = %d; body = %s", resp.Code, resp.Body.String())
	}
}

// decodePage unmarshals a GET /items response into the wire shape, so assertions read the
// real decoded fields rather than substring-matching the JSON.
func decodePage(t *testing.T, resp *httptest.ResponseRecorder) itemsPage {
	t.Helper()
	var got itemsPage
	if err := json.Unmarshal(resp.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode items page: %v; body = %s", err, resp.Body.String())
	}
	return got
}

// recentRows builds n LightItem-shaped recent rows each carrying the given filtered-set total
// (the real query CROSS JOINs the same count onto every row).
func recentRows(n int, total int64) []sqlcdb.ListRecentItemsRow {
	rows := make([]sqlcdb.ListRecentItemsRow, n)
	// classic index range: i is both the write-back position and the row's id suffix.
	for i := range rows {
		rows[i] = sqlcdb.ListRecentItemsRow{
			ID: "id-" + strconv.Itoa(i), Title: "t", ItemTypeName: "snippet", Tags: []string{}, Total: total,
		}
	}
	return rows
}

func TestListLimitIsClampedToPageSize(t *testing.T) {
	t.Parallel()

	// A caller may narrow the page (the dashboard renders 6 of the 20 it used to be forced to
	// fetch) but must never widen it: the store is only ever asked for the clamped size + 1.
	tests := []struct {
		name      string
		query     string
		wantFetch int32
		wantLen   int
	}{
		{name: "absent falls back to the page size", query: "", wantFetch: itemsPageSize + 1, wantLen: itemsPageSize},
		{name: "below the page size is honoured", query: "&limit=6", wantFetch: 7, wantLen: 6},
		{name: "one is honoured", query: "&limit=1", wantFetch: 2, wantLen: 1},
		{
			name:      "exactly the page size is honoured",
			query:     "&limit=20",
			wantFetch: itemsPageSize + 1,
			wantLen:   itemsPageSize,
		},
		{
			name:      "above the page size clamps down",
			query:     "&limit=500",
			wantFetch: itemsPageSize + 1,
			wantLen:   itemsPageSize,
		},
		{
			name:      "zero falls back to the page size",
			query:     "&limit=0",
			wantFetch: itemsPageSize + 1,
			wantLen:   itemsPageSize,
		},
		{
			name:      "negative falls back to the page size",
			query:     "&limit=-5",
			wantFetch: itemsPageSize + 1,
			wantLen:   itemsPageSize,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			// 21 canned rows: more than any clamped page, so the handler always has to slice.
			store := &fakeItemStore{recent: recentRows(itemsPageSize+1, 21)}
			api := newTestAPI(t, baseDeps(store), freeUser())

			resp := api.Get("/items?type=recent" + tc.query)
			if resp.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body = %s", resp.Code, resp.Body.String())
			}
			if store.lastPageLimit != tc.wantFetch {
				t.Errorf("store PageLimit = %d, want %d (clamped size + 1)", store.lastPageLimit, tc.wantFetch)
			}
			if got := decodePage(t, resp); len(got.Items) != tc.wantLen {
				t.Errorf("returned %d items, want %d", len(got.Items), tc.wantLen)
			}
		})
	}
}

func TestListTotalIsTheFilteredSetNotTheLoadedCount(t *testing.T) {
	t.Parallel()

	// total must describe the whole filtered set, so a count badge never claims a user with 57
	// favorites has only the 20 that happen to be loaded. It rides on every row and is
	// identical on every page — including the last one, where it must NOT collapse to len(items).
	tests := []struct {
		name        string
		query       string
		store       *fakeItemStore
		wantTotal   int64
		wantLen     int
		wantHasMore bool
	}{
		{
			name:      "empty set totals zero",
			query:     "/items?type=recent",
			store:     &fakeItemStore{},
			wantTotal: 0,
			wantLen:   0,
		},
		{
			name:      "single page totals the whole set",
			query:     "/items?type=recent",
			store:     &fakeItemStore{recent: recentRows(3, 3)},
			wantTotal: 3,
			wantLen:   3,
		},
		{
			name:        "multi-page total exceeds the loaded page",
			query:       "/items?type=recent",
			store:       &fakeItemStore{recent: recentRows(itemsPageSize+1, 57)},
			wantTotal:   57,
			wantLen:     itemsPageSize,
			wantHasMore: true,
		},
		{
			name:      "last page keeps the full total",
			query:     "/items?type=recent&cursor=id-40",
			store:     &fakeItemStore{recent: recentRows(5, 57)},
			wantTotal: 57,
			wantLen:   5,
		},
		{
			name:      "narrowed page keeps the full total",
			query:     "/items?type=recent&limit=6",
			store:     &fakeItemStore{recent: recentRows(itemsPageSize+1, 57)},
			wantTotal: 57,
			wantLen:   6,
			// 21 canned rows > the 6-item page, so the extra row still signals hasMore.
			wantHasMore: true,
		},
		{
			name:  "total respects the type filter",
			query: "/items?type=type&typeName=snippet",
			store: &fakeItemStore{
				byType: []sqlcdb.ListItemsByTypeRow{
					{ID: "i", Title: "t", ItemTypeName: "snippet", Tags: []string{}, Total: 4},
				},
			},
			wantTotal: 4,
			wantLen:   1,
		},
		{
			name:  "total respects the collection filter",
			query: "/items?type=collection&collectionId=c1",
			store: &fakeItemStore{
				byColl: []sqlcdb.ListItemsByCollectionRow{
					{ID: "i", Title: "t", ItemTypeName: "link", Tags: []string{}, Total: 9},
				},
			},
			wantTotal: 9,
			wantLen:   1,
		},
		{
			name:  "favorites total is the whole favorite set",
			query: "/items?type=favorites",
			store: &fakeItemStore{
				favorites: []sqlcdb.ListFavoriteItemsRow{
					{ID: "f1", Title: "t", ItemTypeName: "note", Tags: []string{}, Total: 57},
				},
			},
			wantTotal: 57,
			wantLen:   1,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			api := newTestAPI(t, baseDeps(tc.store), freeUser())

			resp := api.Get(tc.query)
			if resp.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body = %s", resp.Code, resp.Body.String())
			}
			got := decodePage(t, resp)
			if got.Total != tc.wantTotal {
				t.Errorf("total = %d, want %d", got.Total, tc.wantTotal)
			}
			if len(got.Items) != tc.wantLen {
				t.Errorf("returned %d items, want %d", len(got.Items), tc.wantLen)
			}
			if got.HasMore != tc.wantHasMore {
				t.Errorf("hasMore = %v, want %v", got.HasMore, tc.wantHasMore)
			}
		})
	}
}

// --- get / details / content ---

func TestGetItem(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		store      *fakeItemStore
		wantStatus int
	}{
		{
			name: "found",
			store: &fakeItemStore{getRow: sqlcdb.GetItemByIDRow{
				ID: "i1", Title: "T", ItemTypeName: "snippet",
				Description: new("hello"), Content: new("code"),
				Tags: []string{"go"}, Collections: []byte(`[{"id":"c1","name":"Col"}]`),
			}},
			wantStatus: http.StatusOK,
		},
		{name: "not found is 404", store: &fakeItemStore{getErr: pgx.ErrNoRows}, wantStatus: http.StatusNotFound},
		{
			name:       "other error is 500",
			store:      &fakeItemStore{getErr: pgx.ErrTxClosed},
			wantStatus: http.StatusInternalServerError,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			api := newTestAPI(t, baseDeps(tc.store), freeUser())
			resp := api.Get("/items/i1")
			if resp.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", resp.Code, tc.wantStatus, resp.Body.String())
			}
			if tc.wantStatus == http.StatusOK {
				if b := resp.Body.String(); !strings.Contains(b, `"descriptionPreview":"hello"`) ||
					!strings.Contains(b, `"Col"`) {
					t.Errorf("unexpected body = %s", b)
				}
			}
		})
	}
}

func TestGetDetailsAndContent(t *testing.T) {
	t.Parallel()
	dStore := &fakeItemStore{detailsRow: sqlcdb.GetItemDetailsRow{Description: new("d"), Collections: []byte(`[]`)}}
	if resp := newTestAPI(t, baseDeps(dStore), freeUser()).Get("/items/i1/details"); resp.Code != http.StatusOK {
		t.Fatalf("details status = %d; body = %s", resp.Code, resp.Body.String())
	}
	if resp := newTestAPI(
		t,
		baseDeps(&fakeItemStore{detailsErr: pgx.ErrNoRows}),
		freeUser(),
	).Get("/items/i1/details"); resp.Code != http.StatusNotFound {
		t.Fatalf("details not-found status = %d", resp.Code)
	}

	cStore := &fakeItemStore{contentRow: sqlcdb.GetItemContentRow{Content: new("c"), Language: new("go")}}
	if resp := newTestAPI(t, baseDeps(cStore), freeUser()).Get("/items/i1/content"); resp.Code != http.StatusOK {
		t.Fatalf("content status = %d; body = %s", resp.Code, resp.Body.String())
	}
	if resp := newTestAPI(
		t,
		baseDeps(&fakeItemStore{contentErr: pgx.ErrNoRows}),
		freeUser(),
	).Get("/items/i1/content"); resp.Code != http.StatusNotFound {
		t.Fatalf("content not-found status = %d", resp.Code)
	}
}

// --- create ---

func TestCreateItem(t *testing.T) {
	t.Parallel()
	okRow := sqlcdb.CreateItemRow{ID: "new", Title: "T", ItemTypeName: "snippet", Tags: []string{}}

	tests := []struct {
		name       string
		user       sqlcdb.User
		store      *fakeItemStore
		body       map[string]any
		wantStatus int
	}{
		{
			name:       "success",
			user:       freeUser(),
			store:      &fakeItemStore{createRow: okRow, count: 0},
			body:       map[string]any{"title": "T", "itemTypeName": "snippet", "tags": []string{"go", "go"}},
			wantStatus: http.StatusCreated,
		},
		{
			name:       "pro-only type without pro is 403",
			user:       freeUser(),
			store:      &fakeItemStore{},
			body:       map[string]any{"title": "T", "itemTypeName": "image", "fileUrl": "https://x/y.png"},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "pro user file type hits file-reference 403",
			user:       proUser(),
			store:      &fakeItemStore{},
			body:       map[string]any{"title": "T", "itemTypeName": "image", "fileUrl": "https://x/y.png"},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "free-tier limit is 403",
			user:       freeUser(),
			store:      &fakeItemStore{count: 50},
			body:       map[string]any{"title": "T", "itemTypeName": "snippet"},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "pro bypasses the limit",
			user:       proUser(),
			store:      &fakeItemStore{createRow: okRow, count: 999},
			body:       map[string]any{"title": "T", "itemTypeName": "snippet"},
			wantStatus: http.StatusCreated,
		},
		{
			name:       "link without url is 422",
			user:       freeUser(),
			store:      &fakeItemStore{},
			body:       map[string]any{"title": "T", "itemTypeName": "link"},
			wantStatus: http.StatusUnprocessableEntity,
		},
		{
			name:       "whitespace title is 422",
			user:       freeUser(),
			store:      &fakeItemStore{},
			body:       map[string]any{"title": "   ", "itemTypeName": "snippet"},
			wantStatus: http.StatusUnprocessableEntity,
		},
		{
			name:       "invalid url is 422",
			user:       freeUser(),
			store:      &fakeItemStore{},
			body:       map[string]any{"title": "T", "itemTypeName": "snippet", "url": "not-a-url"},
			wantStatus: http.StatusUnprocessableEntity,
		},
		{
			name:       "unknown type is 500",
			user:       freeUser(),
			store:      &fakeItemStore{createErr: pgx.ErrNoRows},
			body:       map[string]any{"title": "T", "itemTypeName": "widget"},
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			api := newTestAPI(t, baseDeps(tc.store), tc.user)
			resp := api.Post("/items", tc.body)
			if resp.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", resp.Code, tc.wantStatus, resp.Body.String())
			}
			if tc.name == "success" {
				if got := tc.store.lastCreate.Owner; got == nil || *got != testUserID {
					t.Errorf("create owner = %v, want %q (IDOR scope)", got, testUserID)
				}
				// The body sends duplicate tag names ["go","go"]; normalizeTags must de-dup to
				// ["go"] — two equal names in one INSERT ... ON CONFLICT unnest is a hard SQL
				// error (P4-2), so the store must never receive the duplicate.
				if got := tc.store.lastCreate.TagNames; !slices.Equal(got, []string{"go"}) {
					t.Errorf("create tagNames = %v, want [go] (duplicates removed)", got)
				}
				if tc.store.lastCreate.ContentType != sqlcdb.ContentTypeTEXT {
					t.Errorf("contentType = %v, want TEXT", tc.store.lastCreate.ContentType)
				}
			}
		})
	}
}

// --- update ---

func TestUpdateItem(t *testing.T) {
	t.Parallel()
	okUpdate := sqlcdb.UpdateItemRow{Description: new("d"), Tags: []string{}, Collections: []byte(`[]`)}

	tests := []struct {
		name       string
		user       sqlcdb.User
		store      *fakeItemStore
		body       map[string]any
		wantStatus int
		wantTypeID string
	}{
		{
			name: "success keeps current type",
			user: freeUser(),
			store: &fakeItemStore{
				authRow:   sqlcdb.GetItemForAuthRow{ID: "i1", ItemTypeId: "t-snip", ItemTypeName: "snippet"},
				updateRow: okUpdate,
			},
			body:       map[string]any{"title": "New"},
			wantStatus: http.StatusOK,
			wantTypeID: "t-snip",
		},
		{
			name:       "not found is 404",
			user:       freeUser(),
			store:      &fakeItemStore{authErr: pgx.ErrNoRows},
			body:       map[string]any{"title": "New"},
			wantStatus: http.StatusNotFound,
		},
		{
			name: "pro source type without pro is 403",
			user: freeUser(),
			store: &fakeItemStore{
				authRow: sqlcdb.GetItemForAuthRow{ID: "i1", ItemTypeId: "t-img", ItemTypeName: "image"},
			},
			body:       map[string]any{"title": "New"},
			wantStatus: http.StatusForbidden,
		},
		{
			name: "retype of non-text source is 422",
			user: freeUser(),
			store: &fakeItemStore{
				authRow: sqlcdb.GetItemForAuthRow{ID: "i1", ItemTypeId: "t-link", ItemTypeName: "link"},
			},
			body:       map[string]any{"title": "New", "itemTypeName": "snippet"},
			wantStatus: http.StatusUnprocessableEntity,
		},
		{
			name: "retype resolves target type",
			user: freeUser(),
			store: &fakeItemStore{
				authRow:   sqlcdb.GetItemForAuthRow{ID: "i1", ItemTypeId: "t-snip", ItemTypeName: "snippet"},
				typeID:    "t-cmd",
				updateRow: okUpdate,
			},
			body:       map[string]any{"title": "New", "itemTypeName": "command"},
			wantStatus: http.StatusOK,
			wantTypeID: "t-cmd",
		},
		{
			name: "retype target not found is 404",
			user: freeUser(),
			store: &fakeItemStore{
				authRow: sqlcdb.GetItemForAuthRow{ID: "i1", ItemTypeId: "t-snip", ItemTypeName: "snippet"},
				typeErr: pgx.ErrNoRows,
			},
			body:       map[string]any{"title": "New", "itemTypeName": "command"},
			wantStatus: http.StatusNotFound,
		},
		{
			name: "concurrent delete is 404",
			user: freeUser(),
			store: &fakeItemStore{
				authRow:   sqlcdb.GetItemForAuthRow{ID: "i1", ItemTypeId: "t-snip", ItemTypeName: "snippet"},
				updateErr: pgx.ErrNoRows,
			},
			body:       map[string]any{"title": "New"},
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "invalid target type enum is 422",
			user:       freeUser(),
			store:      &fakeItemStore{authRow: sqlcdb.GetItemForAuthRow{ID: "i1", ItemTypeName: "snippet"}},
			body:       map[string]any{"title": "New", "itemTypeName": "link"},
			wantStatus: http.StatusUnprocessableEntity,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			api := newTestAPI(t, baseDeps(tc.store), tc.user)
			resp := api.Patch("/items/i1", tc.body)
			if resp.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", resp.Code, tc.wantStatus, resp.Body.String())
			}
			if tc.wantStatus == http.StatusOK && tc.wantTypeID != "" {
				if tc.store.lastUpdate.ItemTypeID != tc.wantTypeID {
					t.Errorf("update itemTypeID = %q, want %q", tc.store.lastUpdate.ItemTypeID, tc.wantTypeID)
				}
				if tc.store.lastUpdate.Owner != testUserID {
					t.Errorf("update owner = %q, want %q (IDOR scope)", tc.store.lastUpdate.Owner, testUserID)
				}
			}
		})
	}
}

// --- delete / favorite / pinned ---

func TestDeleteItem(t *testing.T) {
	t.Parallel()
	if resp := newTestAPI(
		t,
		baseDeps(&fakeItemStore{deleteN: 1}),
		freeUser(),
	).Delete("/items/i1"); resp.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d; body = %s", resp.Code, resp.Body.String())
	}
	if resp := newTestAPI(
		t,
		baseDeps(&fakeItemStore{deleteN: 0}),
		freeUser(),
	).Delete("/items/i1"); resp.Code != http.StatusNotFound {
		t.Fatalf("delete not-found status = %d", resp.Code)
	}
}

func TestFavoriteAndPinned(t *testing.T) {
	t.Parallel()
	// favorite success + 404
	if resp := newTestAPI(
		t,
		baseDeps(&fakeItemStore{favN: 1}),
		freeUser(),
	).Patch("/items/i1/favorite", map[string]any{"isFavorite": true}); resp.Code != http.StatusNoContent {
		t.Fatalf("favorite status = %d; body = %s", resp.Code, resp.Body.String())
	}
	if resp := newTestAPI(
		t,
		baseDeps(&fakeItemStore{favN: 0}),
		freeUser(),
	).Patch("/items/i1/favorite", map[string]any{"isFavorite": true}); resp.Code != http.StatusNotFound {
		t.Fatalf("favorite not-found status = %d", resp.Code)
	}
	// pinned success + 404
	if resp := newTestAPI(
		t,
		baseDeps(&fakeItemStore{pinN: 1}),
		freeUser(),
	).Patch("/items/i1/pinned", map[string]any{"isPinned": true}); resp.Code != http.StatusNoContent {
		t.Fatalf("pinned status = %d; body = %s", resp.Code, resp.Body.String())
	}
	if resp := newTestAPI(
		t,
		baseDeps(&fakeItemStore{pinN: 0}),
		freeUser(),
	).Patch("/items/i1/pinned", map[string]any{"isPinned": true}); resp.Code != http.StatusNotFound {
		t.Fatalf("pinned not-found status = %d", resp.Code)
	}
}

func TestItemMutationRateLimited(t *testing.T) {
	t.Parallel()
	deps := baseDeps(&fakeItemStore{favN: 1})
	deps.Limiter = fakeLimiter{deny: true}
	api := newTestAPI(t, deps, freeUser())
	resp := api.Patch("/items/i1/favorite", map[string]any{"isFavorite": true})
	if resp.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429; body = %s", resp.Code, resp.Body.String())
	}
}

func TestItemMutationLimiterErrorFailsClosed(t *testing.T) {
	t.Parallel()
	deps := baseDeps(&fakeItemStore{favN: 1})
	deps.Limiter = fakeLimiter{err: pgx.ErrTxClosed}
	deps.Cfg.FailClosed = true
	api := newTestAPI(t, deps, freeUser())
	resp := api.Patch("/items/i1/favorite", map[string]any{"isFavorite": true})
	if resp.Code != http.StatusTooManyRequests {
		t.Fatalf("fail-closed status = %d, want 429; body = %s", resp.Code, resp.Body.String())
	}
}
