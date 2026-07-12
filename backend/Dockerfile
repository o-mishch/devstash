# syntax=docker/dockerfile:1
# Floating minor tag (not a digest) so patch/alpine rebuilds are picked up automatically.
FROM golang:1.26-alpine AS builder

WORKDIR /app

# Cache dependencies separately from source
COPY go.mod go.sum ./
RUN go mod download

# Copy source and build the single binary. -trimpath strips local filesystem paths
# for reproducible builds (and keeps them out of the binary/panics); -mod=readonly
# refuses to mutate go.mod/go.sum during the build (matches CI's readonly posture).
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -mod=readonly -trimpath -ldflags="-s -w" -o /api ./cmd/api

# ─── Runtime image ────────────────────────────────────────────────────────────
# distroless/static ships CA certificates, tzdata, and a nonroot /etc/passwd entry,
# and contains no shell or package manager — smaller, and a smaller attack surface,
# than alpine + manual apk/adduser. The :nonroot tag runs as uid 65532 by default.
# Requires a fully static binary, which CGO_ENABLED=0 in the build stage guarantees.
FROM gcr.io/distroless/static-debian12:nonroot

# Migrations are embedded in the binary (backend/db/embed.go), so no .sql files
# are copied here — `api migrate up` works from the self-contained binary alone.
COPY --from=builder /api /api

# Cloud Run injects PORT; the default matches local dev.
ENV PORT=8080
EXPOSE 8080

# No Docker HEALTHCHECK: distroless has no shell for wget, and Cloud Run uses its
# own startup/liveness probes against /health rather than the image HEALTHCHECK.
ENTRYPOINT ["/api"]
CMD ["serve"]
