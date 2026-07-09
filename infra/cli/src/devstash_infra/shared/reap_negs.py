"""shared/reap_negs.py — reap the zonal NEGs + stray firewall rules GKE leaks.

3.14 floor, stdlib-only. Port of infra/lib/posix/reap-negs.sh — the ONE source of
truth for the reap loops, shared by the laptop `suspend`/`down` path and the Cloud
Build cleanup-negs step.

WHY GKE leaks these (reap-negs.sh:11-16): destroying a cluster (our deep suspend
does a count→0 apply every cycle) frequently shuts down the NEG controller BEFORE
it deletes the zonal NEGs the ingress created, and leaves stray gke-*/k8s-* firewall
rules by the same race. On suspend the VPC survives so a leak blocks nothing yet —
but the orphans ACCUMULATE across suspend generations and eventually pin the VPC
delete at `down`. Reaping keeps the count bounded.

SCOPE — VPC-scoped, never name-guessed (server-side --filter on network). Best-
effort throughout: every failure is logged and swallowed — the env is already at
~$0, so a cleanup miss must never fail the suspend. The VPC-existence gate is NOT
here (caller-specific); only the reap loops are shared.

EVERYTHING IS A PARAMETER (reap-negs.sh:28-30): no ambient env reads.
"""

import sys

from devstash_infra.shared import proc


def reap_leaked_negs(vpc: str, project: str) -> None:
    """Delete every leaked zonal NEG and stray gke-*/k8s-* firewall rule on `vpc`.

    Ports ds_reap_leaked_negs (reap-negs.sh:41). A NEG delete takes its name + zone
    (so we iterate name<TAB>zone rows); firewall rules take just a name. No matches →
    a clean no-op. Each `list` is read first so a transient hiccup can't abort under
    the caller's error handling, and each delete tolerates a non-zero exit (already
    gone / in use).
    """
    sys.stderr.write(f"Reaping leaked GKE NEGs on {vpc} (orphaned by cluster teardown)\n")
    negs = proc.run(
        [
            "gcloud",
            "compute",
            "network-endpoint-groups",
            "list",
            f"--project={project}",
            f"--filter=network:{vpc}",
            "--format=value(name,zone.basename())",
        ],
        check=False,
    )
    neg_rows = negs.out if negs.ok else ""
    if neg_rows:
        for line in neg_rows.splitlines():
            parts = line.split("\t")
            if not parts or not parts[0]:
                continue
            name, zone = parts[0], (parts[1] if len(parts) > 1 else "")
            sys.stderr.write(f"  deleting NEG {name} ({zone})\n")
            deleted = proc.run(
                [
                    "gcloud",
                    "compute",
                    "network-endpoint-groups",
                    "delete",
                    name,
                    f"--zone={zone}",
                    f"--project={project}",
                    "--quiet",
                ],
                check=False,
            )
            if not deleted.ok:
                sys.stderr.write(
                    f"  NEG {name} delete returned non-zero (already gone / in use) — continuing\n"
                )
    else:
        sys.stderr.write(f"no leaked NEGs on {vpc} — nothing to reap\n")

    sys.stderr.write(f"Reaping stray GKE firewall rules on {vpc}\n")
    fw = proc.run(
        [
            "gcloud",
            "compute",
            "firewall-rules",
            "list",
            f"--project={project}",
            f"--filter=network:{vpc} AND name:(gke-* OR k8s-*)",
            "--format=value(name)",
        ],
        check=False,
    )
    fw_rows = fw.out if fw.ok else ""
    if fw_rows:
        for name in fw_rows.splitlines():
            if not name:
                continue
            sys.stderr.write(f"  deleting firewall rule {name}\n")
            deleted = proc.run(
                [
                    "gcloud",
                    "compute",
                    "firewall-rules",
                    "delete",
                    name,
                    f"--project={project}",
                    "--quiet",
                ],
                check=False,
            )
            if not deleted.ok:
                sys.stderr.write(
                    f"  firewall {name} delete returned non-zero (already gone) — continuing\n"
                )
    else:
        sys.stderr.write(f"no stray GKE firewall rules on {vpc} — nothing to reap\n")
