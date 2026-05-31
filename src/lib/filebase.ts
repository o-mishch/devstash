import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import type { Readable } from 'stream'
import { createLogger } from '@/lib/logger'

const log = createLogger('filebase')

let _client: S3Client | null = null

function getClient(): S3Client {
  if (!_client) {
    _client = new S3Client({
      endpoint: 'https://s3.filebase.io',
      region: 'us-east-1',
      credentials: {
        accessKeyId: process.env.FILEBASE_KEY!,
        secretAccessKey: process.env.FILEBASE_SECRET!,
      },
      forcePathStyle: true,
    })
  }
  return _client
}

function getBucket(): string {
  return process.env.FILEBASE_BUCKET!
}

export async function uploadToFilebase(
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

export async function deleteFromFilebase(key: string): Promise<void> {
  try {
    await getClient().send(new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }))
  } catch (err) {
    log.error(`delete failed: ${key}`, err)
  }
}

export async function downloadFromFilebase(key: string): Promise<Readable | null> {
  try {
    const response = await getClient().send(new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }))
    return response.Body as Readable
  } catch (err) {
    // NoSuchKey is expected when a file was deleted from storage but the DB record remains.
    if (err instanceof Error && err.name === 'NoSuchKey') {
      log.warn(`file not found in storage: ${key}`)
      return null
    }
    log.error(`download failed: ${key}`, err)
    return null
  }
}
