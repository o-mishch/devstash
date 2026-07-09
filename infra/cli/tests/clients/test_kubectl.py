"""Tests for clients/kubectl.py — argv-parity + the tolerant current-context read."""

from collections.abc import Sequence

import pytest

from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.shared import proc
from devstash_infra.shared.proc import ProcError, Result


def _route(monkeypatch: pytest.MonkeyPatch, *, ok: bool = True, out: str = "") -> list[list[str]]:
    calls: list[list[str]] = []

    def _fake_run(argv: Sequence[str], *, check: bool = True, **_: object) -> Result:
        args = list(argv)
        calls.append(args)
        result = Result(args, out, "", 0 if ok else 1)
        if check and not result.ok:  # faithful to proc.run: check=True raises on failure
            raise ProcError(result)
        return result

    monkeypatch.setattr(proc, "run", _fake_run)
    return calls


def test_current_context_argv_and_value(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch, out="gke_proj_us-central1_devstash-dev-gke")
    assert Kubectl().current_context() == "gke_proj_us-central1_devstash-dev-gke"
    assert calls == [["kubectl", "config", "current-context"]]


def test_current_context_empty_when_unreadable(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, ok=False)  # no kubeconfig / no context → ""
    assert Kubectl().current_context() == ""


def test_selector_logs_argv_and_tolerant(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch, out="[pod-a] hello\n[pod-b] world\n")
    out = Kubectl().selector_logs("app.kubernetes.io/name=devstash", namespace="devstash", tail=100)
    assert out == "[pod-a] hello\n[pod-b] world\n"
    assert calls == [
        [
            "kubectl", "-n", "devstash", "logs", "-l", "app.kubernetes.io/name=devstash",
            "--tail=100", "--prefix", "--ignore-errors",
        ]
    ]  # fmt: skip


def test_selector_logs_empty_when_no_pods(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, ok=False)  # no pods / mid-restart → tolerant "" (a display read)
    assert Kubectl().selector_logs("app=x", namespace="devstash", tail=50) == ""


def test_cluster_info_true_and_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch, out="Kubernetes control plane is running")
    assert Kubectl().cluster_info() is True
    assert calls == [["kubectl", "cluster-info"]]


def test_cluster_info_false_when_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, ok=False)  # endpoint not answering → tolerant False, never raises
    assert Kubectl().cluster_info() is False


def test_rollout_status_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch)
    Kubectl().rollout_status(
        "deploy/external-secrets-webhook", namespace="external-secrets", timeout="3m"
    )
    assert calls == [
        [
            "kubectl",
            "-n",
            "external-secrets",
            "rollout",
            "status",
            "deploy/external-secrets-webhook",
            "--timeout=3m",
        ]
    ]


def test_rollout_status_raises_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, ok=False)
    with pytest.raises(ProcError):
        Kubectl().rollout_status("deploy/x", namespace="ns", timeout="3m")


def test_annotate_argv_is_best_effort(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch, ok=False)  # even a failure must not raise (best-effort nudge)
    Kubectl().annotate("externalsecret/devstash-secrets", "force-sync", "42", namespace="devstash")
    assert calls == [
        [
            "kubectl", "-n", "devstash", "annotate", "externalsecret/devstash-secrets",
            "force-sync=42", "--overwrite",
        ]
    ]  # fmt: skip


def test_wait_condition_returns_bool(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch, ok=True)
    assert Kubectl().wait_condition(
        "externalsecret/devstash-secrets", "Ready", namespace="devstash", timeout="30s"
    )
    assert calls == [
        [
            "kubectl", "-n", "devstash", "wait", "--for=condition=Ready",
            "externalsecret/devstash-secrets", "--timeout=30s",
        ]
    ]  # fmt: skip


def test_wait_condition_false_on_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, ok=False)  # timeout → False, no raise
    assert Kubectl().wait_condition("es/x", "Ready", namespace="ns", timeout="1s") is False


def test_newest_event_message_argv_and_result(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch, out="key redis-url does not exist in secret devstash-app-config")
    result = Kubectl().newest_event_message(
        "devstash-secrets", "UpdateFailed", namespace="devstash"
    )
    assert result.stdout == "key redis-url does not exist in secret devstash-app-config"
    assert calls == [
        [
            "kubectl", "-n", "devstash", "get", "events",
            "--field-selector", "involvedObject.name=devstash-secrets,reason=UpdateFailed",
            "--sort-by=.lastTimestamp", "-o", "jsonpath={.items[-1:].message}",
        ]
    ]  # fmt: skip


