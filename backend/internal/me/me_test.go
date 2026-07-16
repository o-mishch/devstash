package me

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/jackc/pgx/v5"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
)

// decodePrefs unmarshals a preferences response body.
func decodePrefs(t *testing.T, b []byte) EditorPreferences {
	t.Helper()
	var got EditorPreferences
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("decode prefs: %v (body=%s)", err, b)
	}
	return got
}

func TestGetPreferences(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		store *fakeStore
		want  EditorPreferences
	}{
		{
			name:  "null blob returns defaults",
			store: &fakeStore{prefsBlob: nil},
			want:  defaultPreferences(),
		},
		{
			name:  "empty blob returns defaults",
			store: &fakeStore{prefsBlob: []byte{}},
			want:  defaultPreferences(),
		},
		{
			name: "valid blob is returned",
			store: &fakeStore{prefsBlob: []byte(
				`{"fontSize":18,"tabSize":4,"wordWrap":"on","minimap":true,"appTheme":"aurora",` +
					`"colorMode":"light","editorThemeMode":"auto","uiSkin":"orbital","sidebarCollapsed":true}`)},
			want: EditorPreferences{
				FontSize: 18, TabSize: 4, WordWrap: "on", Minimap: true, AppTheme: "aurora",
				ColorMode: "light", EditorThemeMode: "auto", UISkin: "orbital", SidebarCollapsed: true,
			},
		},
		{
			name: "out-of-range and invalid values clamp to defaults",
			store: &fakeStore{prefsBlob: []byte(
				`{"fontSize":999,"tabSize":0,"wordWrap":"nope","appTheme":"Bad Theme!",` +
					`"colorMode":"neon","editorThemeMode":"???","uiSkin":"made-up"}`)},
			// Every out-of-range/invalid field falls back to its default.
			want: defaultPreferences(),
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			resp := newTestAPI(t, baseDeps(tc.store, &fakeSessions{}), testUser()).Get("/me/preferences")
			if resp.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body = %s", resp.Code, resp.Body.String())
			}
			if diff := cmp.Diff(tc.want, decodePrefs(t, resp.Body.Bytes())); diff != "" {
				t.Errorf("prefs mismatch (-want +got):\n%s", diff)
			}
			if tc.store.lastID != testUserID {
				t.Errorf("owner = %q, want %q (IDOR scope)", tc.store.lastID, testUserID)
			}
		})
	}
}

func TestGetPreferencesStoreError(t *testing.T) {
	t.Parallel()
	store := &fakeStore{prefsErr: pgx.ErrTxClosed}
	resp := newTestAPI(t, baseDeps(store, &fakeSessions{}), testUser()).Get("/me/preferences")
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", resp.Code)
	}
}

