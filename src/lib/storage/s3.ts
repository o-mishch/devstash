'server-only'

import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { createLogger } from '@/lib/infra/logger'
import type { PresignedPostCredential } from '@/types/item'

const log = createLogger('s3')

export const SIGNED_URL_TTL_SECONDS = 900

let _client: S3Client | null = null

function getClient(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: process.env.AWS_REGION!,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })
  }
  return _client
}

function getBucket(): string {
  return process.env.AWS_S3_BUCKET!
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
    log.error('delete failed', { key, err })
  }
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

export async function getPresignedPostCredential(
  key: string,
  contentType: string,
  maxBytes: number,
  expiresIn = SIGNED_URL_TTL_SECONDS
): Promise<PresignedPostCredential> {
  const { url, fields } = await createPresignedPost(getClient(), {
    Bucket: getBucket(),
    Key: key,
    Conditions: [
      ['content-length-range', 1, maxBytes],
      ['eq', '$Content-Type', contentType],
    ],
    Fields: { 'Content-Type': contentType },
    Expires: expiresIn,
  })
  return { url, fields }
}

export function getSignedUrlExpiresAt(expiresIn = SIGNED_URL_TTL_SECONDS): Date {
  return new Date(Date.now() + expiresIn * 1000)
}
