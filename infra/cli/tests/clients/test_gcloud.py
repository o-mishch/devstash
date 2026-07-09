"""Tests for clients/gcloud.py — the typed gcloud facade.

This is where argv-parity now lives: each test asserts the EXACT gcloud command the client emits
(byte-for-byte against the shell), plus the per-method error contract — best-effort marker writes
swallow a ProcError, a tolerant read returns "" when the resource is absent.
"""

from collections.abc import Sequence

import pytest

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.shared import proc
from devstash_infra.shared.proc import ProcError, Result

_MARKER = "gs://proj-tfstate-dev/gke/dev/.provisioning"


def _route(
    monkeypatch: pytest.MonkeyPatch, *, fail: bool = False, out: str = ""
) -> list[list[str]]:
    """Record every argv; optionally make the call fail. Honors `check`: a probe (check=False, e.g.
    `proc.run_ok`) gets a non-zero Result back; a checked call raises ProcError — like real proc.
    """
    calls: list[list[str]] = []

    def _fake_run(argv: Sequence[str], *, check: bool = True, **_: object) -> Result:
        args = list(argv)
        calls.append(args)
        result = Result(args, out, "boom" if fail else "", 1 if fail else 0)
        if fail and check:
            raise ProcError(result)
        return result

    monkeypatch.setattr(proc, "run", _fake_run)
    return calls


def _seq_route(monkeypatch: pytest.MonkeyPatch, results: list[tuple[str, int]]) -> list[list[str]]:
    """Route successive proc.run calls to `results` in order (stdout, returncode) per call.

    For multi-call methods whose sub-probes have DIFFERENT outcomes (teardown_in_progress: a
    describe then an operations list). Every call is tolerant (the probes use check=False), so a
    non-zero code returns a failed Result rather than raising.
    """
    calls: list[list[str]] = []
    outcomes = iter(results)

    def _fake_run(argv: Sequence[str], *, check: bool = True, **_: object) -> Result:
        args = list(argv)
        calls.append(args)
        out, code = next(outcomes)
        return Result(args, out, "boom" if code else "", code)

    monkeypatch.setattr(proc, "run", _fake_run)
    return calls


