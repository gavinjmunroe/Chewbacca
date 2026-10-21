import { createHash, randomBytes } from 'crypto';

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function generateDataKey32(): Buffer {
  return randomBytes(32);
}




