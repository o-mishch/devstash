#!/usr/bin/env python3
"""Assert the pinned Cloud Build image's BUNDLED Cloud SDK python matches the 3.14 floor.

WHY THIS EXISTS: the floor version has silently drifted before (3.11 -> 3.13 when the
`cloud_sdk_image` pin in auto-suspend.tf moved to a Debian 13 / trixie build) — nothing
caught it because the floor-mypy pass targeted a LOWER version and the import-smoke only
checked importability, not the interpreter version. This guard closes that gap.

The auto-suspend step shims do NOT run the image's *system* python3 (Debian's, 3.13);
they run gcloud's BUNDLED Cloud SDK Python (a complete, relocatable CPython — 3.14.5 at
the current pin), located at runtime via `gcloud info`. That bundled interpreter is the
one the ported `shared/`+`cloudbuild/` code executes on, so it is the version that must
match the declared floor. This guard pulls the EXACT pinned digest, discovers the bundled
python the same way the shims do, and fails CI if its version no longer equals the floor.

Declared floor lives in (keep these in lockstep — this script is the enforcement):
  - infra/cli/pyproject.toml  (`requires-python`, ruff `target-version`)
  - infra/cli/src/devstash_infra/shared/__init__.py  (the HARD RULE docstring)
  - infra/cli/src/devstash_infra/cli.py  (the runtime floor assertion)

Stdlib-only, no deps — runs with a bare `python3`. Needs docker on PATH (pulls the
pinned image on first run). Intended for the Python CI gate (wired at cutover) and
ad-hoc local runs: `python3 infra/cli/scripts/check_floor_drift.py`.
"""

import re
import subprocess
import sys
from pathlib import Path

# The floor the whole `shared/`+`cloudbuild/` tree (and the rest of the package) targets.
EXPECTED_FLOOR = "3.14"

# infra/cli/scripts/check_floor_drift.py -> repo-relative auto-suspend.tf holding the pin.
AUTO_SUSPEND_TF = (
    Path(__file__).resolve().parents[2] / "terraform" / "envs" / "dev" / "auto-suspend.tf"
)
_IMAGE_RE = re.compile(r'cloud_sdk_image\s*=\s*"([^"]+)"')
_VERSION_RE = re.compile(r"Python\s+(\d+\.\d+)")

# The auto-suspend shims locate the bundled interpreter exactly this way, so the guard
# checks the SAME interpreter the ported steps actually run on (not the system python3).
_LOCATE_AND_VERSION = (
    "py=\"$(gcloud info --format='value(basic.python_location)')\"; "
    'test -n "$py" || { echo "gcloud info returned no python_location" >&2; exit 3; }; '
    '"$py" --version'
)

# The vendored libs the cloudbuild path opts into (shared/third_party.py), pinned to the
# `vendored` dependency-group in pyproject.toml. gcloud ships these under lib/third_party;
# a re-pin that drops/renames one would silently break the auto-suspend path (requests is a
# real runtime dependency of the guard step), so this guard asserts they still import at the
# expected versions in the pinned image. Keep in lockstep with pyproject's `vendored` group.
# Values are the pyproject `vendored`-group pins (single source of truth). The image reports the
# same strings EXCEPT `kubernetes`, whose image build carries a `-snapshot` suffix on the 10.0.0
# release — `_same_version` normalizes that suffix so the two agree without a hardcoded snapshot
# label drifting from the pyproject pin (see the comment on `kubernetes==10.0.0` in pyproject.toml).
_EXPECTED_VENDORED = {
    "requests": "2.32.3",
    "hcl2": "4.3.2",
    "jsonschema": "2.6.0",
    "kubernetes": "10.0.0",
}


def _same_version(expected: str, found: str) -> bool:
    """Compare two version strings, ignoring a `-snapshot` suffix on either side."""
    return expected.removesuffix("-snapshot") == found.removesuffix("-snapshot")


