import { Storage } from '@google-cloud/storage';
import * as fs from 'fs-extra';
import { config } from '../config/env.js';

const storage = config.storage.bucket ? new Storage() : null;

export async function putJsonObject(params: { bucket?: string; key?: string; localDir?: string; obj: unknown }) {
  const body = Buffer.from(JSON.stringify(params.obj));
  const bucket = params.bucket || config.storage.bucket;
  
  if (bucket && params.key && storage) {
    const gcsBucket = storage.bucket(bucket);
    const file = gcsBucket.file(params.key);
    await file.save(body, {
      contentType: 'application/json',
      metadata: { contentType: 'application/json' },
    });
    return { uri: `gs://${bucket}/${params.key}` };
  }
  
  // Fallback to local file storage
  const dir = params.localDir || '.data';
  await fs.ensureDir(dir);
  const file = `${dir}/${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  await fs.writeFile(file, body);
  return { uri: `file://${file}` };
}



