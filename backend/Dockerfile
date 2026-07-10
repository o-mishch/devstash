# syntax=docker/dockerfile:1
FROM golang:1.26-alpine AS builder

WORKDIR /app

# Cache dependencies separately from source
COPY go.mod go.sum ./
RUN go mod download

# Copy source and build the single binary. -trimpath strips local filesystem
# paths for reproducible builds (and keeps them out of the binary/panics).
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /api ./cmd/api

# ─── Runtime image ────────────────────────────────────────────────────────────
FROM alpine:3.21

RUN apk add --no-cache ca-certificates tzdata

# Run as a non-root user — the process needs no root privileges at runtime.
RUN adduser -D -H -u 10001 appuser

WORKDIR /app

COPY --from=builder /api /app/api
USER appuser
# Migrations are embedded in the binary (backend/db/embed.go), so no .sql files
# are copied here — `api migrate up` works from the self-contained binary alone.

# Cloud Run injects PORT; the default matches local dev.
ENV PORT=8080
EXPOSE 8080

# Health check — Cloud Run uses its own startup/liveness probes, not CMD.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

ENTRYPOINT ["/app/api"]
CMD ["serve"]
