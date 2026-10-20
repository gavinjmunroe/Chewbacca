/**
 * GCP Cloud Storage client for file upload, download, and management
 */

import { Storage, Bucket, File } from '@google-cloud/storage';
import { v4 as uuid } from 'uuid';
import { createLogger } from '../../utils';
import { UpstreamAPIError } from '../../errors';
import { connectorRegistry } from '../registry';
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
   * Build tenant-scoped path: tenants/{client_id}/{folder}/{userId}/{fileId}/{fileName}
   * Falls back to flat path if no clientId provided (backward compat for local dev).
   */
  private buildPath(options: FileUploadOptions, fileId: string): string {
    const folder = options.folder || 'uploads';
    if (options.clientId) {
      return `tenants/${options.clientId}/${folder}/${options.userId}/${fileId}/${options.fileName}`;
    }
    return `${folder}/${options.userId}/${fileId}/${options.fileName}`;
  }

  /**
   * Validate that a path belongs to the given tenant. Throws if cross-tenant access.
   */
  validatePathOwnership(path: string, clientId: string): void {
    if (path.startsWith('tenants/')) {
      const pathTenantId = path.split('/')[1];
      if (pathTenantId !== clientId) {
        throw new Error('Access denied: cross-tenant file access is not permitted');
      }
    }
  }

  /**
   * Upload a file to Cloud Storage with tenant-scoped paths
   */
  async uploadFile(
    content: Buffer | string,
    options: FileUploadOptions
  ): Promise<StoredFile> {
    try {
      const fileId = uuid();
      const path = this.buildPath(options, fileId);
      const file = this.bucket.file(path);

      const buffer = Buffer.isBuffer(content)
        ? content
        : Buffer.from(content, 'utf-8');

      await connectorRegistry.execute('gcs', () =>
        file.save(buffer, {
          metadata: {
            contentType: options.mimeType,
            metadata: {
              ...options.metadata,
              ...(options.clientId ? { 'x-goog-meta-tenant-id': options.clientId } : {}),
            },
          },
        })
      );

      logger.info('File uploaded successfully', {
        fileId,
        path,
        size: buffer.length,
        mimeType: options.mimeType,
        userId: options.userId,
        clientId: options.clientId,
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
   * Download a file from Cloud Storage.
   * If clientId is provided, validates tenant ownership before downloading.
   */
  async downloadFile(path: string, clientId?: string): Promise<DownloadResult> {
    if (clientId) {
      this.validatePathOwnership(path, clientId);
    }
    try {
      const file = this.bucket.file(path);
      const [content] = await connectorRegistry.execute('gcs', () => file.download());
      const [metadata] = await connectorRegistry.execute('gcs', () => file.getMetadata());

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
   * Generate a signed URL for temporary file access.
   * If clientId is provided, validates tenant ownership.
   */
  async getSignedUrl(path: string, expiresInMinutes: number = 60, clientId?: string): Promise<string> {
    if (clientId) {
      this.validatePathOwnership(path, clientId);
    }
    try {
      const file = this.bucket.file(path);
      const [url] = await connectorRegistry.execute('gcs', () =>
        file.getSignedUrl({
          action: 'read',
          expires: Date.now() + expiresInMinutes * 60 * 1000,
        })
      );

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
   * Delete a file from Cloud Storage.
   * If clientId is provided, validates tenant ownership.
   */
  async deleteFile(path: string, clientId?: string): Promise<void> {
    if (clientId) {
      this.validatePathOwnership(path, clientId);
    }
    try {
      const file = this.bucket.file(path);
      await connectorRegistry.execute('gcs', () => file.delete());

      logger.info('File deleted successfully', { path });
    } catch (error) {
      logger.error('Failed to delete file', error, { path });
      throw new UpstreamAPIError('gcs', error);
    }
  }

  /**
   * List files in Cloud Storage with optional prefix and user filter.
   * If clientId is provided, scopes listing to tenant prefix.
   */
  async listFiles(prefix: string, userId?: string, clientId?: string): Promise<StoredFile[]> {
    try {
      const tenantPrefix = clientId ? `tenants/${clientId}/${prefix}` : prefix;
      const fullPrefix = userId ? `${tenantPrefix}/${userId}` : tenantPrefix;
      const [files] = await connectorRegistry.execute('gcs', () =>
        this.bucket.getFiles({ prefix: fullPrefix })
      );

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
      const [exists] = await connectorRegistry.execute('gcs', () => file.exists());

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
