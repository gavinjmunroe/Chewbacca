/**
 * GCP Cloud Storage types
 */

export interface FileUploadOptions {
  fileName: string;
  mimeType: string;
  userId: string;
  folder?: string; // e.g., 'raw', 'processed', 'results'
  metadata?: Record<string, string>;
}

export interface StoredFile {
  id: string;
  bucket: string;
  path: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: Date;
  gsUrl: string; // gs://bucket/path format
  publicUrl?: string;
  metadata?: Record<string, string>;
}

export interface DownloadResult {
  content: Buffer;
  metadata: StoredFile;
}
