"""shared/third_party.py — make gcloud's vendored libraries importable on the image.

3.14 floor, stdlib-only. The pinned `cloud-sdk:slim` image ships a set of third-party
libraries under gcloud's PRIVATE `lib/third_party` dir (requests, python-hcl2, jsonschema,
kubernetes, …). They are NOT on the bundled interpreter's default `sys.path` — gcloud injects
them only when it runs its own commands. The `cloudbuild/` steps opt into that set so they can
use richer libraries on the image with ZERO install (the copies are already there).

`ensure_on_path()` runs once when the `cloudbuild` package is imported (see cloudbuild/__init__).
It locates `lib/third_party` by walking up from the running interpreter — which naturally
distinguishes the two environments and needs no subprocess:
  - On the image the interpreter lives under `.../google-cloud-sdk/platform/bundledpythonunix`,
    so the walk finds `<sdk_root>/lib/third_party` and appends it.
  - On a dev/CI machine the interpreter is the uv-managed venv (not under google-cloud-sdk), so
    the walk finds nothing and this is a no-op — there the same libraries are installed normally
    via the `vendored` dependency-group, pinned to the exact versions gcloud vendors (no skew).

The dir is APPENDED, never prepended: gcloud's tree also contains names that shadow the stdlib
(e.g. `ipaddress`), so it must lose to the stdlib and to any installed package and only ever
resolve a name nothing else provides (like `requests`).
"""

import sys
from pathlib import Path

# gcloud lays its SDK out as <sdk_root>/platform/bundledpythonunix/bin/python3 and
# <sdk_root>/lib/third_party; the install dir is always named `google-cloud-sdk`.
_SDK_DIR_NAME = "google-cloud-sdk"


def locate_third_party() -> Path | None:
    """Return the image's `lib/third_party` dir, or None when not on the cloud-sdk image."""
    for parent in Path(sys.executable).resolve().parents:
        if parent.name == _SDK_DIR_NAME:
            third_party = parent / "lib" / "third_party"
            return third_party if third_party.is_dir() else None
    return None


def ensure_on_path() -> None:
    """Append gcloud's `lib/third_party` to `sys.path` on the image; no-op elsewhere. Idempotent."""
    third_party = locate_third_party()
    if third_party is not None:
        entry = str(third_party)
        if entry not in sys.path:
            sys.path.append(entry)