def test_newest_event_message_tolerates_kubectl_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, ok=False)  # rc≠0 is returned (not raised) so the caller can classify it
    assert Kubectl().newest_event_message("x", "UpdateFailed", namespace="ns").ok is False


def test_describe_returns_stdout_or_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, out="Name: x\nEvents:\n  warn")
    assert "Events:" in Kubectl().describe("externalsecret/x", namespace="ns")
    _route(monkeypatch, ok=False)
    assert Kubectl().describe("externalsecret/x", namespace="ns") == ""


def test_get_raw_argv_and_tolerant(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch, out="ok")
    assert Kubectl().get_raw("/readyz").out == "ok"
    assert calls == [["kubectl", "get", "--raw=/readyz"]]


def test_get_raw_returns_result_on_failure_without_raising(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(
        monkeypatch, ok=False
    )  # a control-plane rejection is classified by the caller, not raised
    assert Kubectl().get_raw("/readyz").ok is False


def test_get_builds_optional_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch, out="NAME  AGE")
    assert Kubectl().get("gateway,httproute", namespace="ns", output="wide") == "NAME  AGE"
    assert Kubectl().get("events", namespace="ns", sort_by=".lastTimestamp") == "NAME  AGE"
    assert calls == [
        ["kubectl", "-n", "ns", "get", "gateway,httproute", "-o", "wide"],
        ["kubectl", "-n", "ns", "get", "events", "--sort-by=.lastTimestamp"],
    ]


def test_get_empty_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, ok=False)
    assert Kubectl().get("gateway", namespace="ns") == ""


def test_pod_names_splits_lines(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch, out="pod/web-a\npod/web-b")
    assert Kubectl().pod_names("app.kubernetes.io/name=devstash", namespace="ns") == [
        "pod/web-a",
        "pod/web-b",
    ]
    assert calls == [
        [
            "kubectl",
            "-n",
            "ns",
            "get",
            "pods",
            "-l",
            "app.kubernetes.io/name=devstash",
            "-o",
            "name",
        ]
    ]


def test_pod_names_empty_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, ok=False)
    assert Kubectl().pod_names("app=x", namespace="ns") == []


def test_previous_logs_argv_and_tolerant(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch, out="panic: boom")
    assert Kubectl().previous_logs("pod/web-a", namespace="ns", tail=100) == "panic: boom"
    assert calls == [["kubectl", "-n", "ns", "logs", "pod/web-a", "--previous", "--tail=100"]]
    _route(monkeypatch, ok=False)  # no previous container → ""
    assert Kubectl().previous_logs("pod/web-a", namespace="ns", tail=100) == ""


def test_apply_stdin_pipes_manifest(monkeypatch: pytest.MonkeyPatch) -> None:
    piped: list[str | None] = []

    def _fake_run(argv: Sequence[str], *, input: str | None = None, **_: object) -> Result:
        piped.append(input)
        return Result(list(argv), "", "", 0)

    monkeypatch.setattr(proc, "run", _fake_run)
    Kubectl().apply_stdin("kind: Deployment\n")
    assert piped == ["kind: Deployment\n"]  # the rendered doc reaches stdin, not a temp file


def test_delete_job_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch)
    Kubectl().delete_job("devstash-migrate", namespace="devstash")
    assert calls == [
        [
            "kubectl", "-n", "devstash", "delete", "job", "devstash-migrate",
            "--ignore-not-found", "--cascade=foreground",
        ]
    ]  # fmt: skip


def test_delete_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch)
    Kubectl().delete("ingress", "devstash-web", namespace="devstash")
    assert calls == [
        ["kubectl", "-n", "devstash", "delete", "ingress", "devstash-web", "--ignore-not-found"]
    ]


def test_job_condition_jsonpath_and_tolerant(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch, out="True")
    assert Kubectl().job_condition("devstash-migrate", "Complete", namespace="devstash") == "True"
    assert calls == [
        [
            "kubectl", "-n", "devstash", "get", "job", "devstash-migrate",
            "-o", 'jsonpath={.status.conditions[?(@.type=="Complete")].status}',
        ]
    ]  # fmt: skip
    _route(monkeypatch, ok=False)  # condition not present yet → "" (poll treats as not-yet)
    assert Kubectl().job_condition("devstash-migrate", "Failed", namespace="devstash") == ""


def test_job_logs_argv_and_tolerant(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch, out="migrating…")
    assert Kubectl().job_logs("devstash-migrate", namespace="devstash", tail=50) == "migrating…"
    assert calls == [["kubectl", "-n", "devstash", "logs", "job/devstash-migrate", "--tail=50"]]
    _route(monkeypatch, ok=False)  # no such job (no prior run) → ""
    assert Kubectl().job_logs("devstash-migrate", namespace="devstash", tail=50) == ""


