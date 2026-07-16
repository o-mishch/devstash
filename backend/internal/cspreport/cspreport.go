// Package cspreport ingests Content-Security-Policy violation reports delivered by the
// browser Reporting API (the `report-to` directive + `Reporting-Endpoints` header the
// SPA ships) and by the legacy CSP2 `report-uri` directive (Firefox). The static
// Firebase-hosted SPA can't receive these POSTs itself, so it points the reporting group
// at this Cloud Run endpoint — cross-origin from beta. → api., which means the CORS/CSRF
// layer, not this handler, decides whether a report arrives at all. That it does is proven
// by transport_test.go against the real middleware (prod's ALLOWED_ORIGINS is exactly the
// SPA origin), rather than assumed here: the reporting POST is cross-site and
// state-changing, so CrossOriginProtection would otherwise be free to 403 the whole
// telemetry path with every handler test still green.
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

// maxReportEntries bounds how many VIOLATIONS of one array are logged (the handler filters to
// `csp-violation` first, so this counts the thing that actually reaches the log, not raw array
// entries). The rate-limit budget (BucketCSPReport, 30/1m per IP) is spent per REQUEST, but the
// handler emits one log line per VIOLATION — so without this cap the two budgets are decoupled
// by ~3 orders of magnitude: maxReportBytes bounds bytes read, not lines written, and a single
// 30KB body of `[{"type":"csp-violation"},…]` packs ~10^3 entries → ~10^3 lines for one token,
// ~3*10^4 lines/min per IP. Capping violations re-couples the flood guard to the thing it
// actually guards. A real browser is expected to batch only a handful of reports per POST, so
// 10 should never truncate a legitimate payload — but that is an assumption about client
// behaviour, not a guarantee, so truncation is logged (once per request, bounded) rather than
// silent. A cap that hides its own misfires would destroy the evidence that it is set too low.
const maxReportEntries = 10

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

// legacyReport is the CSP2 `report-uri` shape: a SINGLE object with HYPHENATED keys, posted
// as `application/csp-report`. The SPA's policy ships `report-uri` alongside `report-to`
// because Firefox still honours only the former — so this shape is not hypothetical, it is
// what every Firefox client sends. Parsing only the modern reports+json array would push all
// of them down the "unparseable" path: a spent rate-limit token and a log line with zero
// diagnostic value.
type legacyReport struct {
	CSPReport struct {
		DocumentURI string `json:"document-uri"`
		BlockedURI  string `json:"blocked-uri"`
		// `violated-directive` is the historic name for the same value; current Firefox sends
		// `effective-directive`, but an older UA may send only the former. Without the
		// fallback below such a report still logs — with the single most useful field blank.
		EffectiveDirective string `json:"effective-directive"`
		ViolatedDirective  string `json:"violated-directive"`
		SourceFile         string `json:"source-file"`
		LineNumber         int    `json:"line-number"`
	} `json:"csp-report"`
}

// toBody folds a legacy report onto the modern body shape so both transports converge on one
// log call with identical field names. The CSP2 shape carries no `disposition` (that field is
// Reporting-API-only), so it stays empty rather than being invented. ok is false when the
// payload unmarshalled cleanly but is not actually a report — an arbitrary JSON object (e.g.
// `{"not":"an-array"}`) decodes into this struct as all-zero, and must stay "unparseable"
// rather than be logged as an empty violation.
func (l legacyReport) toBody() (cspReportBody, bool) {
	r := l.CSPReport
	directive := r.EffectiveDirective
	if directive == "" {
		directive = r.ViolatedDirective
	}
	if r.DocumentURI == "" && r.BlockedURI == "" && directive == "" {
		return cspReportBody{}, false
	}
	return cspReportBody{
		DocumentURL:        r.DocumentURI,
		BlockedURL:         r.BlockedURI,
		EffectiveDirective: directive,
		SourceFile:         r.SourceFile,
		LineNumber:         r.LineNumber,
	}, true
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
			// Not the modern reports+json array — try the legacy CSP2 `report-uri` object
			// (Firefox) before giving up.
			var legacy legacyReport
			if legacyErr := json.Unmarshal(input.RawBody, &legacy); legacyErr == nil {
				if body, ok := legacy.toBody(); ok {
					s.logViolation(ctx, body)
					return &struct{}{}, nil
				}
			}
			// Neither shape parsed: don't fail the browser's fire-and-forget POST, just
			// record that something unparseable arrived.
			s.Logger.WarnContext(ctx, "csp-report: unparseable payload", "bytes", len(input.RawBody), "err", parseErr)
			return &struct{}{}, nil
		}
		// A Reporting endpoint can be shared by other report types; only CSP here. The match
		// is strict: a type-less entry (`{}`) is not a violation, it is filler. Filtering
		// BEFORE the cap is what makes the cap exact — capping the raw entries would count
		// filler against the budget and let ten junk entries bury the one real violation
		// behind them.
		violations := slices.DeleteFunc(reports, func(r reportEnvelope) bool {
			return r.Type != "csp-violation"
		})
		// Log at most maxReportEntries — see the const: the rate limiter charges per request,
		// this loop writes per violation, so the cap is what keeps one token from buying a
		// flood. One bounded line when the cap bites, so a cap set too low is visible instead
		// of silently eating the reports it was meant to bound.
		if len(violations) > maxReportEntries {
			s.Logger.WarnContext(ctx, "csp-report: entries truncated",
				"violations", len(violations), "logged", maxReportEntries)
		}
		for report := range slices.Values(violations[:min(len(violations), maxReportEntries)]) {
			s.logViolation(ctx, report.Body)
		}
		return &struct{}{}, nil
	})
}

// logViolation writes the one violation log line. Both transports (the modern reports+json
// array and the legacy CSP2 `report-uri` object) funnel through here, so the emitted field
// names are identical regardless of which shape the browser chose to send.
func (s *Service) logViolation(ctx context.Context, b cspReportBody) {
	s.Logger.WarnContext(
		ctx, "csp violation",
		"documentURL", b.DocumentURL,
		"blockedURL", b.BlockedURL,
		"directive", b.EffectiveDirective,
		"disposition", b.Disposition,
		"sourceFile", b.SourceFile,
		"line", b.LineNumber,
	)
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
