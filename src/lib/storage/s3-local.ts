import 'server-only'

import type { S3ClientConfig } from '@aws-sdk/client-s3'

// Applied when AWS_ENDPOINT_URL_S3 is set (GCS on GKE, MinIO locally).
// Real AWS S3 on Vercel leaves it unset. DO NOT add a separate S3_LOCAL flag —
// the endpoint var is already the exact discriminator.
//
// forcePathStyle: GCS/MinIO require path-style; no env var exists for this.
//
// checksum opts: SDK v3 ≥ 3.758 sends CRC checksums by default; GCS rejects them
// ("Invalid argument. Expected checksum … did not match"). WHEN_REQUIRED restores
// pre-3.758 behaviour without adding new env vars to ESO/ConfigMap.
// Passed as the string-literal union the config expects rather than importing the
// enum from an internal SDK package — that path moved across SDK minor versions
// (@aws-sdk/middleware-flexible-checksums → @aws-sdk/checksums) and broke the build.
// The Partial<S3ClientConfig> return type still rejects any typo at compile time.
// Source: https://www.beginswithdata.com/2025/05/14/aws-s3-tools-with-gcs/
export function localS3Overrides(): Partial<S3ClientConfig> {
  return process.env.AWS_ENDPOINT_URL_S3
    ? {
        forcePathStyle: true,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      }
    : {}
}
