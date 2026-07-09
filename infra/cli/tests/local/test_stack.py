"""Tests for local/stack.py — the kind-stack orchestrator (ORDERING + branching, not argv).

Collaborators are fake clients that append a tag to a shared `_EVENTS` log; each test asserts the
sequence. The migrate gate polls `kubectl.job_condition`, so the fake answers Complete/Failed to
drive it without real sleeps; health_report/health_ok are injected callables so no HTTP runs.
`_TF_STATE` is monkeypatched to a tmp path so `_cluster_up`'s mkdir never touches the repo.
"""

from pathlib import Path

import pytest
import typer

from devstash_infra.local import stack as stack_mod
from devstash_infra.local.stack import LocalStack

_EVENTS: list[str] = []


class _FakeDocker:
    def build(self, tag: str, *, target: str | None = None, context: str = ".") -> None:
        _EVENTS.append(f"docker.build:{tag}")


class _FakeKind:
    def __init__(self, *, present: bool) -> None:
        self._present = present

    def cluster_names(self) -> list[str]:
        return ["devstash"] if self._present else []

    def load_image(self, image: str, *, cluster: str) -> None:
        _EVENTS.append(f"kind.load:{image}")


class _FakeKubectl:
    def __init__(self, *, migrate: str = "Complete") -> None:
        self._migrate = migrate  # "Complete" | "Failed" — which condition the gate sees

    def current_context(self) -> str:
        return "kind-devstash"

    def ensure_namespace(self, namespace: str) -> None:
        _EVENTS.append(f"ensure_ns:{namespace}")

    def kustomize(self, directory: str) -> str:
        return f"<rendered {directory}>"

    def apply_stdin(self, manifest: str, *, server_side: bool = False) -> None:
        _EVENTS.append(f"apply{'(ssa)' if server_side else ''}:{manifest}")

    def apply_file(self, path: str) -> None:
        _EVENTS.append(f"apply_file:{path}")

    def apply_secret_from_files(self, name: str, files: object, *, namespace: str) -> None:
        _EVENTS.append(f"secret:{name}")

    def delete_job(self, job: str, *, namespace: str) -> None:
        _EVENTS.append(f"delete_job:{job}")

    def job_condition(self, job: str, condition: str, *, namespace: str) -> str:
        return "True" if condition == self._migrate else "False"

    def job_logs(self, job: str, *, namespace: str, tail: int) -> str:
        return "migrate logs"

    def describe(self, resource: str, *, namespace: str) -> str:
        return "describe"

    def rollout_status(self, resource: str, *, namespace: str, timeout: str) -> None:
        _EVENTS.append(f"rollout_status:{resource}")

    def rollout_restart(self, resource: str, *, namespace: str) -> None:
        _EVENTS.append(f"rollout_restart:{resource}")

    def wait_condition(
        self, resource: str, condition: str, *, namespace: str, timeout: str
    ) -> bool:
        _EVENTS.append(f"wait:{resource}")
        return True

    def get(
        self,
        target: str,
        *,
        namespace: str,
        output: str | None = None,
        sort_by: str | None = None,
        selector: str | None = None,
    ) -> str:
        _EVENTS.append(f"get:{target}")
        return "workloads"


class _FakeYq:
    def eval_stdin(self, expression: str, manifest: str, *, env_extra: object = None) -> str:
        return f"{manifest}|{expression}"


class _FakeOpenssl:
    def self_signed_ca(self, *, key_out: Path, cert_out: Path, common_name: str, days: int) -> None:
        _EVENTS.append("openssl.ca")

    def server_csr(self, *, key_out: Path, csr_out: Path, config: Path) -> None:
        _EVENTS.append("openssl.csr")

    def sign_csr(
        self, *, csr: Path, ca_cert: Path, ca_key: Path, config: Path, cert_out: Path, days: int
    ) -> None:
        _EVENTS.append("openssl.sign")


class _FakeTofu:
    def __init__(self, *, state: bool = True) -> None:
        self._state = state

    @property
    def state_exists(self) -> bool:
        return self._state

    def init(self) -> None:
        _EVENTS.append("tofu.init")

    def apply(self, *, cluster_active: bool) -> None:
        _EVENTS.append(f"tofu.apply:{cluster_active}")

    def destroy(self) -> None:
        _EVENTS.append("tofu.destroy")


