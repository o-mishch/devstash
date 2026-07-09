"""clients/tofu.py — a typed OpenTofu client. CLI zone (3.14).

OpenTofu is a CLI (no Python SDK, and we keep control for the argv-exact + custom-lifecycle
incident fixes), so this stays subprocess — but it is a CLOSED, typed surface: one explicit
method per used subcommand, NO `*args`, NO generic passthrough. Each method takes typed keyword
params and builds its OWN argv inline (mirroring the `Gcloud` facade's shape), so the two clients
read the same way — a flag is a keyword, its rendering sits right beside it.

Error contract: READ ops (`output_json`, `state_list`, `state_show`) are tolerant — an empty /
absent result is normal, so they return a parsed value. MUTATING ops (`plan`, `apply`, `destroy`,
`import_`, `state_rm`, `force_unlock`) are lock-aware (route through `state_lock.tofu_locked` with
the injected `recover`) and RAISE `ProcError` on non-recoverable failure — replacing the old
`LockedRun = Callable[..., Result]` seam and the scattered `if not result.ok` checks.

Incident fixes encoded in the SIGNATURE, not raw flag strings:
- #2 `output_json` runs `output -json`, never `-raw` (the #26991 box poisons `-raw`).
- #3 `destroy` has NO `exclude` parameter — the multiflag no-op bug can't be expressed here.
- #7 `plan` retries `-refresh=false` ONLY on the vanished-resource 404 signature.
"""

import re
from collections.abc import Callable, Sequence

from devstash_infra import state_lock
from devstash_infra.common import warn
from devstash_infra.models.tofu import TofuOutputs
from devstash_infra.shared import proc
from devstash_infra.shared.proc import ProcError, Result

type Recover = Callable[[], bool]

# [fix #7] The refresh-time out-of-band-deletion signature. The provider phrases a vanished-
# resource 404 a few ways; retry -refresh=false ONLY on THIS — any other plan failure propagates.
_REFRESH_404_RE = re.compile(
    r"does not exist|was not found|Error 404|instanceDoesNotExist|resourceNotFound",
    re.IGNORECASE,
)


def _no_recover() -> bool:
    """Default recovery: none (a lock failure re-propagates). The app injects the real probe."""
    return False


