module github.com/o-mishch/devstash/backend

go 1.26

toolchain go1.26.5

// Direct dependencies (imported by our own code).
require (
	// Config: parse .env vars into a struct via struct tags.
	github.com/caarlos0/env/v11 v11.4.1
	// HTTP/API framework: OpenAPI generation + RFC 9457 error responses on top of net/http.
	github.com/danielgtaylor/huma/v2 v2.38.0
	// Postgres driver + connection pool (also used by sqlc-generated queries).
	github.com/jackc/pgx/v5 v5.10.0
	// Loads the shared repo-root .env/.env.local into the process environment.
	github.com/joho/godotenv v1.5.1
	// Schema migrations: runs the SQL files in backend/db/migrations.
	github.com/pressly/goose/v3 v3.27.2
	// CLI: builds the single `api` binary with serve/migrate/openapi subcommands.
	github.com/spf13/cobra v1.10.2
)

// Indirect (transitive) dependencies — pulled in by the direct ones above, not imported by us.
require (
	// Cobra helper: keeps a Windows double-click terminal open.
	github.com/inconshreveable/mousetrap v1.1.0 // indirect
	// pgx auth helpers: .pgpass and pg_service.conf parsing.
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	// pgx connection-pool internals.
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	// goose's env-var interpolation in migration files.
	github.com/mfridman/interpolate v0.0.2 // indirect
	// Retry-with-backoff helper (used by goose).
	github.com/sethvargo/go-retry v0.3.0 // indirect
	// Cobra/Viper flag-parsing library.
	github.com/spf13/pflag v1.0.10 // indirect
	// Error aggregation (used by goose).
	go.uber.org/multierr v1.11.0 // indirect
	// errgroup / semaphore primitives.
	golang.org/x/sync v0.22.0 // indirect
	// Unicode text encoding/normalization (transitive).
	golang.org/x/text v0.40.0 // indirect
)

// More direct dependencies imported by our own runtime code (session/OAuth/crypto,
// Redis, rate-limit, email, CORS).
require (
	github.com/alexedwards/scs/goredisstore v0.0.0-20251002162104-209de6e426de
	github.com/alexedwards/scs/v2 v2.9.0
	github.com/go-redis/redis_rate/v10 v10.0.1
	github.com/google/uuid v1.6.0
	github.com/redis/go-redis/v9 v9.21.0
	github.com/resend/resend-go/v2 v2.28.0
	github.com/rs/cors v1.11.1
	golang.org/x/crypto v0.54.0
)

// Test-only direct dependencies: imported solely from _test.go and never compiled into
// the binary. Go has no require-level prod/test split, so they must live in go.mod like
// any other direct dep — grouped here so the runtime graph above stays readable.
require (
	github.com/alicebob/miniredis/v2 v2.38.0 // in-memory Redis (session/token/rate-limit tests)
	github.com/google/go-cmp v0.7.0 // struct/slice diff assertions (cmp.Diff)
	github.com/testcontainers/testcontainers-go v0.43.0 // throwaway Postgres for real-SQL tests
	github.com/testcontainers/testcontainers-go/modules/postgres v0.43.0
)

require golang.org/x/oauth2 v0.36.0

require (
	cloud.google.com/go/compute/metadata v0.3.0 // indirect
	dario.cat/mergo v1.0.2 // indirect
	github.com/Azure/go-ansiterm v0.0.0-20250102033503-faa5f7b0171c // indirect
	github.com/Microsoft/go-winio v0.6.2 // indirect
	github.com/cenkalti/backoff/v4 v4.3.0 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/containerd/errdefs v1.0.0 // indirect
	github.com/containerd/errdefs/pkg v0.3.0 // indirect
	github.com/containerd/log v0.1.0 // indirect
	github.com/containerd/platforms v0.2.1 // indirect
	github.com/cpuguy83/dockercfg v0.3.2 // indirect
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/distribution/reference v0.6.0 // indirect
	github.com/docker/go-connections v0.7.0 // indirect
	github.com/docker/go-units v0.5.0 // indirect
	github.com/ebitengine/purego v0.10.0 // indirect
	github.com/felixge/httpsnoop v1.0.4 // indirect
	github.com/go-logr/logr v1.4.3 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/go-ole/go-ole v1.2.6 // indirect
	github.com/klauspost/compress v1.18.5 // indirect
	github.com/lufia/plan9stats v0.0.0-20211012122336-39d0f177ccd0 // indirect
	github.com/magiconair/properties v1.8.10 // indirect
	github.com/moby/docker-image-spec v1.3.1 // indirect
	github.com/moby/go-archive v0.2.0 // indirect
	github.com/moby/moby/api v1.55.0 // indirect
	github.com/moby/moby/client v0.5.0 // indirect
	github.com/moby/patternmatcher v0.6.1 // indirect
	github.com/moby/sys/sequential v0.6.0 // indirect
	github.com/moby/sys/user v0.4.0 // indirect
	github.com/moby/sys/userns v0.1.0 // indirect
	github.com/moby/term v0.5.2 // indirect
	github.com/opencontainers/go-digest v1.0.0 // indirect
	github.com/opencontainers/image-spec v1.1.1 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	github.com/power-devops/perfstat v0.0.0-20240221224432-82ca36839d55 // indirect
	github.com/shirou/gopsutil/v4 v4.26.5 // indirect
	github.com/sirupsen/logrus v1.9.4 // indirect
	github.com/stretchr/testify v1.11.1 // indirect
	github.com/tklauser/go-sysconf v0.3.16 // indirect
	github.com/tklauser/numcpus v0.11.0 // indirect
	github.com/yuin/gopher-lua v1.1.1 // indirect
	github.com/yusufpapurcu/wmi v1.2.4 // indirect
	go.opentelemetry.io/auto/sdk v1.2.1 // indirect
	go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.68.0 // indirect
	go.opentelemetry.io/otel v1.43.0 // indirect
	go.opentelemetry.io/otel/metric v1.43.0 // indirect
	go.opentelemetry.io/otel/trace v1.43.0 // indirect
	go.uber.org/atomic v1.11.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)
