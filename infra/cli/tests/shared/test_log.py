"""Tests for shared/log.py — the floor redaction + JSON formatter (§Observability).

The compliance-mandated assertion: a planted secret/token is scrubbed from BOTH free text
(argv, headers) and structured event keys before serialization — it must never appear in the
emitted JSON. Also covers the stdlib JsonFormatter's run_id + context redaction.
"""

import json
import logging

from devstash_infra.shared import log

_SECRET = "sk-live-DEADBEEF-super-secret-token"


class TestRedactText:
    def test_masks_secret_flag_value(self) -> None:
        out = log.redact_text(f"gcloud x --secret={_SECRET} --project=proj")
        assert _SECRET not in out
        assert "--secret=" in out and "--project=proj" in out  # shape preserved
        assert log.REDACTED in out

    def test_masks_api_secret_header(self) -> None:
        out = log.redact_text(f"X-API-Secret: {_SECRET}")
        assert _SECRET not in out
        assert out.startswith("X-API-Secret: ")

    def test_masks_bearer_token(self) -> None:
        out = log.redact_text(f"Authorization: Bearer {_SECRET}")
        assert _SECRET not in out

    def test_leaves_benign_text_untouched(self) -> None:
        assert log.redact_text("tofu apply -lock-timeout=120s") == "tofu apply -lock-timeout=120s"


class TestRedactMapping:
    def test_sensitive_keys_wholesale(self) -> None:
        out = log.redact_mapping({"api_secret": _SECRET, "token": "t", "region": "us"})
        assert out["api_secret"] == log.REDACTED
        assert out["token"] == log.REDACTED
        assert out["region"] == "us"  # benign key kept

    def test_string_values_scrubbed_inline(self) -> None:
        out = log.redact_mapping({"argv": f"curl -H 'X-API-Key: {_SECRET}'"})
        assert _SECRET not in out["argv"]

    def test_nested_mapping_deep_redacted(self) -> None:
        out = log.redact_mapping({"outer": {"password": _SECRET, "ok": 1}})
        assert out["outer"]["password"] == log.REDACTED
        assert out["outer"]["ok"] == 1

    def test_secret_in_list_value_scrubbed(self) -> None:
        out = log.redact_mapping({"argv": ["gcloud", f"--secret={_SECRET}", "--project=p"]})
        assert _SECRET not in json.dumps(out)  # inline-masked inside the list
        assert out["argv"][0] == "gcloud"

    def test_secret_in_dict_nested_in_list_scrubbed(self) -> None:
        out = log.redact_mapping({"records": [{"password": _SECRET}, {"ok": 1}]})
        assert out["records"][0]["password"] == log.REDACTED
        assert out["records"][1]["ok"] == 1

    def test_secret_in_tuple_value_scrubbed(self) -> None:
        out = log.redact_mapping(
            {"headers": ("Content-Type: json", f"Authorization: Bearer {_SECRET}")}
        )
        assert _SECRET not in json.dumps(out)  # tuple is walked like a list

    def test_is_sensitive_key(self) -> None:
        assert log.is_sensitive_key("spaceship-api-secret")
        assert log.is_sensitive_key("AUTH_TOKEN")
        assert not log.is_sensitive_key("project")


class TestJsonFormatter:
    def _record(self, msg: str, context: object = None) -> logging.LogRecord:
        fields: dict[str, object] = {"msg": msg, "levelname": "INFO"}
        if context is not None:
            fields["context"] = context
        return logging.makeLogRecord(fields)

    def test_emits_run_id_and_level(self) -> None:
        line = log.JsonFormatter("run-123").format(self._record("apply started"))
        event = json.loads(line)
        assert event == {"event": "apply started", "level": "info", "run_id": "run-123"}

    def test_redacts_message_and_context(self) -> None:
        record = self._record(f"pushing --secret={_SECRET}", context={"token": _SECRET, "n": 3})
        event = json.loads(log.JsonFormatter("r").format(record))
        assert _SECRET not in json.dumps(event)  # scrubbed everywhere
        assert event["token"] == log.REDACTED
        assert event["n"] == 3
