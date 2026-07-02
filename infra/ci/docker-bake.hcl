# docker buildx bake definition for the DevStash CI image build.
#
# WHY bake (not two `docker buildx build` calls): both images share the `deps`
# and (for web) `builder` stages. Two separate builds re-resolve and re-import
# that shared graph from the registry every run; one bake session computes the
# shared DAG once and builds the `web` and `migrate` targets CONCURRENTLY. Digest
# extraction is unchanged — bake writes a per-target `containerimage.digest` to
# the --metadata-file, keyed by target name (see build-push.sh).
#
# Cache stays on the Artifact Registry backend (type=registry) the project already
# uses — each image owns its own :buildcache tag, so no new CI dependency is added
# and the cache remains shareable with non-GitHub builders (e.g. run.sh). To move
# to the GitHub Actions cache (type=gha) later, the raw `run:` step must first
# expose ACTIONS_RUNTIME_TOKEN / ACTIONS_CACHE_URL (docker/build-push-action does
# this automatically; a plain script needs an action such as
# crazy-max/ghaction-github-runtime).
#
# Invoked from repo root by infra/ci/build-push.sh, which exports the variables
# below. Validate a change without building:
#   IMAGE_URI=a MIGRATE_URI=b GITHUB_SHA=c \
#     docker buildx bake -f infra/ci/docker-bake.hcl --print

# Full runtime (web) image path WITHOUT tag, e.g. <region>-docker.pkg.dev/<proj>/<repo>/web
variable "IMAGE_URI" {}
# Full migrator image path WITHOUT tag, e.g. .../migrate
variable "MIGRATE_URI" {}
# Commit SHA — the immutable per-build tag (alongside :latest). Deploys resolve by
# the registry digest, not this tag; the tag is a human-readable convenience.
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
    "${IMAGE_URI}:latest",
  ]
  cache-from = ["type=registry,ref=${IMAGE_URI}:buildcache"]
  # mode=max caches all intermediate stages (deps + builder), not just the final layers.
  cache-to = ["type=registry,ref=${IMAGE_URI}:buildcache,mode=max"]
  output   = ["type=registry"]
}

# ---- migrate: one-shot migrator image (--target migrator) ------------------
target "migrate" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "migrator"
  tags = [
    "${MIGRATE_URI}:${GITHUB_SHA}",
    "${MIGRATE_URI}:latest",
  ]
  # Import the web cache too: the migrator shares the `deps` stage with web, so the
  # web build's cache warms migrate's deps. The migrator's own unique layers (prisma
  # generate in the migrator stage, seed files) are written to its own :buildcache
  # tag — the web cache is read-only here (no cache-to for IMAGE_URI).
  cache-from = [
    "type=registry,ref=${IMAGE_URI}:buildcache",
    "type=registry,ref=${MIGRATE_URI}:buildcache",
  ]
  cache-to = ["type=registry,ref=${MIGRATE_URI}:buildcache,mode=max"]
  output   = ["type=registry"]
}
