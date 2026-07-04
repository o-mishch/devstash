#!/bin/sh
# Ran as the pgAdmin seed-pgpass initContainer: libpq requires the pgpass to be 0600 and
# owned by the pgAdmin runtime uid (5050), but the ConfigMap mount is read-only — so copy it
# into the writable emptyDir first, then fix ownership/mode. Mounted via the
# pgadmin-seed-script ConfigMap. POSIX sh (busybox image), not bash.
set -eu

cp /seed/pgpass /pgpass-dir/pgpass
chown 5050:5050 /pgpass-dir/pgpass
chmod 600 /pgpass-dir/pgpass
