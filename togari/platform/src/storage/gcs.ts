/**
 * @togari/admin — Tenant-scoped Google Cloud Storage
 */

import { Storage, Bucket } from '@google-cloud/storage';
import { createLogger } from '../observability/logger';
import { getCurrentTenant } from '../tenant/context';

const logger = createLogger('GCSClient');

export class GCSClient {
  private bucket: Bucket;

  constructor(bucketName: string, projectId?: string) {
    const storage = new Storage({ projectId: projectId || process.env.GCP_PROJECT_ID });
    this.bucket = storage.bucket(bucketName);
  }

  private tenantPath(path: string): string {
    const tenant = getCurrentTenant();
    return `tenants/${tenant.tenantId}/${path}`;
  }

  validatePathOwnership(path: string): void {
    const tenant = getCurrentTenant();
    if (!path.startsWith(`tenants/${tenant.tenantId}/`)) {
      throw new Error('Cross-tenant GCS access denied');
    }
  }

  async upload(path: string, data: Buffer, contentType?: string): Promise<string> {
    const fullPath = this.tenantPath(path);
    const tenant = getCurrentTenant();
    const file = this.bucket.file(fullPath);
    await file.save(data, {
      metadata: {
        contentType: contentType || 'application/octet-stream',
        metadata: { 'x-goog-meta-tenant-id': tenant.tenantId },
      },
    });
    return fullPath;
  }

  async download(path: string): Promise<Buffer> {
    this.validatePathOwnership(path);
    const [content] = await this.bucket.file(path).download();
    return content;
  }

  async list(prefix: string): Promise<string[]> {
    const fullPrefix = this.tenantPath(prefix);
    const [files] = await this.bucket.getFiles({ prefix: fullPrefix });
    return files.map((f) => f.name);
  }

  async getSignedUrl(path: string, expiresInMinutes = 60): Promise<string> {
    this.validatePathOwnership(path);
    const [url] = await this.bucket.file(path).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiresInMinutes * 60 * 1000,
    });
    return url;
  }

  async delete(path: string): Promise<void> {
    this.validatePathOwnership(path);
    await this.bucket.file(path).delete();
  }
}
