"""cloudbuild/__main__.py — `python3 -m devstash_infra.cloudbuild <step>` dispatch. 3.14 floor.

The single entrypoint the six auto-suspend `/bin/sh` shims call (replacing the standalone
auto-suspend-*.sh scripts). Stdlib-only: it configures the floor JSON logger, parses the build
environment ONCE, dispatches to the named step, and catches every `InfraError` at this ONE boundary
— deep code raises and never calls sys.exit mid-teardown (exceptions-to-boundary).

Step 4 (`suspend`) runs on cloud-sdk:slim with the digest-pinned static tofu binary copied into
/workspace/bin by the tofu-bin extract step (Option 4); this entrypoint prepends that dir to PATH so
`tofu` resolves for the apply/reconcile/force-unlock subprocess calls.
"""

import os
import sys
from collections.abc import Callable, Sequence

from devstash_infra.cloudbuild.cleanup_builds import cleanup_builds
from devstash_infra.cloudbuild.cleanup_negs import cleanup_negs
from devstash_infra.cloudbuild.dump_step import dump_step
from devstash_infra.cloudbuild.env import TOFU_BIN_DIR, BuildEnv
from devstash_infra.cloudbuild.guard import guard
from devstash_infra.cloudbuild.prepare import prepare
from devstash_infra.cloudbuild.suspend_step import suspend_step
from devstash_infra.shared.errors import InfraError
from devstash_infra.shared.log import configure

# Step id (auto-suspend.tf) -> handler. The ids match the Terraform `step { id = … }` values so the
# shim invocation `python3 -m devstash_infra.cloudbuild <id>` reads 1:1 with the build definition.
_STEPS: dict[str, Callable[[BuildEnv], None]] = {
    "guard": guard,
    "prepare": prepare,
    "dump": dump_step,
    "suspend": suspend_step,
    "cleanup-builds": cleanup_builds,
    "cleanup-negs": cleanup_negs,
}


def _ensure_tofu_on_path() -> None:
    """Prepend /workspace/bin (the pinned tofu binary, Option 4) to PATH, idempotently."""
    bin_dir = str(TOFU_BIN_DIR)
    path = os.environ.get("PATH", "")
    if bin_dir not in path.split(os.pathsep):
        os.environ["PATH"] = f"{bin_dir}{os.pathsep}{path}" if path else bin_dir


def main(argv: Sequence[str] | None = None) -> int:
    """Dispatch one auto-suspend step; return its process exit code."""
    args = list(sys.argv[1:] if argv is None else argv)
    # run_id read straight from env (not the parsed BuildEnv) so an env parse error still logs it.
    run_id = os.environ.get("_BUILD_ID") or os.environ.get("BUILD_ID") or "unknown"
    log = configure(run_id)

    if not args:
        log.error("usage: python -m devstash_infra.cloudbuild <step> (%s)", ", ".join(_STEPS))
        return 2
    handler = _STEPS.get(args[0])
    if handler is None:
        log.error("unknown auto-suspend step %r (expected one of: %s)", args[0], ", ".join(_STEPS))
        return 2

    try:
        env = BuildEnv.from_environ(os.environ)
        if args[0] == "suspend":
            _ensure_tofu_on_path()
        handler(env)
    except InfraError as exc:
        # A deliberate typed failure — log its operator-facing message, NOT a traceback (the whole
        # point of exceptions-to-boundary: the message is the signal, a stack trace is noise).
        log.error("%s", exc.message)  # noqa: TRY400 — message, not logging.exception's traceback
        return exc.exit_code
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
