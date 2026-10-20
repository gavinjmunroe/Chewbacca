/**
 * GCP Cloud Storage client for file upload, download, and management
 */

import { Storage, Bucket, File } from '@google-cloud/storage';
import { v4 as uuid } from 'uuid';
import { createLogger } from '../../utils';
import { UpstreamAPIError } from '../../errors';
import { FileUploadOptions, StoredFile, DownloadResult } from './types';

const logger = createLogger('CloudStorageClient');

export class CloudStorageClient {
  private storage: Storage;
  private bucket: Bucket;
  private bucketName: string;

  constructor(projectId: string, bucketName: string) {
    this.storage = new Storage({ projectId });
    this.bucket = this.storage.bucket(bucketName);
    this.bucketName = bucketName;
  }

  /**
   * Upload a file to Cloud Storage
   */
  async uploadFile(
    content: Buffer | string,
    options: FileUploadOptions
  ): Promise<StoredFile> {
    try {
      const fileId = uuid();
      const path = `${options.folder || 'uploads'}/${options.userId}/${fileId}/${options.fileName}`;
      const file = this.bucket.file(path);

      const buffer = Buffer.isBuffer(content)
        ? content
        : Buffer.from(content, 'utf-8');

      await file.save(buffer, {
        metadata: {
          contentType: options.mimeType,
          metadata: options.metadata,
        },
      });

      logger.info('File uploaded successfully', {
        fileId,
        path,
        size: buffer.length,
        mimeType: options.mimeType,
        userId: options.userId,
      });

      return {
        id: fileId,
        bucket: this.bucketName,
        path,
        originalName: options.fileName,
        mimeType: options.mimeType,
        size: buffer.length,
        uploadedBy: options.userId,
        uploadedAt: new Date(),
        gsUrl: `gs://${this.bucketName}/${path}`,
        metadata: options.metadata,
      };
    } catch (error) {
      logger.error('Failed to upload file', error, {
        fileName: options.fileName,
        userId: options.userId,
      });
      throw new UpstreamAPIError('gcs', error);
    }
  }

  /**
   * Download a file from Cloud Storage
   */
  async downloadFile(path: string): Promise<DownloadResult> {
    try {
      const file = this.bucket.file(path);
      const [content] = await file.download();
      const [metadata] = await file.getMetadata();

      logger.info('File downloaded successfully', {
        path,
        size: content.length,
      });

      return {
        content,
        metadata: {
          id: path.split('/')[2] || path, // Extract fileId from path
          bucket: this.bucketName,
          path,
          originalName: path.split('/').pop() || path,
          mimeType: metadata.contentType || 'application/octet-stream',
          size: Number(metadata.size) || content.length,
          uploadedBy: String(metadata.metadata?.uploadedBy || 'unknown'),
          uploadedAt: new Date(metadata.timeCreated || Date.now()),
          gsUrl: `gs://${this.bucketName}/${path}`,
          metadata: metadata.metadata as Record<string, string> | undefined,
        },
      };
    } catch (error) {
      logger.error('Failed to download file', error, { path });
      throw new UpstreamAPIError('gcs', error);
    }
  }

  /**
   * Generate a signed URL for temporary file access
   */
  async getSignedUrl(path: string, expiresInMinutes: number = 60): Promise<string> {
    try {
      const file = this.bucket.file(path);
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + expiresInMinutes * 60 * 1000,
      });

      logger.info('Generated signed URL', {
        path,
        expiresInMinutes,
      });

      return url;
    } catch (error) {
      logger.error('Failed to generate signed URL', error, { path });
      throw new UpstreamAPIError('gcs', error);
    }
  }

  /**
   * Delete a file from Cloud Storage
   */
  async deleteFile(path: string): Promise<void> {
    try {
      const file = this.bucket.file(path);
      await file.delete();

      logger.info('File deleted successfully', { path });
    } catch (error) {
      logger.error('Failed to delete file', error, { path });
      throw new UpstreamAPIError('gcs', error);
    }
  }

  /**
   * List files in Cloud Storage with optional prefix and user filter
   */
  async listFiles(prefix: string, userId?: string): Promise<StoredFile[]> {
    try {
      const fullPrefix = userId ? `${prefix}/${userId}` : prefix;
      const [files] = await this.bucket.getFiles({ prefix: fullPrefix });

      const storedFiles = await Promise.all(
        files.map(async (file: File) => {
          const [metadata] = await file.getMetadata();
          const pathParts = file.name.split('/');

          return {
            id: pathParts[2] || file.name,
            bucket: this.bucketName,
            path: file.name,
            originalName: pathParts[pathParts.length - 1] || file.name,
            mimeType: metadata.contentType || 'application/octet-stream',
            size: Number(metadata.size) || 0,
            uploadedBy: String(metadata.metadata?.uploadedBy || 'unknown'),
            uploadedAt: new Date(metadata.timeCreated || Date.now()),
            gsUrl: `gs://${this.bucketName}/${file.name}`,
            metadata: metadata.metadata as Record<string, string> | undefined,
          };
        })
      );

      logger.info('Listed files', {
        prefix: fullPrefix,
        count: storedFiles.length,
      });

      return storedFiles;
    } catch (error) {
      logger.error('Failed to list files', error, { prefix, userId });
      throw new UpstreamAPIError('gcs', error);
    }
  }

  /**
   * Check if a file exists in Cloud Storage
   */
  async fileExists(path: string): Promise<boolean> {
    try {
      const file = this.bucket.file(path);
      const [exists] = await file.exists();

      logger.info('Checked file existence', { path, exists });

      return exists;
    } catch (error) {
      logger.error('Failed to check file existence', error, { path });
      throw new UpstreamAPIError('gcs', error);
    }
  }

  /**
   * Convenience method for saving JSON data
   */
  async saveJson(data: unknown, options: FileUploadOptions): Promise<StoredFile> {
    const jsonString = JSON.stringify(data, null, 2);
    return this.uploadFile(Buffer.from(jsonString), {
      ...options,
      mimeType: 'application/json',
    });
  }

  /**
   * Read and parse JSON file from Cloud Storage
   */
  async readJson<T>(path: string): Promise<T> {
    try {
      const { content } = await this.downloadFile(path);
      return JSON.parse(content.toString('utf-8')) as T;
    } catch (error) {
      logger.error('Failed to read JSON file', error, { path });
      throw new UpstreamAPIError('gcs', error);
    }
  }
}
