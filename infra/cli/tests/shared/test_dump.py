"""Tests for shared/dump.py — parity port of dump.bats.

Covers the data-safety contract: export→verify→retry [fix #4] (NEVER let a suspend
destroy an un-dumped instance) and the per-object version prune (keep=0 refused).
"""

from devstash_infra.shared import dump
from tests.conftest import CaptureStdinFn, ExpectFn, RecordedCallsFn

_EXPORT = [
    "gcloud",
    "sql",
    "export",
    "sql",
    "inst",
    "gs://b/o.sql",
    "--database=devstash",
    "--project=proj",
]
_DESCRIBE = ["gcloud", "storage", "objects", "describe", "gs://b/o.sql", "--format=value(size)"]
_RM = ["gcloud", "storage", "rm", "gs://b/o.sql", "--quiet"]


def _export() -> dump.DumpResult:
    return dump.export_and_verify_dump("inst", "gs://b/o.sql", "devstash", "proj")


class TestExportAndVerify:
    def test_fix_04_empty_then_nonempty_verified_one_delete_before_retry(
        self, expect: ExpectFn, recorded_calls: RecordedCallsFn
    ) -> None:
        """[fix #4] Attempt 1 leaves a 0-byte object → it is deleted BEFORE the retry,
        attempt 2 produces a non-empty dump → verified with the size.

        Source: posix/dump.sh:27-36. `gcloud sql export` can leave a 0-byte object on a
        transient failure; re-exporting over it would verify the stale empty object, so
        the retry deletes it first. The delete-empty must fire exactly once.
        """
        expect(_EXPORT, stdout="", occurrences=2)  # export attempts 1 & 2
        expect(_DESCRIBE, stdout="0\n")  # attempt 1 size: empty
        expect(_RM, stdout="")  # delete-empty before retry
        expect(_DESCRIBE, stdout="2048\n")  # attempt 2 size: good

        result = _export()
        assert result.verified is True
        assert result.size_bytes == 2048
        # The empty attempt-1 object was deleted exactly once before the retry.
        assert recorded_calls().count(_RM) == 1

    def test_fix_04_always_empty_aborts_no_size(self, expect: ExpectFn) -> None:
        """[fix #4] If the dump stays empty across both attempts, verified is False and
        no size is returned — the caller MUST turn this into a data-safety abort and
        NEVER destroy an un-dumped instance (posix/dump.sh:35-36).
        """
        expect(_EXPORT, stdout="", occurrences=2)
        expect(_DESCRIBE, stdout="0\n", occurrences=2)
        expect(_RM, stdout="", occurrences=2)

        result = _export()
        assert result.verified is False
        assert result.size_bytes is None

    def test_non_numeric_size_then_good_tolerated_retried(self, expect: ExpectFn) -> None:
        expect(_EXPORT, stdout="", occurrences=2)
        expect(_DESCRIBE, stdout="garbage\n")  # non-numeric → delete + retry
        expect(_RM, stdout="")
        expect(_DESCRIBE, stdout="999\n")

        result = _export()
        assert result.verified is True
        assert result.size_bytes == 999


class TestPruneDumpVersions:
    _LS = ["gcloud", "storage", "ls", "-a", "gs://b/**"]
    _RM_STDIN = ["gcloud", "storage", "rm", "-I", "-c", "--quiet"]
    _LISTING = (
        "gs://b/default.tfstate#1700000000000005\n"
        "gs://b/default.tfstate#1700000000000004\n"
        "gs://b/default.tfstate#1700000000000003\n"
        "gs://b/o.sql#1700000000000009\n"
        "gs://b/o.sql#1700000000000008\n"
        "gs://b/o.sql#1700000000000007\n"
    )

    def test_keep_newest_2_per_object_deletes_oldest_of_each(
        self, expect: ExpectFn, capture_stdin: CaptureStdinFn
    ) -> None:
        expect(self._LS, stdout=self._LISTING)
        # Capture the stdin piped to `gcloud storage rm -I` (the stale #generation
        # URLs) — the pytest-subprocess equivalent of bats spy_capture_stdin/spy_stdin.
        piped = capture_stdin(self._RM_STDIN, stdout="")

        dump.prune_dump_versions("gs://b/", 2)

        assert len(piped) == 1
        lines = [ln for ln in piped[0].splitlines() if "#" in ln]
        # The stale generations fed on stdin are the single OLDEST of EACH object.
        assert "gs://b/default.tfstate#1700000000000003" in lines
        assert "gs://b/o.sql#1700000000000007" in lines
        assert "gs://b/default.tfstate#1700000000000005" not in lines
        assert len(lines) == 2

    def test_keep_zero_refused_gcloud_never_reached(self, recorded_calls: RecordedCallsFn) -> None:
        # keep < 1 returns BEFORE any ls/rm — zero subprocess calls (safety guard).
        dump.prune_dump_versions("gs://b/", 0)
        assert len(recorded_calls()) == 0
