"""clients/gh.py — a typed facade over the GitHub CLI (`gh`). CLI zone (3.14).

`secrets` pushes CI's auth secrets + public config to the repo's GitHub Actions store; this is the
transport for that. Two stores, two contracts:
- **Secrets** (`gh secret …`) hold the deployer SA / WIF provider. The value is fed on **stdin**
  (`gh secret set` reads stdin when `--body` is omitted — there is no `--body-file` flag), never
  argv, so a credential never lands in the process list — the same never-in-argv discipline as
  `gcloud secrets versions add --data-file=-`.
- **Variables** (`gh variable …`) hold NON-secret public config (project id, app domain). GitHub
  masks any value defined as a secret ANYWHERE, which would blank the image-URI job outputs that
  embed the project id — so this config MUST be a variable, and its value in argv is fine.

Reads parse `gh … --json` in Python (not gh's `-q` jq engine) so extraction is typed and testable.
Presence is checked by value fetch, never `list` exit status: `gh variable/secret list` exits 0 on
an empty store, so only a per-name read proves a value landed (the write half exits 0 even on a
silent no-op). docker/tofu-style closed surface: one method per used verb, argv asserted in tests.
"""

import json
from typing import ReadOnly, TypedDict, cast

from devstash_infra.shared import proc


class _NamedValue(TypedDict, total=False):
    name: ReadOnly[str]
    value: ReadOnly[str]