func TestUpdatePreferences(t *testing.T) {
	t.Parallel()
	// Current stored prefs the partial patches merge onto.
	current := []byte(
		`{"fontSize":18,"tabSize":4,"wordWrap":"on","minimap":true,"appTheme":"aurora",` +
			`"colorMode":"light","editorThemeMode":"auto","uiSkin":"orbital","sidebarCollapsed":true}`)

	tests := []struct {
		name  string
		blob  []byte
		patch map[string]any
		want  EditorPreferences
	}{
		{
			name:  "partial merge keeps untouched fields",
			blob:  current,
			patch: map[string]any{"fontSize": 22},
			want: EditorPreferences{
				FontSize: 22, TabSize: 4, WordWrap: "on", Minimap: true, AppTheme: "aurora",
				ColorMode: "light", EditorThemeMode: "auto", UISkin: "orbital", SidebarCollapsed: true,
			},
		},
		{
			name:  "false bool is applied (not treated as omitted)",
			blob:  current,
			patch: map[string]any{"minimap": false, "sidebarCollapsed": false},
			want: EditorPreferences{
				FontSize: 18, TabSize: 4, WordWrap: "on", Minimap: false, AppTheme: "aurora",
				ColorMode: "light", EditorThemeMode: "auto", UISkin: "orbital", SidebarCollapsed: false,
			},
		},
		{
			name:  "invalid values clamp to defaults",
			blob:  nil, // start from defaults
			patch: map[string]any{"fontSize": 999, "tabSize": 0, "wordWrap": "nope", "colorMode": "neon"},
			want:  defaultPreferences(),
		},
		{
			name:  "unknown uiSkin falls back to default",
			blob:  nil,
			patch: map[string]any{"uiSkin": "made-up"},
			want:  defaultPreferences(),
		},
		{
			name:  "valid uiSkin is accepted",
			blob:  nil,
			patch: map[string]any{"uiSkin": "neon-grid"},
			want: EditorPreferences{
				FontSize: 14, TabSize: 2, WordWrap: "off", Minimap: false, AppTheme: "modern-minimal",
				ColorMode: "dark", EditorThemeMode: "app", UISkin: "neon-grid", SidebarCollapsed: false,
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			store := &fakeStore{prefsBlob: tc.blob, updatePrefsN: 1}
			resp := newTestAPI(t, baseDeps(store, &fakeSessions{}), testUser()).Patch("/me/preferences", tc.patch)
			if resp.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body = %s", resp.Code, resp.Body.String())
			}
			// Response body matches the normalized merged prefs.
			if diff := cmp.Diff(tc.want, decodePrefs(t, resp.Body.Bytes())); diff != "" {
				t.Errorf("response prefs mismatch (-want +got):\n%s", diff)
			}
			// The persisted blob is the same normalized shape.
			if diff := cmp.Diff(tc.want, decodePrefs(t, store.lastUpdatePrefs.EditorPreferences)); diff != "" {
				t.Errorf("persisted prefs mismatch (-want +got):\n%s", diff)
			}
			// IDOR: both the read and the write are scoped to the session user.
			if store.lastUpdatePrefs.ID != testUserID {
				t.Errorf("write owner = %q, want %q (IDOR scope)", store.lastUpdatePrefs.ID, testUserID)
			}
		})
	}
}

func TestUpdatePreferencesErrors(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		store *fakeStore
	}{
		{name: "read error is 500", store: &fakeStore{prefsErr: pgx.ErrTxClosed}},
		{name: "write error is 500", store: &fakeStore{updatePrefsErr: pgx.ErrTxClosed}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			resp := newTestAPI(t, baseDeps(tc.store, &fakeSessions{}), testUser()).
				Patch("/me/preferences", map[string]any{"fontSize": 16})
			if resp.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500", resp.Code)
			}
		})
	}
}

func TestUpdateProfile(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		body       map[string]any
		nameRow    sqlcdb.UpdateUserNameRow
		wantStatus int
		wantName   *string // captured param written to the store
		wantNil    bool    // expect the written name to be nil (cleared)
	}{
		{
			name:       "sets a trimmed name",
			body:       map[string]any{"name": "  Ada  "},
			nameRow:    sqlcdb.UpdateUserNameRow{Name: new("Ada"), Image: new("img")},
			wantStatus: http.StatusOK,
			wantName:   new("Ada"),
		},
		{
			name:       "empty name clears to null",
			body:       map[string]any{"name": "   "},
			nameRow:    sqlcdb.UpdateUserNameRow{Name: nil},
			wantStatus: http.StatusOK,
			wantNil:    true,
		},
		{
			name:       "null name clears to null",
			body:       map[string]any{"name": nil},
			nameRow:    sqlcdb.UpdateUserNameRow{Name: nil},
			wantStatus: http.StatusOK,
			wantNil:    true,
		},
		{
			name:       "over-long name is 422",
			body:       map[string]any{"name": longName()},
			wantStatus: http.StatusUnprocessableEntity,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			store := &fakeStore{nameRow: tc.nameRow}
			resp := newTestAPI(t, baseDeps(store, &fakeSessions{}), testUser()).Patch("/me/profile", tc.body)
			if resp.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", resp.Code, tc.wantStatus, resp.Body.String())
			}
			if tc.wantStatus != http.StatusOK {
				return
			}
			if store.lastNameParams.ID != testUserID {
				t.Errorf("owner = %q, want %q (IDOR scope)", store.lastNameParams.ID, testUserID)
			}
			got := store.lastNameParams.Name
			switch {
			case tc.wantNil:
				if got != nil {
					t.Errorf("written name = %q, want nil (cleared)", *got)
				}
			case tc.wantName != nil:
				if got == nil || *got != *tc.wantName {
					t.Errorf("written name = %v, want %q", got, *tc.wantName)
				}
			}
		})
	}
}

// longName returns a 101-character name (one over the 100-char bound).
func longName() string {
	b := make([]rune, userNameMaxChars+1)
	for i := range b {
		b[i] = 'a'
	}
	return string(b)
}

