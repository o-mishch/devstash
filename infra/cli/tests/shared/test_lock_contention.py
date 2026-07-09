"""Tests for shared/lock_contention.py — parity port of lock-contention.bats.

Mirrors the two fragile parts: (a) the createTime tiebreak incl. the exact-tie
boundary that must NOT defer, and (b) the force-unlock safety gates that must NEVER
break a live or unparseable lock — force-unlocking ALWAYS by the GCS generation,
never the JSON "ID" UUID [fix #1].
"""

from collections.abc import Callable

from devstash_infra.shared import lock_contention as lc
from tests.conftest import RecordedCallsFn

_DESCRIBE = [
    "gcloud",
    "builds",
    "describe",
    "self",
    "--region=reg",
    "--project=proj",
    "--format=value(createTime)",
]
_LIST = [
    "gcloud",
    "builds",
    "list",
    "--region=reg",
    "--project=proj",
    "--ongoing",
    "--filter=substitutions.TRIGGER_NAME=trig AND id!=self",
    "--format=value(id,createTime)",
]


def _self(expect: Callable[..., None], ts: str) -> None:
    expect(_DESCRIBE, stdout=f"{ts}\n" if ts else "")


def _siblings(expect: Callable[..., None], rows: str) -> None:
    expect(_LIST, stdout=rows)


class TestTiebreak:
    def test_older_sibling_defers(self, expect: Callable[..., None]) -> None:
        _self(expect, "2026-07-06T02:00:05Z")
        _siblings(expect, "aaaa\t2026-07-06T01:59:29Z\n")
        assert lc.older_autosuspend_build_running("reg", "proj", "trig", "self") is True

    def test_only_newer_sibling_proceeds(self, expect: Callable[..., None]) -> None:
        _self(expect, "2026-07-06T02:00:05Z")
        _siblings(expect, "bbbb\t2026-07-06T02:01:00Z\n")
        assert lc.older_autosuspend_build_running("reg", "proj", "trig", "self") is False

    def test_no_siblings_proceeds(self, expect: Callable[..., None]) -> None:
        _self(expect, "2026-07-06T02:00:05Z")
        _siblings(expect, "")
        assert lc.older_autosuspend_build_running("reg", "proj", "trig", "self") is False

    def test_mixed_siblings_one_older_defers(self, expect: Callable[..., None]) -> None:
        _self(expect, "2026-07-06T02:00:05Z")
        _siblings(expect, "bbbb\t2026-07-06T02:01:00Z\ncccc\t2026-07-06T01:58:00Z\n")
        assert lc.older_autosuspend_build_running("reg", "proj", "trig", "self") is True

    def test_exact_tie_proceeds_a_tie_is_not_older(self, expect: Callable[..., None]) -> None:
        # The boundary case: an equal createTime is NOT older — proceed, don't defer.
        _self(expect, "2026-07-06T02:00:05Z")
        _siblings(expect, "dddd\t2026-07-06T02:00:05Z\n")
        assert lc.older_autosuspend_build_running("reg", "proj", "trig", "self") is False

    def test_self_createtime_unknown_proceeds_fail_open(self, expect: Callable[..., None]) -> None:
        # A transient describe hiccup → fail open (proceed); layers 2/3 still protect.
        _self(expect, "")
        assert lc.older_autosuspend_build_running("reg", "proj", "trig", "self") is False


# ── force_unlock_if_dead — safety gates ──────────────────────────────────────────
_LOCK_URI = "gs://bucket/gke/dev/default.tflock"
_CAT = ["gcloud", "storage", "cat", _LOCK_URI, "--project=proj"]
_OTHERS = [
    "gcloud",
    "builds",
    "list",
    "--region=reg",
    "--project=proj",
    "--ongoing",
    "--filter=substitutions.TRIGGER_NAME=trig AND id!=self",
    "--format=value(id)",
]
_GEN = [
    "gcloud",
    "storage",
    "objects",
    "describe",
    _LOCK_URI,
    "--project=proj",
    "--format=value(generation)",
]


def _run() -> bool:
    return lc.force_unlock_if_dead("reg", "proj", "bucket", "trig", "self")


class TestForceUnlock:
    def test_lock_already_gone_retry_nothing_unlocked(self, expect: Callable[..., None]) -> None:
        expect(_CAT, stdout="")  # no lock object
        assert _run() is True
        # `tofu force-unlock` was never registered/called — its absence is the assertion.

    def test_live_sibling_noop_live_lock_never_unlocked(self, expect: Callable[..., None]) -> None:
        expect(_CAT, stdout='{"ID":"123"}')
        expect(_OTHERS, stdout="siblingbuild\n")
        assert _run() is False

    def test_fix_01_orphaned_lock_force_unlocked_by_generation_not_uuid(
        self,
        expect: Callable[..., None],
        fixture_contents: Callable[[str], str],
        recorded_calls: RecordedCallsFn,
    ) -> None:
        """[fix #1] An orphaned lock (no sibling) is force-unlocked by the GCS object
        GENERATION, NEVER the JSON "ID" UUID.

        Source: common.sh:131 + posix/lock-contention.sh:116-134. GCS rejects the UUID
        with "Lock ID should be numerical value", silently leaving the orphaned lock in
        place (the real incident). Pin the generation in the force-unlock argv; forbid
        the UUID from ever appearing.
        """
        expect(_CAT, stdout=fixture_contents("lock-orphaned.json"))
        expect(_OTHERS, stdout="")  # no sibling → orphaned
        expect(_GEN, stdout="1783337489797257\n")
        expect(["tofu", "force-unlock", "-force", "1783337489797257"], stdout="")
        assert _run() is True
        recorded = recorded_calls()
        # force-unlock was called with the GENERATION...
        assert recorded.count(["tofu", "force-unlock", "-force", "1783337489797257"]) == 1
        # ...and the UUID from the JSON "ID" NEVER appears in any recorded argv.
        uuid = "ce7ace5f-ada3-25a0-f88a-a7ec9dac342d"
        assert all(uuid not in " ".join(call) for call in recorded)

    def test_generation_unreadable_noop_not_unlocked(
        self, expect: Callable[..., None], fixture_contents: Callable[[str], str]
    ) -> None:
        # JSON parses (well-formed) but generation can't be read → refuse, don't guess.
        expect(_CAT, stdout=fixture_contents("lock-orphaned.json"))
        expect(_OTHERS, stdout="")
        expect(_GEN, stdout="")
        assert _run() is False

    def test_unparseable_lock_id_noop_blind_never_unlocked(
        self, expect: Callable[..., None]
    ) -> None:
        expect(_CAT, stdout="garbage-not-json")
        expect(_OTHERS, stdout="")
        assert _run() is False


class TestParseLockId:
    def test_extracts_id(self) -> None:
        assert lc.parse_lock_id('{"ID":"abc"}') == "abc"

    def test_malformed_returns_empty(self) -> None:
        assert lc.parse_lock_id("garbage-not-json") == ""

    def test_missing_id_returns_empty(self) -> None:
        assert lc.parse_lock_id('{"Who":"root@host"}') == ""

    def test_non_object_returns_empty(self) -> None:
        assert lc.parse_lock_id("[1,2,3]") == ""
