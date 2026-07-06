#!/usr/bin/env python3
"""Print the OpenTofu state-lock ID from a lock object's JSON on stdin.

Language stays segregated from the POSIX-sh lock-contention helper
(infra/lib/posix/lock-contention.sh) the same way the guard/prepare Python does:
a standalone, independently lintable/testable file invoked with `python3`, never
inlined into the shell. The gke/dev/default.tflock object is a small JSON blob
whose "ID" field is the exact value `tofu force-unlock <ID>` needs; emitting only
that keeps the shell from parsing JSON. A malformed/empty blob prints nothing and
exits non-zero so the caller refuses to force-unlock on a value it could not read.
"""

import json
import sys


def main() -> int:
    try:
        lock = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 1
    lock_id = lock.get("ID") if isinstance(lock, dict) else None
    if not lock_id:
        return 1
    print(lock_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
