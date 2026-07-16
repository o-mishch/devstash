package me

import (
	"context"
	"maps"
	"math"
	"net/http"
	"slices"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5/pgtype"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// activityWindowDays is the contiguous window (~12 weeks) the mission-control heatmap renders.
const activityWindowDays = 84

// maxActivityLevel is the top intensity bucket a day's count maps to (levels run 0–4).
const maxActivityLevel = 4

// isoDate is the YYYY-MM-DD layout used for both the wire `date` and the day-count map key.
const isoDate = "2006-01-02"

// activityDay is one day in the dashboard-activity series (DashboardActivityDay wire shape).
type activityDay struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
	Level int    `json:"level"`
}

// activityOutput is the GET /stats/activity response: a contiguous 84-day item-creation series
// ending today, mirroring the legacy getDashboardActivity.
type activityOutput struct {
	Body struct {
		Days []activityDay `json:"days"`
	}
}

// registerActivity wires GET /stats/activity — per-day item-creation counts for the ~12-week
// contribution heatmap, scoped by the session user.
func registerActivity(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "get-activity",
		Method:      http.MethodGet,
		Path:        "/stats/activity",
		Summary:     "Get the current user's per-day item-creation activity",
		Tags:        []string{tagMe},
		Security:    secured(),
	}, func(ctx context.Context, _ *struct{}) (*activityOutput, error) {
		userID, _ := middleware.CurrentUserID(ctx)

		// Anchor the SQL lower bound and the Go series to one clock — today as a UTC calendar
		// date — so a DB-vs-app clock skew across UTC midnight can't drop the most-recent day.
		n := s.Now().UTC()
		todayUTC := time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC)
		windowStart := todayUTC.AddDate(0, 0, -(activityWindowDays - 1))

		rows, err := s.Store.GetDashboardActivity(ctx, sqlcdb.GetDashboardActivityParams{
			Owner:       userID,
			WindowStart: pgtype.Date{Time: windowStart, Valid: true},
		})
		if err != nil {
			s.Logger.ErrorContext(ctx, "me: dashboard activity query failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}

		out := &activityOutput{}
		out.Body.Days = buildActivitySeries(rows, todayUTC)
		return out, nil
	})
}

// buildActivitySeries turns the sparse per-day rows into the contiguous 84-day series ending
// todayUTC, zero-filling missing days and bucketing each day's level 0–4 relative to the
// busiest day in the window.
func buildActivitySeries(rows []sqlcdb.GetDashboardActivityRow, todayUTC time.Time) []activityDay {
	countByDate := make(map[string]int, len(rows))
	for row := range slices.Values(rows) {
		countByDate[row.Day.Time.Format(isoDate)] = int(row.Count)
	}

	maxCount := 0
	for c := range maps.Values(countByDate) {
		maxCount = max(maxCount, c)
	}

	days := make([]activityDay, activityWindowDays)
	for i := range activityWindowDays {
		d := todayUTC.AddDate(0, 0, -(activityWindowDays - 1 - i))
		date := d.Format(isoDate)
		count := countByDate[date]
		days[i] = activityDay{Date: date, Count: count, Level: activityLevel(count, maxCount)}
	}
	return days
}

// activityLevel buckets a day's count into a 0–4 intensity relative to the busiest day in the
// window (mirrors the legacy activityLevel: 0 when empty, else ceil(count/max * 4) capped at 4).
func activityLevel(count, maxCount int) int {
	if count == 0 || maxCount == 0 {
		return 0
	}
	return min(maxActivityLevel, int(math.Ceil(float64(count)/float64(maxCount)*maxActivityLevel)))
}
