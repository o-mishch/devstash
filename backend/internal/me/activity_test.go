package me

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
)

// activityToday is the UTC calendar date testNow falls on — the series anchor the handler
// derives from the injected clock.
var activityToday = time.Date(2026, time.July, 16, 0, 0, 0, 0, time.UTC)

// activityRow builds a canned per-day count row as the sqlc query would return it (Day at UTC
// midnight, as Postgres yields for a ::date column).
func activityRow(date time.Time, count int32) sqlcdb.GetDashboardActivityRow {
	return sqlcdb.GetDashboardActivityRow{Day: pgtype.Date{Time: date, Valid: true}, Count: count}
}

// dayOffset is the ISO date n days from activityToday (negative = earlier).
func dayOffset(n int) string {
	return activityToday.AddDate(0, 0, n).Format(isoDate)
}

func decodeActivity(t *testing.T, b []byte) []activityDay {
	t.Helper()
	var got struct {
		Days []activityDay `json:"days"`
	}
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("decode activity: %v (body=%s)", err, b)
	}
	return got.Days
}

func TestActivity(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		rows []sqlcdb.GetDashboardActivityRow
		// want spot-checks specific series indices; every case also asserts the shared invariants.
		want map[int]activityDay
	}{
		{
			name: "empty rows yield a zero-filled contiguous series",
			rows: nil,
			want: map[int]activityDay{
				0:  {Date: dayOffset(-83), Count: 0, Level: 0},
				83: {Date: dayOffset(0), Count: 0, Level: 0},
			},
		},
		{
			name: "counts zero-fill and bucket into levels 0-4 relative to the busiest day",
			rows: []sqlcdb.GetDashboardActivityRow{
				activityRow(activityToday, 8),                    // today, busiest → ceil(8/8*4)=4
				activityRow(activityToday.AddDate(0, 0, -1), 2),  // → ceil(2/8*4)=1
				activityRow(activityToday.AddDate(0, 0, -6), 4),  // → ceil(4/8*4)=2
				activityRow(activityToday.AddDate(0, 0, -83), 1), // window start → ceil(1/8*4)=1
			},
			want: map[int]activityDay{
				83: {Date: dayOffset(0), Count: 8, Level: 4},
				82: {Date: dayOffset(-1), Count: 2, Level: 1},
				77: {Date: dayOffset(-6), Count: 4, Level: 2},
				50: {Date: dayOffset(-33), Count: 0, Level: 0}, // an untouched day is zero-filled
				0:  {Date: dayOffset(-83), Count: 1, Level: 1},
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			store := &fakeStore{activity: tc.rows}
			resp := newTestAPI(t, baseDeps(store, &fakeSessions{}), testUser()).Get("/stats/activity")
			if resp.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body = %s", resp.Code, resp.Body.String())
			}
			days := decodeActivity(t, resp.Body.Bytes())

			// The series is always a contiguous 84-day window ending today, ascending one
			// calendar day at a time with no gaps.
			if len(days) != activityWindowDays {
				t.Fatalf("len(days) = %d, want %d", len(days), activityWindowDays)
			}
			for i := range days {
				wantDate := dayOffset(-(activityWindowDays - 1 - i))
				if days[i].Date != wantDate {
					t.Errorf("days[%d].Date = %q, want %q (non-contiguous series)", i, days[i].Date, wantDate)
				}
			}
			for idx, want := range tc.want {
				if diff := cmp.Diff(want, days[idx]); diff != "" {
					t.Errorf("days[%d] mismatch (-want +got):\n%s", idx, diff)
				}
			}

			// IDOR + window: the query is scoped to the session user and its lower bound is
			// anchored to todayUTC - 83 days.
			if store.lastActivityArgs.Owner != testUserID {
				t.Errorf("owner = %q, want %q (IDOR scope)", store.lastActivityArgs.Owner, testUserID)
			}
			wantStart := activityToday.AddDate(0, 0, -(activityWindowDays - 1))
			if !store.lastActivityArgs.WindowStart.Valid ||
				!store.lastActivityArgs.WindowStart.Time.Equal(wantStart) {
				t.Errorf("window start = %+v, want %v", store.lastActivityArgs.WindowStart, wantStart)
			}
		})
	}
}

func TestActivityError(t *testing.T) {
	t.Parallel()
	store := &fakeStore{activityErr: pgx.ErrTxClosed}
	resp := newTestAPI(t, baseDeps(store, &fakeSessions{}), testUser()).Get("/stats/activity")
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", resp.Code)
	}
}
