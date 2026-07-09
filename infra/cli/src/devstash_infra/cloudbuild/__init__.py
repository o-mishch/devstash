"""cloudbuild/ — 3.14 floor. Runs on cloud-sdk:slim's bundled Cloud SDK Python.

The 6 auto-suspend step entrypoints, run as `python3 -m devstash_infra.cloudbuild <step>` (the
`python3` being gcloud's bundled interpreter, located via `gcloud info`) on google/cloud-sdk:slim.

Import rule: the standard library, `shared/`, AND the vendored set gcloud ships under
`lib/third_party` (requests, python-hcl2, jsonschema, kubernetes) — made importable by the
`ensure_on_path()` call below (see shared/third_party.py). Never import typer, pydantic,
structlog, or any CLI-side module (models/, gcp/, app_*, obs.py, signals.py) — those are neither
on the image nor part of this path.
"""

from devstash_infra.shared.third_party import ensure_on_path

# On the image this appends gcloud's lib/third_party so the vendored libs import; off-image
# (dev/CI) it is a no-op and the same libs come from the `vendored` dependency-group. Runs at
# package import, before any step submodule imports `requests` et al.
ensure_on_path()