class Gh:
    """`gh …` — GitHub Actions secret + variable reads/writes for the current repo."""

    def authenticated(self) -> bool:
        """True iff `gh` has a valid auth session (`gh auth status`). Tolerant probe → bool.

        The boundary maps a False to the shell's `die "gh CLI not authenticated — run: gh auth
        login"`; kept a pure predicate here so the client never prints.
        """
        return proc.run_ok(["gh", "auth", "status"])

    def secret_set(self, name: str, value: str) -> None:
        """Set repo Actions secret `name`, value read from stdin (no `--body`). Raises.

        `gh secret set` reads the value from stdin whenever `--body` is omitted (there is no
        `--body-file` flag). Feeding it on stdin — never argv — keeps a credential out of the
        process list, mirroring the `gcloud secrets versions add --data-file=-` discipline.
        """
        proc.run(["gh", "secret", "set", name], input=value)

    def secret_delete(self, name: str) -> None:
        """Best-effort delete repo Actions secret `name` — tolerant of a not-found (the `|| true`).

        Idempotent cleanup of a stale secret (e.g. a GCP_PROJECT_ID left from before it became a
        variable, which would keep GitHub masking the image-URI job outputs).
        """
        proc.run_ok(["gh", "secret", "delete", name])

    def variable_set(self, name: str, value: str) -> None:
        """Set repo Actions variable `name` to `value` (non-secret public config). Raises.

        Value in argv is deliberate: a variable is public config, and GitHub would mask any value
        that is ALSO a secret — so this store, not the secret store, is where CI's image-URI-safe
        config must live.
        """
        proc.run(["gh", "variable", "set", name, "--body", value])

    def variable_delete(self, name: str) -> None:
        """Best-effort delete repo Actions variable `name` — tolerant of a not-found (`|| true`).

        Clearing a disabled feature toggle (Cloud Armor / Binary Authorization) so the CI step that
        keys off the variable's presence self-skips instead of reading a stale value.
        """
        proc.run_ok(["gh", "variable", "delete", name])

    def secret_names(self) -> list[str]:
        """Names of every repo Actions secret (`gh secret list --json name`). Tolerant → [].

        JSON, not table text — column-aligned output could cause a false miss in the presence check.
        """
        result = proc.run(["gh", "secret", "list", "--json", "name"], check=False)
        if not result.ok:
            return []
        return [name for row in _rows(result.out) if (name := row.get("name"))]

    def variable_value(self, name: str) -> str:
        """Value of repo Actions variable `name`, or "" if absent. Tolerant → "".

        `gh variable list` exits 0 even when the variable is missing, so a per-name value fetch is
        the only reliable presence check.
        """
        result = proc.run(["gh", "variable", "list", "--json", "name,value"], check=False)
        if not result.ok:
            return ""
        for row in _rows(result.out):
            if row.get("name") == name:
                return row.get("value", "")
        return ""

    # ── deploy-gke workflow run dispatch / watch (deploy / smoke / resume overlap) ─
    def latest_deploy_run_id(self) -> str:
        """DatabaseId of the most recent deploy-gke.yml run, or "" (tolerant). Ports the shared
        `_latest_deploy_run_id` incantation.

        `gh workflow run` does not return the dispatched run's id, so a caller snapshots this BEFORE
        dispatch and polls for a strictly-newer one after. Parsed in Python (not gh's `-q`) so the
        int databaseId is extracted typed; tolerant → "" so a bare read can't fail the caller.
        """
        result = proc.run(
            [
                "gh",
                "run",
                "list",
                "--workflow",
                "deploy-gke.yml",
                "--limit",
                "1",
                "--json",
                "databaseId",
            ],
            check=False,
        )
        if not result.ok:
            return ""
        return _first_database_id(result.out)

    def workflow_run(self, *, provision: bool = False) -> None:
        """Dispatch deploy-gke.yml (`gh workflow run`). Raises on a failed dispatch.

        `provision=True` adds `-f reason=provision` so CI's gate job builds even though the cluster
        does not exist yet (a resume/up pre-dispatch overlapping `apply`); without it the gate falls
        back to the live-cluster check (a deploy against an already-active env).
        """
        argv = ["gh", "workflow", "run", "deploy-gke.yml"]
        if provision:
            argv += ["-f", "reason=provision"]
        proc.run(argv)

    def run_watch(self, run_id: str) -> bool:
        """Block on run `run_id` until it finishes; True iff it SUCCEEDED (`gh run watch
        --exit-status`). Tolerant → False on a failed/uncertain run.
        """
        return proc.run_ok(["gh", "run", "watch", run_id, "--exit-status"])

    def run_status(self, run_id: str) -> str:
        """Status of run `run_id` (`queued`/`in_progress`/`completed`), or "" (tolerant).

        The cancel-trap reads this to tell whether the pre-dispatched run is still in flight before
        deciding to cancel it. Parsed in Python from `--json status`, never gh's `-q`.
        """
        result = proc.run(["gh", "run", "view", run_id, "--json", "status"], check=False)
        if not result.ok:
            return ""
        return _status_field(result.out)

    def run_cancel(self, run_id: str) -> bool:
        """Best-effort cancel run `run_id` (`gh run cancel`) — tolerant of an already-finished run.

        The cancel-trap fires this when a bring-up aborts before handing the run off to be watched,
        so a pre-dispatched deploy is not left building against infra that never came up.

        Returns True iff the cancel command exited 0. Recovery uses this to decide whether the
        holder is confirmed dead: a FAILED cancel must NOT be read as "dead" (concurrent-writer
        safety) — the run may still be executing, so the lock stays held.
        """
        return proc.run_ok(["gh", "run", "cancel", run_id])


def _rows(raw: str) -> list[_NamedValue]:
    """Parse a `gh … --json` array of {name,value?} objects. Tolerant → [] on non-array/garbage."""
    try:
        payload: object = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(payload, list):
        return []
    items = cast("list[object]", payload)
    return [cast("_NamedValue", row) for row in items if isinstance(row, dict)]


def _first_database_id(raw: str) -> str:
    """`[{"databaseId": <int>}]` → the id as a string, or "" (tolerant → "" on garbage/empty).

    The id is a JSON integer; it is stringified here so every run-id crossing the boundary is a
    single `str` type (the shell only ever had text).
    """
    try:
        payload: object = json.loads(raw)
    except json.JSONDecodeError:
        return ""
    if not isinstance(payload, list) or not payload:
        return ""
    first = cast("list[object]", payload)[0]
    if not isinstance(first, dict):
        return ""
    database_id = cast("dict[str, object]", first).get("databaseId")
    return str(database_id) if isinstance(database_id, int) else ""


def _status_field(raw: str) -> str:
    """`{"status": "in_progress"}` → the status string, or "" (tolerant → "" on garbage)."""
    try:
        payload: object = json.loads(raw)
    except json.JSONDecodeError:
        return ""
    if not isinstance(payload, dict):
        return ""
    status = cast("dict[str, object]", payload).get("status")
    return status if isinstance(status, str) else ""
