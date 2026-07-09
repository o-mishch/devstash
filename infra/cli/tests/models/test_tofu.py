"""Tests for models/tofu.py — TofuOutputs value/missing + the TfLock display model."""

from devstash_infra.models.tofu import TfLock, TofuOutputs


class TestTofuOutputs:
    def test_value_and_fallback(self) -> None:
        outputs = TofuOutputs.model_validate({"app_domain": {"value": "gke.devstash.one"}})
        assert outputs.value("app_domain") == "gke.devstash.one"
        assert outputs.value("missing", "fb") == "fb"

    def test_missing_lists_absent_and_empty(self) -> None:
        outputs = TofuOutputs.model_validate({"a": {"value": "x"}, "b": {"value": ""}})
        assert outputs.missing("a", "b", "c") == ["b", "c"]


class TestTfLock:
    def test_parses_aliased_fields_and_host(self) -> None:
        lock = TfLock.model_validate(
            {"ID": "uuid-1", "Who": "alice@buildbox", "Operation": "Apply", "Created": "2026-07-09"}
        )
        assert lock.id == "uuid-1"
        assert lock.who == "alice@buildbox"
        assert lock.host == "buildbox"  # the host half selects the local-PID probe

    def test_empty_lock_defaults(self) -> None:
        lock = TfLock()
        assert lock.id == ""
        assert lock.host == ""  # no Who → no host to match
