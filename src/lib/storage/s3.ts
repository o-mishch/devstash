import 'server-only'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { logger } from '@/lib/infra/pino'
import { localS3Overrides } from '@/lib/storage/s3-local'
import type { PresignedPutCredential } from '@/types/item'

const log = logger.child({ tag: 's3' })

export const SIGNED_URL_TTL_SECONDS = 900

let _client: S3Client | null = null

function getClient(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      // Endpoint comes from AWS_ENDPOINT_URL_S3 (read natively by the SDK).
      // localS3Overrides() adds only forcePathStyle for MinIO; {} in production.
      ...localS3Overrides(),
    })
  }
  return _client
}

function getBucket(): string {
  return process.env.AWS_S3_BUCKET
}

export async function uploadToS3(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  await getClient().send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }))
}

export async function deleteFromS3(key: string): Promise<void> {
  try {
    await getClient().send(new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }))
  } catch (err) {
    log.error({ key, err }, 'delete failed')
  }
}

export interface RangeTextRead {
  text: string
  // True when the object is larger than the BYTE window we pulled — i.e. we did not read the whole file.
  // This is a byte-level signal, NOT a character-level one: the caller still char-bounds the decoded
  // text to its parse window and must OR this flag with its own char-truncation result.
  truncated: boolean
}

// Worst-case UTF-8 bytes per character — sizes the byte range so it always covers `maxChars` characters.
const UTF8_MAX_BYTES_PER_CHAR = 4

// Reads only the leading bytes of an S3 object needed to cover a `maxChars` parse window — a bounded
// `Range: bytes=0-N` GET, never the whole object (Context7-verified AWS SDK v3: the Body is an
// unconsumed stream that must be read exactly once; a `0-N` range on a smaller object simply returns the
// available bytes, so no HEAD/size probe is needed). `truncated` is derived from the response's
// `ContentRange` (`bytes 0-{end}/{total}`) — the object is bigger than what we pulled — with no second
// request. Decodes once as UTF-8: a non-UTF-8 byte, or a multibyte char split at the chosen byte
// boundary (the last char of the window), degrades to a replacement char — tolerated, since
// `boundaryTruncate` trims back to the last newline and the parser drops any partial trailing line.
export async function getTextFromS3(key: string, maxChars: number): Promise<RangeTextRead> {
  const lastByte = maxChars * UTF8_MAX_BYTES_PER_CHAR - 1
  const response = await getClient().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key, Range: `bytes=0-${lastByte}` }),
  )
  if (!response.Body) throw new Error(`S3 object ${key} returned no body`)
  // Consume the stream exactly once — an unconsumed body leaks the socket and cannot be re-read.
  const text = await response.Body.transformToString('utf-8')

  // Derive `truncated` (object bigger than the byte window) most-authoritative source first:
  //   1. ContentRange `bytes 0-{end}/{total}` gives the real object size — definitive.
  //   2. No range total, but ContentLength < the bytes we requested proves a short read → whole object.
  //   3. Neither provable (no header, full-length read) → over-disclose: a feature that must never hide
  //      a clipped source prefers a false "truncated" to a false "complete".
  const requestedBytes = lastByte + 1
  const pulledBytes = response.ContentLength ?? requestedBytes
  const total = Number(response.ContentRange?.split('/').pop())
  let truncated: boolean
  if (Number.isFinite(total)) truncated = total > pulledBytes
  else if (response.ContentLength !== undefined) truncated = response.ContentLength > requestedBytes
  else truncated = true
  log.info({ key, pulledBytes, truncated }, 'getTextFromS3 range read')
  return { text, truncated }
}

export async function getSignedDownloadUrl(
  key: string,
  expiresIn = SIGNED_URL_TTL_SECONDS,
  fileName?: string,
  cacheControl = `max-age=${SIGNED_URL_TTL_SECONDS - 60}, private`,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ...(fileName && {
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
    }),
    ResponseCacheControl: cacheControl,
  })
  return getSignedUrl(getClient(), command, { expiresIn })
}

// Presigned PUT URL for direct browser-to-S3 uploads. GCS S3-interop supports
// query-string-signed PUT (AWS4-HMAC-SHA256) but NOT presigned POST policies
// (which use x-amz-* form fields that GCS rejects). The browser PUTs the raw
// file body directly.
//
// `signableHeaders` is REQUIRED for the size/type guarantees to hold: the presigner
// adds `content-type` to its default unsignableHeaders, and `content-length` is not
// signed unless requested — so without this Set neither would land in
// X-Amz-SignedHeaders and S3/GCS would accept ANY size or type. Listing both forces
// them into the signature, so S3/GCS reject a PUT whose Content-Type or byte length
// differs from what we signed. ContentLength enforces an EXACT match (presigned PUT
// has no content-length-range); callers pass the exact size they will upload. Browsers
// set Content-Length from the blob (a forbidden header JS cannot override), so a client
// cannot understate the size to obtain a credential and then send more. Verified against
// the AWS SDK v3 presigner source + GCS V4 signing (storage.googleapis.com enforces it).
export async function getPresignedPutCredential(
  key: string,
  contentType: string,
  contentLength: number,
  expiresIn = SIGNED_URL_TTL_SECONDS
): Promise<PresignedPutCredential> {
  const url = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    { expiresIn, signableHeaders: new Set(['content-type', 'content-length']) },
  )
  return { url, key, contentType }
}

export function getSignedUrlExpiresAt(expiresIn = SIGNED_URL_TTL_SECONDS): Date {
  return new Date(Date.now() + expiresIn * 1000)
}
