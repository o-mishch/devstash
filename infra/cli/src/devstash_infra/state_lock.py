"""state_lock.py — the lock-aware / network-retry OpenTofu runner (tofu_locked).

CLI zone (3.14). Ports common.sh:tofu_locked — the generic retry wrapper for a
lock-contending tofu op (plan/apply/destroy) with two targeted, SIGNATURE-GATED
recoveries; any other failure re-propagates unchanged.

  1. State-lock failure  → call the `recover` callback (the caller's guided recovery)
     and retry the op EXACTLY ONCE.
  2. Transient network drop (proc.is_network_error) → retry up to `network_retries`
     times with a `network_gap` backoff, NO recover (the transport just blipped; the
     GCP ops are idempotent and state re-uploads on retry). Bounded via tenacity so a
     persistently-down uplink still terminates with the real error.

Gated to the signatures so a real provider/quota/permission error fails LOUDLY on the
first attempt. The interactive lock recovery (`_recover_state_lock`, holder probes,
the `unlock` command) is a separate operator-facing subsystem ported with app_gcp.
"""

from collections.abc import Callable
from typing import cast

from tenacity import RetryError, Retrying, retry_if_result, stop_after_attempt, wait_fixed

from devstash_infra.shared.proc import Result, is_lock_error, is_network_error

# TOFU_NETWORK_RETRIES / TOFU_NETWORK_RETRY_GAP defaults (common.sh:213).
_NETWORK_RETRIES = 3
_NETWORK_GAP = 15.0


def tofu_locked(
    run_op: Callable[[], Result],
    recover: Callable[[], bool],
    *,
    network_retries: int = _NETWORK_RETRIES,
    network_gap: float = _NETWORK_GAP,
) -> Result:
    """Run `run_op` with lock + transient-network recovery (common.sh:233).

    `run_op` runs one tofu attempt (typically proc.long_running of `tofu … plan/
    apply/destroy`) returning its captured Result. `recover` is the guided lock
    recovery, called at most once on a lock failure; it returns True if the lock was
    cleared (→ retry once) or False (→ re-propagate without retrying).
    """
    result = run_op()
    if result.ok:
        return result

    # 1. State-lock failure → recover once, retry exactly once (never loop).
    if is_lock_error(result.stdout):
        if recover():
            return run_op()  # whatever the single retry yields is the outcome
        return result  # recovery declined → re-propagate the original lock failure

    # A non-lock, non-network failure fails loudly on the first attempt.
    if not is_network_error(result.stdout):
        return result

    # 2. Transient network drop → bounded retry (tenacity), no recover. The first
    #    (already-failed) attempt above counts as attempt 0; tenacity does up to
    #    `network_retries` MORE, matching the shell's 1-initial + N-retries budget.
    retrying = Retrying(
        stop=stop_after_attempt(network_retries),
        wait=wait_fixed(network_gap),
        retry=retry_if_result(lambda r: not r.ok and is_network_error(r.stdout)),
        reraise=False,
    )
    try:
        return retrying(run_op)
    except RetryError as exc:
        # Bounded exhaustion: return the last real result (the shell re-propagates the
        # last error). A non-network failure mid-retry stops tenacity and returns
        # normally (retry_if_result is False), so only a persistent network drop lands
        # here. last_attempt.result() is Any (tenacity is untyped) → pin it to Result.
        return cast("Result", exc.last_attempt.result())
