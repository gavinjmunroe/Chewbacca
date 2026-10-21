import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import fs from 'fs';

vi.mock('../../../src/db/database', () => ({
  db: { prepare: vi.fn() },
  getPlaceWithTags: vi.fn(),
}));
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));

import { unpackKmzToKml, KMZ_DECOMPRESSED_SIZE_LIMIT } from '../../../src/services/placeService';

const KMZ_FIXTURE = path.join(__dirname, '../../fixtures/test.kmz');

describe('unpackKmzToKml', () => {
  it('extracts the KML entry from a valid KMZ', async () => {
    const kmzBuffer = fs.readFileSync(KMZ_FIXTURE);
    const kmlBuffer = await unpackKmzToKml(kmzBuffer);
    expect(kmlBuffer.length).toBeGreaterThan(0);
    expect(kmlBuffer.toString('utf-8')).toContain('<kml');
  });

  it('rejects a KMZ whose KML entry exceeds the decompressed size limit', async () => {
    const kmzBuffer = fs.readFileSync(KMZ_FIXTURE);
    // test.kmz contains a KML with uncompressedSize 634 — set limit to 1 byte
    await expect(unpackKmzToKml(kmzBuffer, 1)).rejects.toThrow('exceeds the maximum allowed decompressed size');
  });

  it('rejects a KMZ that contains no KML file', async () => {
    // Craft a minimal ZIP containing only a non-KML entry using raw ZIP bytes
    // We use the test GPX fixture (a real file) re-zipped via Node's zlib/archiver
    // Simplest: a KMZ whose only file has a .txt extension
    const Archiver = await import('archiver');
    const archiver = Archiver.default;
    const { PassThrough } = await import('stream');

    const chunks: Buffer[] = [];
    const output = new PassThrough();
    output.on('data', (chunk) => chunks.push(chunk));

    const archive = archiver('zip', { zlib: { level: 1 } });
    archive.pipe(output);
    archive.append(Buffer.from('not a kml'), { name: 'data.txt' });
    await archive.finalize();

    const zipBuffer = Buffer.concat(chunks);
    await expect(unpackKmzToKml(zipBuffer)).rejects.toThrow('does not contain a KML file');
  });

  it('rejects a buffer that is not a valid ZIP archive', async () => {
    await expect(unpackKmzToKml(Buffer.from('this is not a zip'))).rejects.toThrow('Invalid KMZ archive');
  });

  it('exports KMZ_DECOMPRESSED_SIZE_LIMIT as 50 MB', () => {
    expect(KMZ_DECOMPRESSED_SIZE_LIMIT).toBe(50 * 1024 * 1024);
  });
});