def test_kustomize_returns_raw_stdout(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch, out="apiVersion: v1\nkind: ConfigMap\n")
    assert Kubectl().kustomize("overlays/gcp") == "apiVersion: v1\nkind: ConfigMap\n"
    assert calls == [["kubectl", "kustomize", "overlays/gcp"]]


def test_apply_server_side_argv_and_stdin(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[list[str]] = []
    piped: list[str | None] = []

    def _fake_run(argv: Sequence[str], *, input: str | None = None, **_: object) -> Result:
        seen.append(list(argv))
        piped.append(input)
        return Result(list(argv), "", "", 0)

    monkeypatch.setattr(proc, "run", _fake_run)
    Kubectl().apply_server_side("kind: Deployment\n", field_manager="devstash-deploy")
    assert seen == [
        [
            "kubectl", "apply", "--server-side", "--force-conflicts",
            "--field-manager=devstash-deploy", "-f", "-",
        ]
    ]  # fmt: skip
    assert piped == ["kind: Deployment\n"]


def _route_io(
    monkeypatch: pytest.MonkeyPatch, *, out: str = ""
) -> tuple[list[list[str]], list[object]]:
    """Route proc.run capturing both argv and each call's `input=` (stdin) payload."""
    calls: list[list[str]] = []
    inputs: list[object] = []

    def _fake_run(
        argv: Sequence[str],
        *,
        input: object = None,
        **_: object,
    ) -> Result:
        calls.append(list(argv))
        inputs.append(input)
        return Result(list(argv), out, "", 0)

    monkeypatch.setattr(proc, "run", _fake_run)
    return calls, inputs


def test_apply_stdin_plain(monkeypatch: pytest.MonkeyPatch) -> None:
    calls, inputs = _route_io(monkeypatch)
    Kubectl().apply_stdin("kind: Service\n")
    assert calls == [["kubectl", "apply", "-f", "-"]]
    assert inputs == ["kind: Service\n"]


def test_apply_stdin_server_side(monkeypatch: pytest.MonkeyPatch) -> None:
    calls, _inputs = _route_io(monkeypatch)
    Kubectl().apply_stdin("kind: Deployment\n", server_side=True)
    assert calls == [["kubectl", "apply", "--server-side", "-f", "-"]]


def test_apply_file_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch)
    Kubectl().apply_file("infra/k8s/overlays/local/migrate-job-local.yaml")
    assert calls == [["kubectl", "apply", "-f", "infra/k8s/overlays/local/migrate-job-local.yaml"]]


def test_ensure_namespace_renders_then_applies(monkeypatch: pytest.MonkeyPatch) -> None:
    calls, inputs = _route_io(monkeypatch, out="apiVersion: v1\nkind: Namespace\n")
    Kubectl().ensure_namespace("devstash")
    assert calls == [
        ["kubectl", "create", "namespace", "devstash", "--dry-run=client", "-o", "yaml"],
        ["kubectl", "apply", "-f", "-"],
    ]
    assert inputs[1] == "apiVersion: v1\nkind: Namespace\n"  # rendered NS piped to apply


def test_apply_secret_from_files_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    calls, _inputs = _route_io(monkeypatch, out="kind: Secret\n")
    Kubectl().apply_secret_from_files(
        "valkey-tls",
        {"ca.crt": "/work/ca.crt", "tls.crt": "/work/tls.crt", "tls.key": "/work/tls.key"},
        namespace="devstash",
    )
    assert calls[0] == [
        "kubectl",
        "-n",
        "devstash",
        "create",
        "secret",
        "generic",
        "valkey-tls",
        "--from-file=ca.crt=/work/ca.crt",
        "--from-file=tls.crt=/work/tls.crt",
        "--from-file=tls.key=/work/tls.key",
        "--dry-run=client",
        "-o",
        "yaml",
    ]
    assert calls[1] == ["kubectl", "apply", "-f", "-"]


def test_rollout_restart_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch)
    Kubectl().rollout_restart("deploy/devstash-web", namespace="devstash")
    assert calls == [["kubectl", "-n", "devstash", "rollout", "restart", "deploy/devstash-web"]]


def test_get_with_selector(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch, out="pod/web-1\n")
    Kubectl().get(
        "pods", namespace="devstash", output="wide", selector="app.kubernetes.io/name=devstash"
    )
    assert calls == [
        [
            "kubectl",
            "-n",
            "devstash",
            "get",
            "pods",
            "-l",
            "app.kubernetes.io/name=devstash",
            "-o",
            "wide",
        ]
    ]
