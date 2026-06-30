import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RequestChecksumCalculation, ResponseChecksumValidation } from '@aws-sdk/middleware-flexible-checksums'
import { localS3Overrides } from './s3-local'

// Every S3-compatible endpoint (MinIO, GCS interop) also needs the SDK's default CRC checksums
// downgraded to WHEN_REQUIRED — GCS rejects the v3 ≥ 3.758 trailing checksums. Bundled with
// path-style so both travel together whenever AWS_ENDPOINT_URL_S3 is set.
const s3CompatOverrides = {
  forcePathStyle: true,
  requestChecksumCalculation: RequestChecksumCalculation.WHEN_REQUIRED,
  responseChecksumValidation: ResponseChecksumValidation.WHEN_REQUIRED,
}

// localS3Overrides() decides whether the AWS SDK uses PATH-STYLE addressing.
// The gate is AWS_ENDPOINT_URL_S3 presence: every S3-compatible endpoint we point at
// (MinIO locally, GCS interop on GKE) needs path-style, while real AWS S3 (Vercel)
// is the only path that leaves the endpoint var unset and stays virtual-host style.
describe('localS3Overrides', () => {
  const originalEndpoint = process.env.AWS_ENDPOINT_URL_S3

  beforeEach(() => {
    delete process.env.AWS_ENDPOINT_URL_S3
  })

  afterEach(() => {
    process.env.AWS_ENDPOINT_URL_S3 = originalEndpoint
  })

  it('returns {} for real AWS S3 (no endpoint override — Vercel)', () => {
    expect(localS3Overrides()).toEqual({})
  })

  it('forces path-style + WHEN_REQUIRED checksums for local MinIO (http://localhost:9000)', () => {
    process.env.AWS_ENDPOINT_URL_S3 = 'http://localhost:9000'
    expect(localS3Overrides()).toEqual(s3CompatOverrides)
  })

  it('forces path-style + WHEN_REQUIRED checksums for the GCS S3-interop endpoint (GKE deploy)', () => {
    process.env.AWS_ENDPOINT_URL_S3 = 'https://storage.googleapis.com'
    expect(localS3Overrides()).toEqual(s3CompatOverrides)
  })

  it('returns {} when the endpoint is an empty string', () => {
    process.env.AWS_ENDPOINT_URL_S3 = ''
    expect(localS3Overrides()).toEqual({})
  })
})
