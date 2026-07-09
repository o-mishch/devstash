"""clients/tofu_local.py — a typed facade over `tofu` for the local kind cluster. CLI zone (3.14).

The local stack provisions its kind cluster through OpenTofu (envs/local) so a `down` destroys
exactly what `up` created — state-tracked, unlike a bare `kind create`. That env uses the LOCAL-FILE
backend (state path supplied at `init` via a partial backend-config) and a `cluster_active` var — a
different contract from the GCS-backed `clients/tofu.py` (which hardcodes `-backend-config=bucket=`
and has no `-var`). Rather than overload that client, this is a small dedicated facade; apply +
destroy go through `proc.long_running` so a Ctrl-C forwards to tofu and it persists state [#13].
"""

from pathlib import Path

from devstash_infra.shared import proc
from devstash_infra.shared.proc import ProcError, Result


class LocalTofu:
    """`tofu -chdir=<tf_dir> …` against the local-file backend, state at `state_path`."""

    def __init__(self, tf_dir: str, state_path: Path) -> None:
        self._tf_dir = tf_dir
        self._state_path = state_path

    @property
    def state_exists(self) -> bool:
        """True iff the local state file is present — `down` skips a never-provisioned cluster."""
        return self._state_path.is_file()

    def _argv(self, subcommand: str, args: list[str]) -> list[str]:
        return ["tofu", f"-chdir={self._tf_dir}", subcommand, *args]

    def _raise_unless_ok(self, result: Result) -> None:
        if not result.ok:
            raise ProcError(result)

    def init(self) -> None:
        """`init -input=false -backend-config=path=<abs state path>`. Raises on failure.

        The local-file backend leaves `path` unset in backend.tf (a partial backend-config), so
        apply and destroy must both init with the same absolute path first — it lives here once.
        """
        abs_path = self._state_path.resolve()
        proc.run(self._argv("init", ["-input=false", f"-backend-config=path={abs_path}"]))

    def apply(self, *, cluster_active: bool) -> None:
        """`apply -input=false -auto-approve -var cluster_active=<bool>` — interrupt-safe [#13]."""
        flag = "true" if cluster_active else "false"
        self._raise_unless_ok(
            proc.long_running(
                self._argv(
                    "apply", ["-input=false", "-auto-approve", "-var", f"cluster_active={flag}"]
                )
            )
        )

    def destroy(self) -> None:
        """`destroy -input=false -auto-approve` — interrupt-safe [#13]. Raises on failure."""
        self._raise_unless_ok(
            proc.long_running(self._argv("destroy", ["-input=false", "-auto-approve"]))
        )
