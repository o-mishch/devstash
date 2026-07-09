"""Tests for gcp/db.py — parity port of db.bats (the Db collaborator: restore [fix #5] + resolve).

The gcloud/tofu argv the collaborator's clients emit is unchanged from the shell, so these keep the
`expect`/`recorded_calls` fake_process fixtures and assert the exact argv. (The sql-instance
presence probe moved to gcloud.sql.instance_exists — its argv is asserted in test_gcloud.py.)
"""

import pytest

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.tofu import Tofu
from devstash_infra.environment import GcpConfig
from devstash_infra.gcp.db import Db, DumpTarget
from devstash_infra.shared.errors import InfraError
from tests.conftest import ExpectFn, RecordedCallsFn

_CONFIG = GcpConfig(
    project="proj",
    region="us-central1",
    environment="dev",
    db_name="devstash",
    state_bucket="proj-tfstate-dev",
)
_TARGET = DumpTarget(
    instance="devstash-dev-sql",
    dump_uri="gs://proj-dumps/devstash-latest.sql",
    db_name="devstash",
)
_DESCRIBE_DUMP = ["gcloud", "storage", "objects", "describe", _TARGET.dump_uri]


def _db(verb: str) -> list[str]:
    return [
        "gcloud",
        "sql",
        "databases",
        verb,
        "devstash",
        "--instance=devstash-dev-sql",
        "--project=proj",
        "--quiet",
    ]


_IMPORT = [
    "gcloud",
    "sql",
    "import",
    "sql",
    "devstash-dev-sql",
    _TARGET.dump_uri,
    "--database=devstash",
    "--project=proj",
    "--quiet",
]


def _collab(tf_dir: str = "tf/dev") -> Db:
    return Db(_CONFIG, Gcloud("proj"), Tofu(tf_dir))


