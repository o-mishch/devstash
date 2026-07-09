"""shared/log.py — structured JSON logging + secret redaction. 3.14 floor, stdlib-only.

The observability primitives shared by BOTH log paths (§Observability compliance):
- the **redaction** core (`redact_text` / `redact_mapping`) — strips secret payloads, tokens,
  and `--secret=`/`X-API-Secret:`/`Bearer` values BEFORE anything is serialized, so a logged
  argv or event can never leak a credential.
- a stdlib `logging` **JSON formatter** + `configure` for the Cloud Build auto-suspend path
  (which runs on cloud-sdk:slim's python3 with zero install — so NO structlog here; the CLI's
  `obs.py` reuses this same redaction under structlog to emit the identical JSON shape).

Redaction lives in the FLOOR (not obs.py) on purpose: the unattended auto-suspend path handles
the same secret payloads and must scrub them with the same rules, structlog-free.
"""

import json
import logging
import re
from collections.abc import Mapping, Sequence
from typing import Any, cast, override

REDACTED = "«redacted»"

# Key names whose VALUE is sensitive — redacted wholesale in a structured event.
_SENSITIVE_KEY_RE = re.compile(
    r"secret|token|password|passwd|api[-_ ]?key|credential|private[-_ ]?key|bearer|payload",
    re.IGNORECASE,
)

# Inline sensitive patterns in free text / argv — mask the VALUE, keep the shape so the log
# still shows WHICH flag/header carried a secret (useful for debugging) without the secret.
_TEXT_PATTERNS = (
    re.compile(r"(--(?:secret|token|password|api-key|api-secret|data)[= ])(\S+)", re.IGNORECASE),
    re.compile(r"(X-API-(?:Key|Secret):\s*)(\S+)", re.IGNORECASE),
    re.compile(r"(Authorization:\s*Bearer\s+)(\S+)", re.IGNORECASE),
)


def is_sensitive_key(key: str) -> bool:
    """True iff a structured-event key names a secret value (redact it wholesale)."""
    return _SENSITIVE_KEY_RE.search(key) is not None


def redact_text(text: str) -> str:
    """Mask secret values inline in free text / argv, preserving the surrounding shape."""
    for pattern in _TEXT_PATTERNS:
        text = pattern.sub(r"\g<1>" + REDACTED, text)
    return text


def _redact_value(value: object) -> Any:
    """Scrub one event value, recursing through nested mappings and list/tuple containers.

    A secret can hide anywhere a structured event carries it — inline in an `argv=[...]` list, a
    tuple of headers, or a dict nested in a list — so redaction must reach every container, not
    just the top-level string. `str`/`bytes` are Sequences but are leaves here (scrubbed as text).
    Takes `object` (not `Any`) so both checkers narrow the isinstance arms to concrete types.
    """
    if isinstance(value, Mapping):
        # isinstance loses the type params (→ Mapping[Unknown, Unknown]) — re-assert them.
        return redact_mapping(cast("Mapping[str, Any]", value))
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, Sequence) and not isinstance(value, bytes | bytearray):
        # pyright narrows the Sequence to Unknown elements; the cast re-asserts them. mypy already
        # infers Sequence[object] here, so it reads the cast as redundant — ignore that one code.
        seq = cast("Sequence[Any]", value)  # type: ignore[redundant-cast]
        return [_redact_value(item) for item in seq]
    return value


def redact_mapping(event: Mapping[str, Any]) -> dict[str, Any]:
    """Deep-redact a structured event: sensitive keys wholesale, every other value recursively."""
    return {
        key: REDACTED if is_sensitive_key(key) else _redact_value(value)
        for key, value in event.items()
    }


class JsonFormatter(logging.Formatter):
    """A stdlib-logging JSON formatter: one redacted JSON object per line, with the run id.

    The Cloud Build side's counterpart to obs.py's structlog JSONRenderer — same fields
    (`event`, `level`, `run_id`, plus any `context` mapping) so both layers ship one uniform,
    parseable stream. Structured context is passed via `logger.info(msg, extra={"context": {...}})`.
    """

    def __init__(self, run_id: str) -> None:
        super().__init__()
        self._run_id = run_id

    @override
    def format(self, record: logging.LogRecord) -> str:
        event: dict[str, Any] = {
            "event": redact_text(record.getMessage()),
            "level": record.levelname.lower(),
            "run_id": self._run_id,
        }
        context = getattr(record, "context", None)
        if isinstance(context, Mapping):
            event.update(redact_mapping(cast("Mapping[str, Any]", context)))
        return json.dumps(event, default=str)


def configure(run_id: str, *, level: int = logging.INFO) -> logging.Logger:
    """Install the JSON formatter on the `devstash_infra` logger (Cloud Build path)."""
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter(run_id))
    logger = logging.getLogger("devstash_infra")
    logger.handlers = [handler]
    logger.setLevel(level)
    logger.propagate = False
    return logger
