#!/bin/sh
# Ran as the pgAdmin seed-pgpass initContainer: libpq requires the pgpass to be readable
# only by owner/group, but the ConfigMap mount is read-only — so copy it into the writable
# emptyDir first, then fix the mode. The pod's fsGroup (5050, pgAdmin's runtime gid) already
# owns the emptyDir, so no chown is needed (and none is possible: this container runs as a
# non-root, non-pgAdmin uid under the restricted PodSecurity profile). Mounted via the
# pgadmin-seed-script ConfigMap. POSIX sh (busybox image), not bash.
set -eu

cp /seed/pgpass /pgpass-dir/pgpass
chmod 640 /pgpass-dir/pgpass