class TestRestoreAlreadyLive:
    def test_fix_05_already_live_skips_import_entirely(
        self, recorded_calls: RecordedCallsFn, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """[fix #5] was_already_live=True skips restore — never touches gcloud sql, and
        short-circuits BEFORE even checking for the dump object (db.sh:144).
        """
        _collab().restore(_TARGET, was_already_live=True)
        out = capsys.readouterr().out
        assert "already existed before this resume's apply ran" in out
        assert "Skipping restore" in out
        assert len(recorded_calls()) == 0  # zero gcloud calls — not even the describe

    def test_fix_05_defaults_to_not_live(
        self, expect: ExpectFn, capsys: pytest.CaptureFixture[str]
    ) -> None:
        expect(_DESCRIBE_DUMP, returncode=1, stderr="NOT_FOUND")  # no dump present
        _collab().restore(_TARGET)
        assert "no dump at" in capsys.readouterr().out


class TestRestoreGenuine:
    def test_no_dump_present_skips(
        self, expect: ExpectFn, capsys: pytest.CaptureFixture[str]
    ) -> None:
        expect(_DESCRIBE_DUMP, returncode=1, stderr="NOT_FOUND")
        _collab().restore(_TARGET, was_already_live=False)
        out = capsys.readouterr().out
        assert "no dump at" in out
        assert "Resetting database" not in out

    def test_genuine_restore_drops_recreates_imports(
        self, expect: ExpectFn, recorded_calls: RecordedCallsFn, capsys: pytest.CaptureFixture[str]
    ) -> None:
        expect(_DESCRIBE_DUMP, stdout="exists")
        expect(_db("delete"), stdout="")
        expect(_db("create"), stdout="")
        expect(_IMPORT, stdout="")
        _collab().restore(_TARGET, was_already_live=False)
        out = capsys.readouterr().out
        assert "Resetting database" in out
        assert "Importing" in out
        assert "DB restored from" in out
        calls = recorded_calls()
        assert _db("delete") in calls
        assert _db("create") in calls
        assert _IMPORT in calls

    def test_fresh_instance_delete_fails_then_proceeds(
        self, expect: ExpectFn, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # database delete fails (did not exist) → warn-and-continue, restore succeeds.
        expect(_DESCRIBE_DUMP, stdout="exists")
        expect(_db("delete"), returncode=1, stderr="not found")
        expect(_db("create"), stdout="")
        expect(_IMPORT, stdout="")
        _collab().restore(_TARGET, was_already_live=False)
        out = capsys.readouterr().out
        assert "did not exist" in out
        assert "DB restored from" in out

    def test_import_failure_raises_with_retry_safe_hint(self, expect: ExpectFn) -> None:
        expect(_DESCRIBE_DUMP, stdout="exists")
        expect(_db("delete"), stdout="")
        expect(_db("create"), stdout="")
        expect(_IMPORT, returncode=1, stderr="relation exists")
        with pytest.raises(InfraError):
            _collab().restore(_TARGET, was_already_live=False)


class TestRestoreUnresolvable:
    def test_none_target_skips_without_raising(
        self, recorded_calls: RecordedCallsFn, capsys: pytest.CaptureFixture[str]
    ) -> None:
        _collab().restore(None, was_already_live=False)
        assert "no instance / dump bucket / object resolved" in capsys.readouterr().out
        assert len(recorded_calls()) == 0


class TestResolveDumpTarget:
    _OUT = ["tofu", "-chdir=tf/dev", "output", "-json"]

    def test_resolves_from_tofu_outputs(self, expect: ExpectFn) -> None:
        expect(
            self._OUT,
            stdout=(
                '{"db_instance_name": {"value": "devstash-dev-sql"},'
                ' "db_dumps_bucket": {"value": "proj-dumps"},'
                ' "db_dump_object": {"value": "devstash-latest.sql"}}'
            ),
        )
        assert _collab().resolve_dump_target() == _TARGET

    def test_missing_output_returns_none(self, expect: ExpectFn) -> None:
        expect(self._OUT, stdout="{}")  # empty state → unresolvable
        assert _collab().resolve_dump_target() is None


# ── dump [fix #4] (export + verify BEFORE destroy) ────────────────────────────
_OUT = ["tofu", "-chdir=tf/dev", "output", "-json"]
_OUTPUTS = (
    '{"db_instance_name": {"value": "devstash-dev-sql"},'
    ' "db_dumps_bucket": {"value": "proj-dumps"},'
    ' "db_dump_object": {"value": "devstash-latest.sql"},'
    ' "db_dump_keep_versions": {"value": "2"}}'
)
_STATE = [
    "gcloud", "sql", "instances", "describe", "devstash-dev-sql",
    "--project=proj", "--format=value(state)",
]  # fmt: skip
_EXPORT = [
    "gcloud", "sql", "export", "sql", "devstash-dev-sql", _TARGET.dump_uri,
    "--database=devstash", "--project=proj",
]  # fmt: skip
_SIZE = ["gcloud", "storage", "objects", "describe", _TARGET.dump_uri, "--format=value(size)"]
_PRUNE_LS = ["gcloud", "storage", "ls", "-a", f"{_TARGET.dump_uri}**"]
_PATCH = [
    "gcloud", "sql", "instances", "patch", "devstash-dev-sql",
    "--project=proj", "--activation-policy=ALWAYS", "--quiet",
]  # fmt: skip
_RM = ["gcloud", "storage", "rm", _TARGET.dump_uri, "--quiet"]
_EXISTS = ["gcloud", "sql", "instances", "describe", "devstash-dev-sql", "--project=proj"]


class TestDump:
    def test_runnable_exports_verifies_and_prunes(
        self, expect: ExpectFn, capsys: pytest.CaptureFixture[str]
    ) -> None:
        expect(_OUT, stdout=_OUTPUTS, occurrences=2)  # resolve + keep_versions read
        expect(_STATE, stdout="RUNNABLE")
        expect(_EXPORT, stdout="")
        expect(_SIZE, stdout="1024")  # non-empty → verified
        expect(_PRUNE_LS, stdout="")  # empty listing → prune no-op
        _collab().dump(runnable_gap_s=0.0)
        assert "DB exported and verified" in capsys.readouterr().out

    def test_absent_instance_skips(
        self, expect: ExpectFn, capsys: pytest.CaptureFixture[str]
    ) -> None:
        expect(_OUT, stdout=_OUTPUTS)  # resolve only — returns before keep_versions
        expect(_STATE, returncode=1, stderr="NOT_FOUND")  # instance_state → "" (absent)
        _collab().dump(runnable_gap_s=0.0)  # idempotent teardown — no raise
        assert "already destroyed by a prior suspend" in capsys.readouterr().out

    def test_stopped_instance_started_before_dump(
        self, expect: ExpectFn, recorded_calls: RecordedCallsFn
    ) -> None:
        expect(_OUT, stdout=_OUTPUTS, occurrences=2)
        expect(_STATE, stdout="STOPPED")  # first read → needs starting
        expect(_STATE, stdout="RUNNABLE")  # poll → now runnable
        expect(_PATCH, stdout="")
        expect(_EXPORT, stdout="")
        expect(_SIZE, stdout="2048")
        expect(_PRUNE_LS, stdout="")
        _collab().dump(runnable_gap_s=0.0)
        assert _PATCH in recorded_calls()  # activation-policy patch issued

    def test_unverified_dump_aborts(self, expect: ExpectFn) -> None:
        expect(_OUT, stdout=_OUTPUTS)  # resolve — raises before keep_versions
        expect(_STATE, stdout="RUNNABLE")
        expect(_EXPORT, returncode=1, occurrences=2)  # export fails both attempts
        expect(_SIZE, returncode=1, occurrences=2)  # object never present
        expect(_RM, occurrences=2)  # delete-empty-before-retry, both attempts
        with pytest.raises(InfraError, match="could not produce a non-empty dump"):
            _collab().dump(runnable_gap_s=0.0)

    def test_no_target_raises(self, expect: ExpectFn) -> None:
        expect(_OUT, stdout="{}")  # unresolvable → run 'apply' first
        with pytest.raises(InfraError, match="run 'apply' first"):
            _collab().dump(runnable_gap_s=0.0)


class TestDbAlreadyLive:
    def test_true_when_instance_exists(self, expect: ExpectFn) -> None:
        expect(_EXISTS, stdout="devstash-dev-sql")
        assert _collab().db_already_live(_TARGET) is True

    def test_false_when_absent(self, expect: ExpectFn) -> None:
        expect(_EXISTS, returncode=1, stderr="NOT_FOUND")
        assert _collab().db_already_live(_TARGET) is False

    def test_false_when_target_none(self) -> None:
        assert _collab().db_already_live(None) is False