def _report(_url: str) -> str:
    return '{"status":"ok"}'


def _stack(
    *, cluster_present: bool = True, migrate: str = "Complete", healthy: bool = True
) -> LocalStack:
    _EVENTS.clear()

    def _health_ok(_url: str) -> bool:
        return healthy

    return LocalStack(
        docker=_FakeDocker(),
        kind=_FakeKind(present=cluster_present),
        kubectl=_FakeKubectl(migrate=migrate),
        yq=_FakeYq(),
        openssl=_FakeOpenssl(),
        tofu=_FakeTofu(state=cluster_present),
        health_report=_report,
        health_ok=_health_ok,
    )


@pytest.fixture
def tmp_state(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Redirect the local tofu state path so `_cluster_up`'s mkdir never touches the repo."""
    state = tmp_path / ".tofu-state" / "local.tfstate"
    monkeypatch.setattr(stack_mod, "_TF_STATE", state)
    return state


class TestUp:
    def test_full_bring_up_order(self, tmp_state: Path, capsys: pytest.CaptureFixture[str]) -> None:
        _stack().up()
        # Cluster is provisioned + reachable BEFORE any image build or apply.
        assert _EVENTS[:3] == ["tofu.init", "tofu.apply:True", "docker.build:devstash:local"]
        # TLS certs → backing services → migrate gate → web → dashboards.
        assert _EVENTS.index("openssl.sign") < _EVENTS.index("secret:valkey-tls")
        assert _EVENTS.index("secret:valkey-tls") < _EVENTS.index("delete_job:devstash-migrate")
        assert _EVENTS.index("delete_job:devstash-migrate") < _EVENTS.index(
            "rollout_status:deploy/devstash-web"
        )
        # Data services awaited before migrations; minio job waited on.
        assert "rollout_status:statefulset/postgres" in _EVENTS
        assert "wait:job/minio-bucket-init" in _EVENTS
        # Dashboards rolled out AFTER the web app.
        assert _EVENTS.index("rollout_status:deploy/devstash-web") < _EVENTS.index(
            "rollout_status:deploy/headlamp"
        )
        assert "migrate job complete" in capsys.readouterr().out

    def test_migrate_failed_dies(self, tmp_state: Path) -> None:
        with pytest.raises(typer.Exit):
            _stack(migrate="Failed").up()

    def test_unhealthy_warns_but_completes(
        self, tmp_state: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        _stack(healthy=False).up()
        assert "did not report status=ok" in capsys.readouterr().out


class TestDeploy:
    def test_requires_cluster(self) -> None:
        with pytest.raises(typer.Exit):
            _stack(cluster_present=False).deploy()

    def test_fast_iterate_order(self) -> None:
        _stack().deploy()
        # No cluster provisioning on deploy; build → apply infra → migrate → rollout restart.
        assert "tofu.apply:True" not in _EVENTS
        assert _EVENTS.index("docker.build:devstash:local") < _EVENTS.index(
            "delete_job:devstash-migrate"
        )
        assert "rollout_restart:deploy/devstash-web" in _EVENTS


class TestStatus:
    def test_requires_cluster(self) -> None:
        with pytest.raises(typer.Exit):
            _stack(cluster_present=False).status()

    def test_prints_workloads_and_pods(self) -> None:
        _stack().status()
        assert "get:deploy,statefulset,job,svc,pdb,hpa" in _EVENTS
        assert "get:pods" in _EVENTS


class TestDown:
    def test_destroys_when_state_present(self) -> None:
        _stack(cluster_present=True).down()
        assert _EVENTS == ["tofu.init", "tofu.destroy"]

    def test_noop_when_no_state(self, capsys: pytest.CaptureFixture[str]) -> None:
        _stack(cluster_present=False).down()
        assert _EVENTS == []  # never inits/destroys
        assert "nothing to destroy" in capsys.readouterr().out


def test_info_prints_urls(capsys: pytest.CaptureFixture[str]) -> None:
    _stack().info()
    out = capsys.readouterr().out
    assert "http://localhost:8080" in out
    assert "Mailpit UI" in out
