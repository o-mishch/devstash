#!/bin/sh
# Ran once (as the minio-bucket-init Job) against the in-cluster MinIO: create the uploads
# bucket and make it publicly readable, so signed GET URLs and direct reads work the same as
# a typical S3 dev bucket. Mounted into minio/mc via the minio-bucket-init-script ConfigMap.
# POSIX sh (not bash) — the minio/mc image ships busybox, no bash.
set -eu

until mc alias set local http://minio:9000 minioadmin minioadmin; do
  echo "waiting for minio..."
  sleep 2
done
mc mb --ignore-existing local/devstash-uploads
mc anonymous set download local/devstash-uploads
echo "bucket ready"
