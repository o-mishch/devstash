"""obs.py — structured JSON logging for the operator CLI (structlog). CLI zone (3.14).

The CLI counterpart to `shared/log.py`: structlog with a JSON renderer, a per-invocation
`run_id` bound via contextvars (auto-injected into every event), and a redaction processor
that REUSES the floor's `redact_mapping` — so the CLI and the Cloud Build path emit the exact
same scrubbed JSON shape (§Observability compliance). structlog is pure-Python but stays
CLI-only to honor the floor's no-third-party-import rule.

This is the machine-readable/shippable stream; the operator-facing coloured console lines
(log/ok/warn/die) stay in common.py. `cli.py` calls `configure(run_id)` once at startup.
"""

from typing import cast

import structlog
from structlog.typing import EventDict, WrappedLogger

from devstash_infra.shared import log as shared_log


def _redact_processor(_logger: WrappedLogger, _method: str, event_dict: EventDict) -> EventDict:
    """Structlog processor: scrub secrets via the floor's shared redaction rules."""
    return shared_log.redact_mapping(dict(event_dict))


def configure(run_id: str) -> None:
    """Configure structlog: contextvars run_id → redaction → JSON. Idempotent per process.

    `run_id` is minted once by cli.py (uuid4, or Cloud Build `$BUILD_ID` / GH `$GITHUB_RUN_ID`
    when present) and bound so every subsequent event carries it for cross-log correlation.
    """
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(run_id=run_id)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            _redact_processor,
            structlog.processors.JSONRenderer(),
        ],
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(**initial_values: object) -> structlog.stdlib.BoundLogger:
    """A bound structlog logger — the CLI's structured event emitter (`log.info(event, **ctx)`)."""
    return cast("structlog.stdlib.BoundLogger", structlog.get_logger(**initial_values))