class TestStorageMarker:
    def test_write_marker_emits_exact_argv(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        Gcloud("proj").storage.write_marker(_MARKER)
        assert calls == [["gcloud", "storage", "cp", "/dev/null", _MARKER]]

    def test_remove_marker_emits_exact_argv(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        Gcloud("proj").storage.remove_marker(_MARKER)
        assert calls == [["gcloud", "storage", "rm", _MARKER]]

    def test_marker_write_is_best_effort_swallows_proc_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _route(monkeypatch, fail=True)
        Gcloud("proj").storage.write_marker(_MARKER)  # must NOT raise (shell `|| true`)


class TestComputeAddress:
    def test_reads_global_address_scoped_to_project(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch, out="8.232.44.235")
        assert Gcloud("proj").compute.global_address("devstash-dev-ip") == "8.232.44.235"
        assert calls == [
            [
                "gcloud",
                "compute",
                "addresses",
                "describe",
                "devstash-dev-ip",
                "--global",
                "--project=proj",
                "--format=value(address)",
            ]
        ]

    def test_absent_address_is_empty_not_an_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(monkeypatch, fail=True)  # describe fails → suspended env / released IP
        assert Gcloud("proj").compute.global_address("devstash-dev-ip") == ""


class TestAuth:
    def test_active_account_read(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch, out="me@example.com")
        assert Gcloud("proj").auth.active_account() == "me@example.com"
        assert calls == [
            [
                "gcloud",
                "auth",
                "list",
                "--filter=status:ACTIVE",
                "--format=value(account)",
            ]
        ]

    def test_no_active_account_is_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(monkeypatch, fail=True)  # list exits non-zero → treated as "no account"
        assert Gcloud("proj").auth.active_account() == ""

    def test_adc_present_is_a_probe(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch, fail=True)  # print-access-token fails → ADC absent
        assert Gcloud("proj").auth.adc_present() is False
        assert calls == [
            [
                "gcloud",
                "auth",
                "application-default",
                "print-access-token",
            ]
        ]

    def test_login_flows_are_uncaptured(self, monkeypatch: pytest.MonkeyPatch) -> None:
        captured: list[object] = []

        def _fake_run(argv: Sequence[str], *, capture: bool = True, **_: object) -> Result:
            captured.append(capture)
            return Result(list(argv), "", "", 0)

        monkeypatch.setattr(proc, "run", _fake_run)
        Gcloud("proj").auth.login()
        Gcloud("proj").auth.adc_login()
        assert captured == [False, False]  # interactive flows drive the console directly


class TestProjectAndConfig:
    def test_exists_is_a_probe(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        assert Gcloud("proj").projects.exists() is True
        assert calls == [["gcloud", "projects", "describe", "proj"]]

    def test_create_names_the_project(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        Gcloud("proj").projects.create(name="DevStash")
        assert calls == [["gcloud", "projects", "create", "proj", "--name=DevStash"]]

    def test_set_active_project(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        Gcloud("proj").config.set_active_project()
        assert calls == [["gcloud", "config", "set", "project", "proj"]]


class TestBilling:
    def test_is_linked_true_only_on_True(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch, out="True")
        assert Gcloud("proj").billing.is_linked() is True
        assert calls == [
            [
                "gcloud",
                "billing",
                "projects",
                "describe",
                "proj",
                "--format=value(billingEnabled)",
            ]
        ]

    def test_is_linked_false_when_not_True(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(monkeypatch, out="")  # billingEnabled empty/False → not linked
        assert Gcloud("proj").billing.is_linked() is False

    def test_first_open_account_takes_the_head(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch, out="billingAccounts/AAA\nbillingAccounts/BBB")
        assert Gcloud("proj").billing.first_open_account() == "billingAccounts/AAA"
        assert calls == [
            [
                "gcloud",
                "billing",
                "accounts",
                "list",
                "--filter=open=true",
                "--format=value(name)",
            ]
        ]

    def test_no_open_account_is_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(monkeypatch, out="")
        assert Gcloud("proj").billing.first_open_account() == ""

    def test_link_targets_the_account(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        Gcloud("proj").billing.link("012345-ABCDEF-678901")
        assert calls == [
            [
                "gcloud",
                "billing",
                "projects",
                "link",
                "proj",
                "--billing-account=012345-ABCDEF-678901",
            ]
        ]


class TestServices:
    def test_enable_is_a_single_bulk_call(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        Gcloud("proj").services.enable(("compute.googleapis.com", "iam.googleapis.com"))
        assert calls == [
            [
                "gcloud",
                "services",
                "enable",
                "--project=proj",
                "compute.googleapis.com",
                "iam.googleapis.com",
            ]
        ]


class TestSql:
    def test_instance_exists_probe(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        assert Gcloud("proj").sql.instance_exists("devstash-dev-sql") is True
        assert calls == [
            [
                "gcloud",
                "sql",
                "instances",
                "describe",
                "devstash-dev-sql",
                "--project=proj",
            ]
        ]

    def test_instance_state_read(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch, out="RUNNABLE")
        assert Gcloud("proj").sql.instance_state("devstash-dev-sql") == "RUNNABLE"
        assert calls == [
            [
                "gcloud",
                "sql",
                "instances",
                "describe",
                "devstash-dev-sql",
                "--project=proj",
                "--format=value(state)",
            ]
        ]

    def test_import_sql_argv(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        Gcloud("proj").sql.import_sql("inst", "gs://b/d.sql", database="devstash")
        assert calls == [
            [
                "gcloud",
                "sql",
                "import",
                "sql",
                "inst",
                "gs://b/d.sql",
                "--database=devstash",
                "--project=proj",
                "--quiet",
            ]
        ]

    def test_create_and_delete_database_argv(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        Gcloud("proj").sql.create_database("devstash", instance="inst")
        Gcloud("proj").sql.delete_database("devstash", instance="inst")
        assert calls == [
            [
                "gcloud",
                "sql",
                "databases",
                "create",
                "devstash",
                "--instance=inst",
                "--project=proj",
                "--quiet",
            ],
            [
                "gcloud",
                "sql",
                "databases",
                "delete",
                "devstash",
                "--instance=inst",
                "--project=proj",
                "--quiet",
            ],
        ]


class TestStorageBuckets:
    def test_bucket_exists_is_a_probe(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        assert Gcloud("proj").storage.bucket_exists("gs://b") is True
        assert calls == [["gcloud", "storage", "buckets", "describe", "gs://b"]]

    def test_create_bucket_is_single_region(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        Gcloud("proj").storage.create_bucket("gs://b", location="us-central1")
        assert calls == [
            [
                "gcloud",
                "storage",
                "buckets",
                "create",
                "gs://b",
                "--location=us-central1",
            ]
        ]

    def test_harden_bucket_sets_all_three_props(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        Gcloud("proj").storage.harden_bucket("gs://b")
        assert calls == [
            [
                "gcloud",
                "storage",
                "buckets",
                "update",
                "gs://b",
                "--uniform-bucket-level-access",
                "--public-access-prevention",
                "--versioning",
            ]
        ]

    def test_set_bucket_lifecycle(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        Gcloud("proj").storage.set_bucket_lifecycle("gs://b", lifecycle_file="/lc.json")
        assert calls == [
            [
                "gcloud",
                "storage",
                "buckets",
                "update",
                "gs://b",
                "--lifecycle-file=/lc.json",
            ]
        ]


class TestBinauthz:
    def test_sign_attestation_argv(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        Gcloud("proj").container.sign_attestation(
            "us-docker.pkg.dev/proj/repo/web@sha256:abc", attestor="att", keyring="kr", key="k"
        )
        assert calls == [
            [
                "gcloud", "container", "binauthz", "attestations", "sign-and-create",
                "--artifact-url=us-docker.pkg.dev/proj/repo/web@sha256:abc",
                "--attestor=att",
                "--attestor-project=proj",
                "--keyversion-project=proj",
                "--keyversion-location=global",
                "--keyversion-keyring=kr",
                "--keyversion-key=k",
                "--keyversion=1",
            ]
        ]  # fmt: skip

    def test_sign_attestation_raises_on_failure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(monkeypatch, fail=True)  # a signing failure must be loud, never swallowed
        with pytest.raises(ProcError):
            Gcloud("proj").container.sign_attestation("art", attestor="a", keyring="kr", key="k")


class TestArtifactsPrune:
    def test_list_packages_strips_to_short_name(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(
            monkeypatch, out="projects/proj/…/packages/web\nprojects/proj/…/packages/migrate"
        )
        assert Gcloud("proj").artifacts.list_packages("repo", location="us-central1") == [
            "web",
            "migrate",
        ]
        assert calls == [
            [
                "gcloud", "artifacts", "packages", "list",
                "--repository=repo", "--location=us-central1", "--project=proj",
                "--format=value(name)",
            ]
        ]  # fmt: skip

    def test_list_packages_empty_on_failure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(monkeypatch, fail=True)  # tolerant discovery — caller falls back to the static list
        assert Gcloud("proj").artifacts.list_packages("repo", location="r") == []

    def test_superseded_manifests_parses_tab_rows(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(
            monkeypatch,
            out="sha256:a\tapplication/vnd.oci.image.index.v1+json\nsha256:b\tmanifest",
        )
        rows = Gcloud("proj").artifacts.superseded_manifests(
            "BASE/web", created_before="2026-01-01"
        )
        assert rows == [
            ("sha256:a", "application/vnd.oci.image.index.v1+json"),
            ("sha256:b", "manifest"),
        ]
        assert calls == [
            [
                "gcloud", "artifacts", "docker", "images", "list", "BASE/web",
                "--filter=createTime < 2026-01-01",
                "--format=value(version,metadata.mediaType)",
                "--project=proj",
            ]
        ]  # fmt: skip

    def test_newest_tagged_index_argv_and_value(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch, out="sha256:newest")
        assert Gcloud("proj").artifacts.newest_tagged_index("BASE/extra") == "sha256:newest"
        assert calls == [
            [
                "gcloud", "artifacts", "docker", "images", "list", "BASE/extra",
                "--include-tags", "--sort-by=~createTime",
                "--filter=metadata.mediaType~index AND tags:*",
                "--format=value(version)", "--limit=1",
                "--project=proj",
            ]
        ]  # fmt: skip

    def test_newest_tagged_index_empty_when_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(monkeypatch, out="")
        assert Gcloud("proj").artifacts.newest_tagged_index("BASE/extra") == ""

    def test_delete_docker_image_best_effort(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        assert Gcloud("proj").artifacts.delete_docker_image("BASE/web@sha256:old") is True
        assert calls == [
            [
                "gcloud", "artifacts", "docker", "images", "delete", "BASE/web@sha256:old",
                "--delete-tags", "--quiet", "--project=proj",
            ]
        ]  # fmt: skip

    def test_delete_docker_image_false_on_failure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(monkeypatch, fail=True)  # never raises — a prune hiccup must not fail the deploy
        assert Gcloud("proj").artifacts.delete_docker_image("BASE/web@sha256:old") is False


class TestCertManager:
    def test_cert_state_reads_managed_state(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch, out="ACTIVE")
        assert Gcloud("proj").certificate_manager.cert_state("devstash-cert") == "ACTIVE"
        assert calls == [
            [
                "gcloud", "certificate-manager", "certificates", "describe", "devstash-cert",
                "--project=proj", "--format=value(managed.state)",
            ]
        ]  # fmt: skip

    def test_cert_state_empty_when_unreadable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(monkeypatch, fail=True)  # cert absent / suspended env → "" (caller shows "unknown")
        assert Gcloud("proj").certificate_manager.cert_state("devstash-cert") == ""


class TestContainerClusterProbes:
    """cluster_listed (loud) + teardown_in_progress (tolerant, two sub-probes) — #11 primitives."""

    def test_cluster_listed_true_and_argv(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch, out="devstash-dev-gke")
        assert Gcloud("proj").container.cluster_listed("devstash-dev-gke", region="us-central1")
        assert calls == [
            [
                "gcloud", "container", "clusters", "list",
                "--project=proj", "--region=us-central1",
                "--filter=name=devstash-dev-gke", "--format=value(name)",
            ]
        ]  # fmt: skip

    def test_cluster_listed_false_when_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(monkeypatch, out="")  # nothing echoed → genuinely absent
        assert not Gcloud("proj").container.cluster_listed("gone", region="us-central1")

    def test_cluster_listed_raises_on_gcloud_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(monkeypatch, fail=True)  # LOUD: a real API/auth fault must never read as "absent"
        with pytest.raises(ProcError):
            Gcloud("proj").container.cluster_listed("c", region="us-central1")

    def test_teardown_true_on_stopping_status_skips_ops(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls = _seq_route(monkeypatch, [("STOPPING", 0)])
        assert Gcloud("proj").container.teardown_in_progress("c", region="us-central1")
        assert len(calls) == 1  # STOPPING short-circuits — the operations list is never queried
        assert calls[0][:4] == ["gcloud", "container", "clusters", "describe"]

    def test_teardown_true_on_inflight_delete_op(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _seq_route(monkeypatch, [("RUNNING", 0), ("operation-delete-123", 0)])
        assert Gcloud("proj").container.teardown_in_progress("c", region="us-central1")
        assert calls[1][:4] == ["gcloud", "container", "operations", "list"]
        assert any("operationType=DELETE_CLUSTER AND status!=DONE" in arg for arg in calls[1])
        assert any("targetLink~/clusters/c$" in arg for arg in calls[1])

    def test_teardown_false_when_running_and_no_delete_op(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _seq_route(monkeypatch, [("RUNNING", 0), ("", 0)])
        assert not Gcloud("proj").container.teardown_in_progress("c", region="us-central1")

    def test_teardown_degraded_is_not_teardown(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # DEGRADED = "needs user action to restore", NOT being deleted — must not abort a resume.
        _seq_route(monkeypatch, [("DEGRADED", 0), ("", 0)])
        assert not Gcloud("proj").container.teardown_in_progress("c", region="us-central1")

    def test_teardown_tolerates_probe_failure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # A transient describe error must not read as teardown; falls through to the ops probe.
        _seq_route(monkeypatch, [("", 1), ("", 0)])
        assert not Gcloud("proj").container.teardown_in_progress("c", region="us-central1")


class TestSecretsWrite:
    def test_exists_probe_argv(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        assert Gcloud("proj").secrets.exists("devstash-ops-config") is True
        assert calls == [["gcloud", "secrets", "describe", "devstash-ops-config", "--project=proj"]]

    def test_exists_false_when_absent(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(monkeypatch, fail=True)  # describe non-zero (check=False probe) → not present
        assert Gcloud("proj").secrets.exists("devstash-ops-config") is False

    def test_create_argv(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        Gcloud("proj").secrets.create("devstash-ops-config")
        assert calls == [
            [
                "gcloud",
                "secrets",
                "create",
                "devstash-ops-config",
                "--replication-policy=automatic",
                "--project=proj",
            ]
        ]

    def test_add_version_pipes_payload_via_stdin(self, monkeypatch: pytest.MonkeyPatch) -> None:
        seen: dict[str, object] = {}

        def _fake_run(
            argv: Sequence[str], *, check: bool = True, input: str | None = None, **_: object
        ) -> Result:
            seen["argv"] = list(argv)
            seen["input"] = input
            return Result(list(argv), "", "", 0)

        monkeypatch.setattr(proc, "run", _fake_run)
        Gcloud("proj").secrets.add_version("devstash-ops-config", '{"k":"v"}')
        assert seen["argv"] == [
            "gcloud",
            "secrets",
            "versions",
            "add",
            "devstash-ops-config",
            "--data-file=-",
            "--project=proj",
        ]
        # The payload rides stdin, never argv — a credential must not touch the process arg list.
        assert seen["input"] == '{"k":"v"}'


class TestStorageLockReads:
    _LOCK = "gs://proj-tfstate-dev/gke/dev/default.tflock"

    def test_cat_returns_blob(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch, out='{"ID":"x"}')
        assert Gcloud("proj").storage.cat(self._LOCK) == '{"ID":"x"}'
        assert calls == [["gcloud", "storage", "cat", self._LOCK]]

    def test_cat_absent_is_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(monkeypatch, fail=True)  # absent object → "" (already released), never raises
        assert Gcloud("proj").storage.cat(self._LOCK) == ""

    def test_object_generation_argv_and_value(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch, out="17654321")
        assert Gcloud("proj").storage.object_generation(self._LOCK) == "17654321"
        assert calls == [
            [
                "gcloud",
                "storage",
                "objects",
                "describe",
                self._LOCK,
                "--format=value(generation)",
            ]
        ]

    def test_object_generation_absent_is_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(monkeypatch, fail=True)  # vanished object → "" (treat as released)
        assert Gcloud("proj").storage.object_generation(self._LOCK) == ""
