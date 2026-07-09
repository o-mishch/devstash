"""Tests for ci/app.py — the `devstash-infra ci <step>` typer boundary.

These assert the WIRING, not the step logic (each step has its own suite): env → params,
the decision → $GITHUB_OUTPUT/$GITHUB_ENV write, the guard → exit-code mapping, and the two
conditional probes (decide-build's provision short-circuit, check-env-active's tolerant probe).
Step functions are monkeypatched on the app namespace where they are wiring-only; the two probe
commands run their real conditional and monkeypatch only the `Gcloud` client.
"""

from pathlib import Path

import pytest
from typer.testing import CliRunner

from devstash_infra.ci import app as app_module
from devstash_infra.ci import steps as steps_module
from devstash_infra.ci.build_push import BuildPushResult
from devstash_infra.cli import app
from devstash_infra.shared.proc import ProcError, Result

runner = CliRunner()


class _FakeContainer:
    """Stand-in for `gcloud.container` — records probe calls, replays a listed/error outcome."""

    def __init__(self, *, listed: bool = False, error: bool = False) -> None:
        self.listed = listed
        self.error = error
        self.calls = 0

    def cluster_listed(self, name: str, *, region: str) -> bool:
        self.calls += 1
        if self.error:
            raise ProcError(Result(["gcloud", "container", "clusters", "list"], "", "boom", 1))
        return self.listed


class _FakeGcloud:
    def __init__(self, container: _FakeContainer) -> None:
        self.container = container


def _patch_gcloud(monkeypatch: pytest.MonkeyPatch, container: _FakeContainer) -> None:
    """Replace `ci.app.Gcloud(project)` with a fake exposing `container`."""

    def _factory(project: str) -> _FakeGcloud:
        return _FakeGcloud(container)

    monkeypatch.setattr(app_module, "Gcloud", _factory)


def _read(path: Path) -> str:
    return path.read_text() if path.exists() else ""


def _dummy(*_args: object, **_kwargs: object) -> object:
    """A client-constructor stand-in for commands whose step function is itself monkeypatched."""
    return object()


class _DummyCtx:
    """A context-manager client stand-in (e.g. ArtifactRegistry, used via `with`)."""

    def __init__(self, *_args: object, **_kwargs: object) -> None: ...
    def __enter__(self) -> _DummyCtx:
        return self

    def __exit__(self, *_exc: object) -> None: ...