class Tofu:
    """`tofu -chdir=<tf_dir> …`, lock-aware. `recover` is the guided state-lock recovery."""

    def __init__(self, tf_dir: str, *, recover: Recover = _no_recover) -> None:
        self._tf_dir = tf_dir
        self._recover = recover

    @property
    def tf_dir(self) -> str:
        return self._tf_dir

    def set_recover(self, recover: Recover) -> None:
        """Wire the guided state-lock recovery AFTER construction.

        The recovery collaborator needs THIS client to force-unlock, so `recover` can't be passed
        at construction (a chicken-and-egg cycle). The boundary builds the recovery over a SEPARATE
        non-recovering Tofu (`_no_recover`) and then wires it here — that separation is what keeps a
        lock error during recovery's own `force_unlock` from re-entering recovery (infinite loop).
        """
        self._recover = recover

    def _argv(self, subcommand: str, args: list[str]) -> list[str]:
        return ["tofu", f"-chdir={self._tf_dir}", subcommand, *args]

    def _locked(self, subcommand: str, args: list[str]) -> Result:
        """Run a mutating op through the lock/network recovery, returning its Result."""
        argv = self._argv(subcommand, args)

        def _run() -> Result:
            return proc.long_running(argv)

        return state_lock.tofu_locked(_run, self._recover)

    def _raise_unless_ok(self, result: Result) -> None:
        if not result.ok:
            raise ProcError(result)

    # ── reads (tolerant) ─────────────────────────────────────────────────────
    def init(self, backend_bucket: str) -> None:
        """`init -backend-config=bucket=<b>` — initialise the remote backend. Raises on failure."""
        proc.run(self._argv("init", [f"-backend-config=bucket={backend_bucket}"]))

    def output_json(self) -> TofuOutputs:
        """Parse `tofu output -json` [#2] — never `-raw` (the #26991 box poisons `-raw`).

        Empty/output-less state → `{}` → an empty TofuOutputs (every read falls back), so this is
        tolerant: it never raises on a fresh/destroyed/suspended state.
        """
        result = proc.run(self._argv("output", ["-json"]), check=False)
        if result.ok and result.stdout.strip():
            return TofuOutputs.model_validate_json(result.stdout)
        return TofuOutputs({})  # non-zero OR empty stdout → treat as output-less state

    def state_list(self, address: str) -> list[str]:
        """`state list <address>` — tracked addresses matching `address` ("" → all). Tolerant."""
        result = proc.run(self._argv("state", ["list", address]), check=False)
        return result.out.splitlines() if result.ok else []

    def state_show(self, address: str) -> str:
        """`state show <address>` — the resource's state text, or "" if untracked. Tolerant."""
        result = proc.run(self._argv("state", ["show", address]), check=False)
        return result.stdout if result.ok else ""

    # ── mutations (lock-aware, raise on failure) ─────────────────────────────
    def plan(
        self,
        *,
        out: str = "",
        lock_timeout: str = "",
        refresh: bool = True,
        destroy: bool = False,
        replace: Sequence[str] = (),
        targets: Sequence[str] = (),
    ) -> None:
        """`plan` per the flags; on a refresh-time 404 retry ONCE with `-refresh=false` [#7].

        A refreshless plan trusts state over reality, so we pay that cost ONLY when a refresh is
        provably impossible (the resource vanished out-of-band); any other failure propagates.
        `replace`/`targets` fold the reconcile targets into THIS plan so they're reviewed first.
        """

        def _argv(*, refresh_flag: bool) -> list[str]:
            argv: list[str] = []
            if lock_timeout:
                argv.append(f"-lock-timeout={lock_timeout}")
            if not refresh_flag:
                argv.append("-refresh=false")
            if destroy:
                argv.append("-destroy")
            argv.extend(f"-replace={address}" for address in replace)
            argv.extend(f"-target={target}" for target in targets)
            if out:
                argv.append(f"-out={out}")
            return argv

        result = self._locked("plan", _argv(refresh_flag=refresh))
        if result.ok:
            return
        if _REFRESH_404_RE.search(f"{result.stdout}\n{result.stderr}"):
            warn("Plan hit a refresh-time 404 — a state-tracked resource was deleted out-of-band.")
            warn("Retrying with -refresh=false (plans against state alone; stale entry destroys).")
            result = self._locked("plan", _argv(refresh_flag=False))
        self._raise_unless_ok(result)

    def apply(
        self,
        *,
        plan_file: str = "",
        lock_timeout: str = "",
        auto_approve: bool = False,
        refresh: bool = True,
        targets: Sequence[str] = (),
    ) -> None:
        """`apply` a SAVED PLAN (`plan_file`) or a TARGETED apply (`auto_approve`/`targets` — the
        deletion-protection reconcile), lock-aware + interrupt-safe [#13]. Raises on failure.
        """
        argv: list[str] = []
        if lock_timeout:
            argv.append(f"-lock-timeout={lock_timeout}")
        if auto_approve:
            argv.append("-auto-approve")
        if not refresh:
            argv.append("-refresh=false")
        argv.extend(f"-target={target}" for target in targets)
        if plan_file:
            argv.append(plan_file)
        self._raise_unless_ok(self._locked("apply", argv))

    def destroy(
        self, *, auto_approve: bool = False, refresh: bool = True, targets: Sequence[str] = ()
    ) -> None:
        """`destroy` per the flags, lock-aware. Raises `ProcError` on failure.

        There is DELIBERATELY NO `exclude` parameter [#3]: 2+ `-exclude` flags silently no-op the
        whole destroy (OpenTofu 1.12.3), so the bug is unrepresentable here — down() shelves the
        protected resources out of state instead (see gcp teardown). The teardown catches this and
        inspects `exc.result.stdout` for the PSC-still-attached signature [#8] — no exit-code peek.
        """
        argv: list[str] = []
        if auto_approve:
            argv.append("-auto-approve")
        if not refresh:
            argv.append("-refresh=false")
        argv.extend(f"-target={target}" for target in targets)
        self._raise_unless_ok(self._locked("destroy", argv))

    def import_(self, address: str, import_id: str, *, lock_timeout: str = "") -> None:
        """`import [-lock-timeout=…] <address> <id>` — adopt an existing resource. Raises."""
        args = ([f"-lock-timeout={lock_timeout}"] if lock_timeout else []) + [address, import_id]
        self._raise_unless_ok(self._locked("import", args))

    def state_rm(self, address: str) -> None:
        """`state rm <address>` — drop from state WITHOUT touching the cloud object. Raises."""
        self._raise_unless_ok(self._locked("state", ["rm", address]))

    def force_unlock(self, lock_id: str) -> None:
        """`force-unlock -force <lock_id>` — release a stuck state lock [#1: the GCS generation,
        never the JSON UUID — the caller resolves `lock_id`]. Raises `ProcError` on failure.
        """
        self._raise_unless_ok(self._locked("force-unlock", ["-force", lock_id]))
