# docker buildx bake definition for the DevStash CI image build.
#
# WHY bake (not two `docker buildx build` calls): both images share the `deps`
# and (for web) `builder` stages. Two separate builds re-resolve and re-import
# that shared graph from the registry every run; one bake session computes the
# shared DAG once and builds the `web` and `migrate` targets CONCURRENTLY. Digest
# extraction is unchanged — bake writes a per-target `containerimage.digest` to
# the --metadata-file, keyed by target name (see build-push.sh).
#
# Cache lives in the GitHub Actions cache backend (type=gha), NOT Artifact Registry.
# WHY: type=registry,mode=max pushed a ~900 MB :buildcache blob PER image into GAR.
# That blob is tagged (so no untagged cleanup policy touches it) and rewritten every
# build (so it never ages out of a keep-young window) — ~1.8 GB of cache no cleanup
# policy can ever evict, which was the entire Artifact Registry bill. type=gha stores
# the same mode=max cache in GitHub's own cache (10 GB/repo, free, LRU-evicted),
# leaving GAR holding only the runtime images → deduped storage fits the 0.5 GB free
# tier → $0. This bake file is invoked ONLY by CI (build-push.sh); nothing else shares
# the cache, so there is no non-GitHub builder to keep on a registry cache.
#
# type=gha needs ACTIONS_RUNTIME_TOKEN / ACTIONS_CACHE_URL / ACTIONS_RESULTS_URL in
# the environment. docker/build-push-action injects these automatically; our plain
# `run:` script does not, so the workflow runs crazy-max/ghaction-github-runtime just
# before build-push.sh to export them (see .github/workflows/deploy-gke.yml).
#
# Scopes keep the two targets' caches separate but cross-readable: migrate reads web's
# scope so the shared `deps` stage warms it, and writes its unique layers to its own.
#
# Invoked from repo root by infra/ci/build-push.sh, which exports the variables
# below. Validate a change without building:
#   IMAGE_URI=a MIGRATE_URI=b GITHUB_SHA=c \
#     docker buildx bake -f infra/ci/docker-bake.hcl --print

# Full runtime (web) image path WITHOUT tag, e.g. <region>-docker.pkg.dev/<proj>/<repo>/web
variable "IMAGE_URI" {}
# Full migrator image path WITHOUT tag, e.g. .../migrate
variable "MIGRATE_URI" {}
# Commit SHA — the immutable per-build tag. Deploys resolve by the registry digest, not this
# tag; the SHA tag is a human-readable convenience. We deliberately DO NOT also push :latest —
# it is a mutable pointer nothing here consumes (the rendered Deployment is digest-pinned, the
# pruner keeps by digest), so it only adds tag churn the pruner must reconcile and a
# non-deterministic ref for any out-of-band `docker pull`. SHA tag + digest are sufficient.
variable "GITHUB_SHA" {}

group "default" {
  targets = ["web", "migrate"]
}

# ---- web: runtime image (default last stage = runner) ----------------------
target "web" {
  context    = "."
  dockerfile = "Dockerfile"
  tags = [
    "${IMAGE_URI}:${GITHUB_SHA}",
  ]
  cache-from = ["type=gha,scope=web"]
  # mode=max caches all intermediate stages (deps + builder), not just the final layers.
  cache-to = ["type=gha,scope=web,mode=max"]
  output   = ["type=registry"]
}

# ---- migrate: one-shot migrator image (--target migrator) ------------------
target "migrate" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "migrator"
  tags = [
    "${MIGRATE_URI}:${GITHUB_SHA}",
  ]
  # Import the web cache too: the migrator no longer copies web's `deps` node_modules
  # (it runs its own lean `npm ci --omit=dev`), but it still shares the base node:alpine
  # + libc6-compat layers, so reading web's scope warms those. The migrator's own layers
  # (lean install, prisma generate, seed files) are written to its own scope — the web
  # scope is read-only here (no cache-to for scope=web).
  cache-from = [
    "type=gha,scope=web",
    "type=gha,scope=migrate",
  ]
  cache-to = ["type=gha,scope=migrate,mode=max"]
  output   = ["type=registry"]
}
