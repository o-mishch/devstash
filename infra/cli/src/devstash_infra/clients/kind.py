"""clients/kind.py — a typed facade over the kind CLI. CLI zone (3.14).

The local stack provisions a `kind` cluster (via OpenTofu) and loads locally-built images into it so
no registry pull is needed. kind has no Python surface worth the dependency, so it stays subprocess
behind this facade with its argv asserted in the client's own tests. Reads are tolerant (a probe for
`run 'up' first`); the image load raises (a failed load must abort the deploy).
"""

from devstash_infra.shared import proc


class Kind:
    """`kind …` — cluster-presence probe + local-image load for the local kind stack."""

    def cluster_names(self) -> list[str]:
        """`kind get clusters` → the cluster names (tolerant → [] when kind/Docker is unreachable).

        Tolerant because `require_kind_cluster` treats "no cluster" and "kind can't answer" alike —
        both mean the caller must run `up` first, never an error to surface.
        """
        result = proc.run(["kind", "get", "clusters"], check=False)
        return result.out.splitlines() if result.ok else []

    def load_image(self, image: str, *, cluster: str) -> None:
        """`kind load docker-image <image> --name <cluster>` — push a local image into the cluster.

        Raises `ProcError` on failure: an image that never made it into kind would leave the rollout
        pulling a tag that isn't in any registry, so a load failure must abort the deploy loudly.
        """
        proc.run(["kind", "load", "docker-image", image, "--name", cluster])
