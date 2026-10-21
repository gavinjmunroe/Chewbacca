/**
 * GCP Cloud Storage adapter
 * Used for: photos, transcripts, Loom assets, Fireflies summaries, exported memories
 */

import { Storage } from '@google-cloud/storage'

let storageClient: Storage | null = null

function getStorage(): Storage {
  if (!storageClient) {
    storageClient = new Storage({
      projectId: process.env.GCP_PROJECT_ID,
      keyFilename: process.env.GCP_KEY_FILE,
      // Or use Application Default Credentials (recommended on Railway via env var)
      credentials: process.env.GCP_SERVICE_ACCOUNT_JSON
        ? JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON)
        : undefined
    })
  }
  return storageClient
}

const BUCKET_NAME = process.env.GCP_STORAGE_BUCKET || 'amber-assets'

export async function uploadFile(
  destination: string,
  buffer: Buffer,
  contentType: string,
  metadata?: Record<string, string>
): Promise<string> {
  const storage = getStorage()
  const bucket = storage.bucket(BUCKET_NAME)
  const file = bucket.file(destination)

  await file.save(buffer, {
    contentType,
    metadata: {
      cacheControl: 'private, max-age=0',
      ...metadata
    }
  })

  return `gs://${BUCKET_NAME}/${destination}`
}

export async function downloadFile(gcpPath: string): Promise<Buffer> {
  const storage = getStorage()
  const bucket = storage.bucket(BUCKET_NAME)

  // Strip gs://bucket/ prefix if present
  const filePath = gcpPath.replace(`gs://${BUCKET_NAME}/`, '')
  const file = bucket.file(filePath)

  const [contents] = await file.download()
  return contents
}

export async function deleteFile(gcpPath: string): Promise<void> {
  const storage = getStorage()
  const bucket = storage.bucket(BUCKET_NAME)
  const filePath = gcpPath.replace(`gs://${BUCKET_NAME}/`, '')
  await bucket.file(filePath).delete()
}

export async function getSignedUrl(
  gcpPath: string,
  expiresInMs = 15 * 60 * 1000
): Promise<string> {
  const storage = getStorage()
  const bucket = storage.bucket(BUCKET_NAME)
  const filePath = gcpPath.replace(`gs://${BUCKET_NAME}/`, '')

  const [url] = await bucket.file(filePath).getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresInMs
  })

  return url
}

export async function listFiles(prefix: string): Promise<string[]> {
  const storage = getStorage()
  const bucket = storage.bucket(BUCKET_NAME)
  const [files] = await bucket.getFiles({ prefix })
  return files.map(f => f.name)
}

/** Upload a memory attachment (photo, transcript, etc.) */
export async function uploadMemoryAttachment(
  userId: string,
  memoryId: string,
  filename: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const destination = `users/${userId}/memories/${memoryId}/${filename}`
  return uploadFile(destination, buffer, contentType, {
    userId,
    memoryId
  })
}

/** Upload a person's profile photo */
export async function uploadPersonPhoto(
  userId: string,
  personId: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const ext = contentType === 'image/png' ? 'png' : 'jpg'
  const destination = `users/${userId}/people/${personId}/photo.${ext}`
  return uploadFile(destination, buffer, contentType, { userId, personId })
}
