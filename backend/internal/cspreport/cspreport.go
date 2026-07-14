// Package cspreport ingests Content-Security-Policy violation reports delivered by the
// browser Reporting API (the `report-to` directive + `Reporting-Endpoints` header the
// SPA ships). The static Firebase-hosted SPA can't receive these POSTs itself, so it
// points the reporting group at this Cloud Run endpoint (cross-origin from beta. → api.;
// the CORS/CSRF layer already trusts that origin).
//
// It is deliberately public (no session — the browser sends reports out-of-band,
// unauthenticated) and write-only telemetry: it parses the report best-effort, logs the
// salient fields, and returns 204. It never touches the datastore. Because it is public,
// an IP-keyed rate-limit budget caps log-flooding by a hostile client.
package cspreport

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"slices"

	"github.com/danielgtaylor/huma/v2"

	"github.com/o-mishch/devstash/backend/internal/middleware"
	"github.com/o-mishch/devstash/backend/internal/ratelimit"
)

// maxReportBytes bounds the payload the endpoint will read. Reports are small; the cap
// keeps a hostile client from streaming an unbounded body into the log pipeline. Huma
// rejects anything larger with a 413 before the handler runs.
const maxReportBytes int64 = 32 * 1024

// tooManyMessage mirrors the opaque 429 the other rate-limited domains return.
const tooManyMessage = "Too many attempts. Please try again in a moment."

// Config carries the non-secret settings the handler needs.
type Config struct {
	// FailClosed makes the rate limiter deny on a Redis outage (429) instead of allowing
	// through. Mirrors auth/items Config.FailClosed (RATE_LIMIT_FAIL_OPEN inverts it in dev)
	// — an internet-facing deploy never silently drops the flood guard on this public op.
	FailClosed bool
}

// Deps are the collaborators a cspreport Service is built from. Exported constructor input
// (Register/New take it), embedded verbatim in Service.
type Deps struct {
	Limiter ratelimit.Limiter
	Logger  *slog.Logger
	Cfg     Config
}

// Service owns the CSP-report operation's behaviour over its injected collaborators.
type Service struct {
	Deps
}

// New builds a Service from its dependencies.
func New(d Deps) *Service {
	return &Service{Deps: d}
}

// reportEnvelope is one entry of an `application/reports+json` array (Reporting API v1).
// Only the fields worth logging are modelled; unknown fields are ignored by encoding/json.
type reportEnvelope struct {
	Type string        `json:"type"`
	URL  string        `json:"url"`
	Body cspReportBody `json:"body"`
}

// cspReportBody is the `body` of a `csp-violation` report (the Reporting API shape, which
// uses camelCase keys — distinct from the legacy `application/csp-report` hyphenated keys).
type cspReportBody struct {
	DocumentURL        string `json:"documentURL"`
	BlockedURL         string `json:"blockedURL"`
	EffectiveDirective string `json:"effectiveDirective"`
	Disposition        string `json:"disposition"`
	SourceFile         string `json:"sourceFile"`
	LineNumber         int    `json:"lineNumber"`
}

// Register wires POST /csp-report onto the API. It is on the public allowlist
// (security_guard_test.go) because reports arrive without a session.
func Register(api huma.API, d Deps) {
	s := New(d)
	huma.Register(api, huma.Operation{
		OperationID: "csp-report",
		Method:      http.MethodPost,
		Path:        "/csp-report",
		Summary:     "Ingest CSP violation reports",
		Description: "Best-effort sink for browser Content-Security-Policy violation reports " +
			"(Reporting API `report-to`). Rate-limited per IP; logs and discards; never reads a " +
			"session or the database.",
		Tags:          []string{"system"},
		DefaultStatus: http.StatusNoContent,
		MaxBodyBytes:  maxReportBytes,
	}, func(ctx context.Context, input *struct {
		// RawBody (no Body field) bypasses JSON binding so the non-standard
		// `application/reports+json` content type is accepted and parsed by hand.
		RawBody []byte `contentType:"application/reports+json"`
	},
	) (*struct{}, error) {
		if err := s.enforceRateLimit(ctx); err != nil {
			return nil, err
		}

		var reports []reportEnvelope
		parseErr := json.Unmarshal(input.RawBody, &reports)
		if parseErr != nil {
			// Non-array / unexpected shape: don't fail the browser's fire-and-forget POST,
			// just record that something unparseable arrived.
			s.Logger.WarnContext(ctx, "csp-report: unparseable payload", "bytes", len(input.RawBody), "err", parseErr)
			return &struct{}{}, nil
		}
		for report := range slices.Values(reports) {
			// A Reporting endpoint can be shared by other report types; only CSP here.
			if report.Type != "" && report.Type != "csp-violation" {
				continue
			}
			s.Logger.WarnContext(
				ctx, "csp violation",
				"documentURL", report.Body.DocumentURL,
				"blockedURL", report.Body.BlockedURL,
				"directive", report.Body.EffectiveDirective,
				"disposition", report.Body.Disposition,
				"sourceFile", report.Body.SourceFile,
				"line", report.Body.LineNumber,
			)
		}
		return &struct{}{}, nil
	})
}

// enforceRateLimit spends one BucketCSPReport token for the connecting IP (resolved by the
// ClientIP middleware). On a Redis outage it fails closed (429) unless Cfg.FailClosed is
// false (local dev only), matching the auth/items limiter posture.
func (s *Service) enforceRateLimit(ctx context.Context) error {
	ip := middleware.RemoteIP(ctx)
	dec, err := s.Limiter.Allow(ctx, ratelimit.BucketCSPReport, ip)
	if err != nil {
		if s.Cfg.FailClosed {
			s.Logger.ErrorContext(ctx, "csp-report rate limiter unavailable, failing closed", "err", err)
			return huma.Error429TooManyRequests(tooManyMessage)
		}
		s.Logger.WarnContext(ctx, "csp-report rate limiter unavailable, failing open", "err", err)
		return nil
	}
	if !dec.Allowed {
		return huma.Error429TooManyRequests(tooManyMessage)
	}
	return nil
}
