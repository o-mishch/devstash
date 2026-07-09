"""shared/ — 3.14 floor, stdlib-only.

Imported by both the operator CLI and the Cloud Build auto-suspend path. The
auto-suspend steps run on google/cloud-sdk:slim, invoking its BUNDLED Cloud SDK
Python (3.14.5, located via `gcloud info --format='value(basic.python_location)'`)
with ZERO install — so the whole codebase shares one 3.14 floor. (The image's
*system* python3 is 3.13; we deliberately run the newer bundled interpreter that
gcloud ships, which is a complete, relocatable CPython with the full stdlib.)

HARD RULE: modules under this package import ONLY the Python standard library and
each other. No typer, no pydantic, no structlog, no third-party anything. This is
NOT because the image has nothing else — its bundled interpreter ships real
site-packages (cryptography, grpcio, typing_extensions, …), and gcloud vendors more
under lib/third_party (requests, hcl2, kubernetes — not even importable without
gcloud's own PYTHONPATH). It is because this code is imported by BOTH environments:
the operator CLI (dev/CI = plain CPython + this package's declared deps) and the
Cloud Build path (the image's bundled interpreter + gcloud's site-packages). Their
INTERSECTION is exactly the stdlib — the CLI deps aren't on the image, and the
image's bundled packages aren't on the dev interpreter where pytest/mypy exercise
this code. So stdlib is the only surface guaranteed in both; anything else breaks
import somewhere it runs or is tested, and a leak breaks the unattended auto-suspend
build silently until a real suspend fires. 3.14 syntax is permitted (the floor IS
3.14). Enforced by: the import-grep guard, the cloud-sdk:slim image import-smoke run
under the bundled interpreter, and scripts/check_floor_drift.py (which asserts the
pinned image's bundled python is still 3.14).
"""
