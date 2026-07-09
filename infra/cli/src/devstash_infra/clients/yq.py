"""clients/yq.py — a typed facade over the yq CLI. CLI zone (3.14).

The deploy pipeline manipulates YAML manifests with yq (image injection here, the render/ssa filters
later), so yq stays the single YAML transformer rather than introducing a Python YAML library whose
expression power wouldn't match yq's anyway. `eval` returns the transformed document as text so the
caller pipes it straight to `kubectl apply -f -` — no temp file, unlike the shell.
"""

import os
from collections.abc import Mapping

from devstash_infra.shared import proc


class Yq:
    """`yq <expression> <input>`. Returns the transformed YAML as text (raises on a yq error)."""

    def eval(
        self, expression: str, input_path: str, *, env_extra: Mapping[str, str] | None = None
    ) -> str:
        """Evaluate `expression` against `input_path`, returning the result document.

        `env_extra` is merged OVER the process environment so a `strenv(VAR)` in `expression` reads
        a caller value WITHOUT quoting it into the expression string (safe against an image ref that
        could otherwise break the yq syntax). Raises `ProcError` on a yq failure.
        """
        env = {**os.environ, **dict(env_extra or {})} if env_extra else None
        return proc.run(["yq", expression, input_path], env=env).stdout

    def eval_stdin(
        self, expression: str, manifest: str, *, env_extra: Mapping[str, str] | None = None
    ) -> str:
        """`yq <expression> -` with `manifest` on stdin — select a slice of a rendered doc.

        The local stack pipes `kubectl kustomize <dir>` straight into `yq select(<expr>)` and on to
        `kubectl apply` (no temp file); this is the middle stage. Same `env_extra` strenv merge as
        `eval`. Raises `ProcError` on a yq failure.
        """
        env = {**os.environ, **dict(env_extra or {})} if env_extra else None
        return proc.run(["yq", expression, "-"], input=manifest, env=env).stdout

    def eval_in_place(
        self, expression: str, path: str, *, env_extra: Mapping[str, str] | None = None
    ) -> None:
        """`yq -i <expression> <path>` — transform `path` IN PLACE. Raises `ProcError` on failure.

        Used by inject-settings (mutating the overlay's settings.yaml/kustomization.yaml before the
        render) and by render-manifests (the post-render securityPolicy fix). Same `env_extra`
        strenv merge as `eval`.
        """
        env = {**os.environ, **dict(env_extra or {})} if env_extra else None
        proc.run(["yq", "-i", expression, path], env=env)