func TestUpdateProfileStoreError(t *testing.T) {
	t.Parallel()
	store := &fakeStore{nameErr: pgx.ErrTxClosed}
	resp := newTestAPI(t, baseDeps(store, &fakeSessions{}), testUser()).
		Patch("/me/profile", map[string]any{"name": "Ada"})
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", resp.Code)
	}
}

func TestDeleteAccount(t *testing.T) {
	t.Parallel()
	t.Run("happy path deletes and destroys the session", func(t *testing.T) {
		t.Parallel()
		store := &fakeStore{deleteN: 1}
		sessions := &fakeSessions{}
		resp := newTestAPI(t, baseDeps(store, sessions), testUser()).Delete("/me")
		if resp.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
		}
		if store.lastID != testUserID {
			t.Errorf("delete owner = %q, want %q (IDOR scope)", store.lastID, testUserID)
		}
		if !sessions.destroyed {
			t.Error("session was not destroyed after account delete")
		}
	})

	t.Run("delete error is 500", func(t *testing.T) {
		t.Parallel()
		store := &fakeStore{deleteErr: pgx.ErrTxClosed}
		sessions := &fakeSessions{}
		resp := newTestAPI(t, baseDeps(store, sessions), testUser()).Delete("/me")
		if resp.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", resp.Code)
		}
		if sessions.destroyed {
			t.Error("session must not be destroyed when the delete failed")
		}
	})

	t.Run("destroy failure still returns 204", func(t *testing.T) {
		t.Parallel()
		store := &fakeStore{deleteN: 1}
		sessions := &fakeSessions{destroyErr: pgx.ErrTxClosed}
		resp := newTestAPI(t, baseDeps(store, sessions), testUser()).Delete("/me")
		if resp.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204 (delete succeeded, destroy degraded)", resp.Code)
		}
	})
}

func TestStats(t *testing.T) {
	t.Parallel()
	store := &fakeStore{
		totalItems: 12, favItems: 3, totalColls: 5, favColls: 1,
		typeCounts: []sqlcdb.GetItemTypeCountsByUserRow{
			{Name: "snippet", Count: 7},
			{Name: "prompt", Count: 0},
			{Name: "note", Count: 5},
		},
	}
	resp := newTestAPI(t, baseDeps(store, &fakeSessions{}), testUser()).Get("/stats")
	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", resp.Code, resp.Body.String())
	}

	var got struct {
		TotalItems          int64           `json:"totalItems"`
		FavoriteItems       int64           `json:"favoriteItems"`
		TotalCollections    int64           `json:"totalCollections"`
		FavoriteCollections int64           `json:"favoriteCollections"`
		ItemTypeCounts      []itemTypeCount `json:"itemTypeCounts"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode stats: %v (body=%s)", err, resp.Body.String())
	}

	if got.TotalItems != 12 || got.FavoriteItems != 3 || got.TotalCollections != 5 ||
		got.FavoriteCollections != 1 {
		t.Errorf("totals mismatch: %+v", got)
	}
	wantCounts := []itemTypeCount{
		{Name: "snippet", Count: 7},
		{Name: "prompt", Count: 0},
		{Name: "note", Count: 5},
	}
	if diff := cmp.Diff(wantCounts, got.ItemTypeCounts); diff != "" {
		t.Errorf("itemTypeCounts mismatch (-want +got):\n%s", diff)
	}
	if store.lastID != testUserID {
		t.Errorf("owner = %q, want %q (IDOR scope)", store.lastID, testUserID)
	}
}

func TestStatsError(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		store *fakeStore
	}{
		{name: "count items error", store: &fakeStore{totalItemsErr: pgx.ErrTxClosed}},
		{name: "fav items error", store: &fakeStore{favItemsErr: pgx.ErrTxClosed}},
		{name: "count collections error", store: &fakeStore{totalCollsErr: pgx.ErrTxClosed}},
		{name: "fav collections error", store: &fakeStore{favCollsErr: pgx.ErrTxClosed}},
		{name: "type counts error", store: &fakeStore{typeCountsErr: pgx.ErrTxClosed}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			resp := newTestAPI(t, baseDeps(tc.store, &fakeSessions{}), testUser()).Get("/stats")
			if resp.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500", resp.Code)
			}
		})
	}
}