# Locate the bundled interpreter + gcloud's lib/third_party (the same way the shim does), then
# import each vendored lib and print `name=version`. Heredoc avoids nested-quote escaping.
_VERIFY_VENDORED = (
    "py=\"$(gcloud info --format='value(basic.python_location)')\"; "
    "root=\"$(gcloud info --format='value(installation.sdk_root)')\"; "
    'PYTHONPATH="$root/lib/third_party" "$py" - <<\'PYEOF\'\n'
    "import importlib\n"
    'for name in ("requests", "hcl2", "jsonschema", "kubernetes"):\n'
    "    mod = importlib.import_module(name)\n"
    "    print(f\"{name}={getattr(mod, '__version__', '?')}\")\n"
    "PYEOF\n"
)


def pinned_image() -> str:
    """Return the digest-pinned cloud-sdk image reference from auto-suspend.tf."""
    match = _IMAGE_RE.search(AUTO_SUSPEND_TF.read_text(encoding="utf-8"))
    if not match:
        raise SystemExit(f'could not find `cloud_sdk_image = "..."` in {AUTO_SUSPEND_TF}')
    return match.group(1)


def bundled_python_minor(image: str) -> str:
    """Return the image's BUNDLED Cloud SDK python MAJOR.MINOR (e.g. '3.14'), under docker.

    Discovers the interpreter via `gcloud info` — the same locator the shims use — then
    runs its `--version`, so drift in the bundled python (a gcloud SDK bump) is caught.
    """
    proc = subprocess.run(
        ["docker", "run", "--rm", image, "sh", "-c", _LOCATE_AND_VERSION],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise SystemExit(
            f"locating/running the bundled python in {image} failed:\n{proc.stderr.strip()}"
        )
    match = _VERSION_RE.search(proc.stdout) or _VERSION_RE.search(proc.stderr)
    if not match:
        raise SystemExit(f"could not parse a Python version from: {proc.stdout!r} {proc.stderr!r}")
    return match.group(1)


def vendored_versions(image: str) -> dict[str, str]:
    """Return {import_name: version} for the vendored libs, as seen in the pinned image."""
    proc = subprocess.run(
        ["docker", "run", "--rm", image, "sh", "-c", _VERIFY_VENDORED],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise SystemExit(
            f"importing the vendored libs from lib/third_party in {image} failed "
            f"(a lib may have been dropped/renamed by a re-pin):\n{proc.stderr.strip()}"
        )
    found: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        name, _, version = line.partition("=")
        if name:
            found[name.strip()] = version.strip()
    return found


def check_vendored(image: str) -> None:
    """Assert each `vendored`-group lib imports at its expected version in the pinned image."""
    found = vendored_versions(image)
    drift = {
        name: (expected, found.get(name, "<missing>"))
        for name, expected in _EXPECTED_VENDORED.items()
        if not _same_version(expected, found.get(name, "<missing>"))
    }
    if drift:
        raise SystemExit(
            f"VENDORED-LIB DRIFT in the pinned image\n  {image}\n"
            f"{
                '\n'.join(
                    f'  {n}: expected {exp}, image has {act}' for n, (exp, act) in drift.items()
                )
            }\n"
            "Re-pin to an image with the expected versions, or update `vendored` in "
            "pyproject.toml AND _EXPECTED_VENDORED here (and re-run `uv lock`)."
        )
    print(
        "OK: vendored libs match — " + ", ".join(f"{n}={v}" for n, v in _EXPECTED_VENDORED.items())
    )


def main() -> None:
    image = pinned_image()
    found = bundled_python_minor(image)
    if found != EXPECTED_FLOOR:
        raise SystemExit(
            f"FLOOR DRIFT: declared floor is Python {EXPECTED_FLOOR}, but the pinned image\n"
            f"  {image}\n"
            f"ships a bundled Cloud SDK python {found}. Either re-pin `cloud_sdk_image` to an "
            f"image whose bundled python is {EXPECTED_FLOOR}, or update the declared floor "
            f"everywhere (pyproject.toml, shared/__init__.py, cli.py, and EXPECTED_FLOOR here)."
        )
    print(f"OK: pinned image's bundled python {found} matches the declared {EXPECTED_FLOOR} floor.")
    check_vendored(image)


if __name__ == "__main__":
    sys.exit(main())