# ── output-setting: gate decisions land in $GITHUB_OUTPUT ─────────────────────
def test_wif_torn_down_skip_writes_build_false(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    out = tmp_path / "out"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    result = runner.invoke(app, ["ci", "wif-torn-down-skip"])
    assert result.exit_code == 0
    assert "build=false" in _read(out)
    assert "::warning::" in result.output  # the self-explaining skip warning


def test_decide_build_provision_short_circuits_without_probing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    out = tmp_path / "out"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    monkeypatch.setenv("DISPATCH_REASON", "provision")

    # Constructing Gcloud at all would mean the cluster was probed — provision must not.
    def _explode(project: str) -> _FakeGcloud:
        raise AssertionError("provision must not probe the cluster")

    monkeypatch.setattr(app_module, "Gcloud", _explode)
    result = runner.invoke(app, ["ci", "decide-build"])
    assert result.exit_code == 0
    assert "build=true" in _read(out)


def test_decide_build_probes_when_not_provision(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    out = tmp_path / "out"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    monkeypatch.setenv("DISPATCH_REASON", "push")
    for name in ("GCP_PROJECT_ID", "CLUSTER", "REGION"):
        monkeypatch.setenv(name, name.lower())
    container = _FakeContainer(listed=True)
    _patch_gcloud(monkeypatch, container)
    result = runner.invoke(app, ["ci", "decide-build"])
    assert result.exit_code == 0
    assert container.calls == 1  # the one-shot loud probe ran
    assert "build=true" in _read(out)


def test_check_env_active_tolerant_probe_reports_suspended(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    out = tmp_path / "out"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    for name in ("GCP_PROJECT_ID", "CLUSTER", "REGION"):
        monkeypatch.setenv(name, name.lower())
    monkeypatch.setenv("CLUSTER_WAIT_ATTEMPTS", "1")  # one probe, no sleep
    monkeypatch.setenv("CLUSTER_WAIT_GAP", "0")
    container = _FakeContainer(error=True)  # a ProcError each probe
    _patch_gcloud(monkeypatch, container)
    result = runner.invoke(app, ["ci", "check-env-active"])
    assert result.exit_code == 0  # the ProcError was swallowed, not raised
    assert container.calls == 1
    assert "suspended=true" in _read(out)


# ── guard → exit-code mapping ─────────────────────────────────────────────────
def test_missing_required_env_exits_nonzero(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("GCP_PROJECT_ID", "WORKLOAD_IDENTITY_PROVIDER", "DEPLOYER_SA", "APP_DOMAIN"):
        monkeypatch.delenv(name, raising=False)
    result = runner.invoke(app, ["ci", "validate-inputs"])
    assert result.exit_code == 1  # env.require raised InfraError; guard mapped it to a clean exit


def test_step_infraerror_maps_to_exit(monkeypatch: pytest.MonkeyPatch) -> None:
    from devstash_infra.shared.errors import InfraError

    def _boom(migrations_root: Path) -> None:
        raise InfraError("risky migration", exit_code=3)

    monkeypatch.setattr(steps_module, "check_migrations", _boom)
    result = runner.invoke(app, ["ci", "check-migrations"])
    assert result.exit_code == 3  # the InfraError's own exit code is honored


# ── build-push: digests exported to BOTH $GITHUB_ENV and $GITHUB_OUTPUT ────────
def test_build_push_exports_env_and_outputs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    env_file, out_file = tmp_path / "env", tmp_path / "out"
    monkeypatch.setenv("GITHUB_ENV", str(env_file))
    monkeypatch.setenv("GITHUB_OUTPUT", str(out_file))
    for name in ("REGION", "GCP_PROJECT_ID", "REPO", "IMAGE", "IMAGE_MIGRATE", "GITHUB_SHA"):
        monkeypatch.setenv(name, name.lower())
    monkeypatch.setattr(app_module, "ArtifactRegistry", _DummyCtx)  # used via `with` now
    monkeypatch.setattr(app_module, "Docker", _dummy)

    def _fake_build_push(*_args: object, **_kwargs: object) -> BuildPushResult:
        return BuildPushResult(
            image_uri="reg/web",
            web_digest="sha256:web",
            migrate_uri="reg/migrate",
            migrate_digest="sha256:mig",
        )

    monkeypatch.setattr(app_module, "build_push", _fake_build_push)
    result = runner.invoke(app, ["ci", "build-push"])
    assert result.exit_code == 0
    env_text, out_text = _read(env_file), _read(out_file)
    assert "IMAGE_URI=reg/web" in env_text
    assert "WEB_DIGEST=sha256:web" in env_text
    assert "MIGRATE_IMAGE=reg/migrate@sha256:mig" in env_text  # the migrate_image property
    assert "web_image_name=reg/web" in out_text
    assert "migrate_image_name=reg/migrate" in out_text
    assert "migrate_digest=sha256:mig" in out_text


# ── output-setting on the sync join ───────────────────────────────────────────
def test_wait_secrets_sync_writes_synced(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    out = tmp_path / "out"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    monkeypatch.setattr(app_module, "Kubectl", _dummy)

    def _fake_wait(*_args: object, **_kwargs: object) -> bool:
        return False  # benign parked state

    monkeypatch.setattr(app_module, "wait_for_sync", _fake_wait)
    result = runner.invoke(app, ["ci", "wait-secrets-sync"])
    assert result.exit_code == 0
    assert "synced=false" in _read(out)


def test_prune_registry_builds_keep_digests_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("GCP_PROJECT_ID", "REGION", "REPO"):
        monkeypatch.setenv(name, name.lower())
    monkeypatch.setenv("WEB_DIGEST", "sha256:web")
    monkeypatch.delenv("MIGRATE_DIGEST", raising=False)  # absent → omitted, not ""
    monkeypatch.setattr(app_module, "Gcloud", _dummy)
    monkeypatch.setattr(app_module, "Docker", _dummy)
    captured: dict[str, object] = {}

    def _fake_prune(*_args: object, **kwargs: object) -> None:
        captured.update(kwargs)

    monkeypatch.setattr(app_module, "prune_registry", _fake_prune)
    result = runner.invoke(app, ["ci", "prune-registry"])
    assert result.exit_code == 0
    assert captured["keep_digests"] == {"web": "sha256:web"}  # absent migrate omitted


def test_help_lists_the_ci_steps() -> None:
    result = runner.invoke(app, ["ci", "--help"])
    assert result.exit_code == 0
    for step in ("build-push", "validate-inputs", "run-migrations", "prune-registry"):
        assert step in result.output
