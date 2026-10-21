// On-demand media conversion. Chromium can't decode HEIC/HEIF images
// directly, so we shell out to macOS's built-in `sips` to convert them
// to JPEG and cache the result under userData. Returns a file:// URL
// the renderer can use as a regular <img src>.

import { app } from "electron";
import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execAsync = promisify(exec);

function convertedDir(): string {
  const dir = join(app.getPath("userData"), "converted-media");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// Cache key uses the source path + an inode-free hash. Two files at the
// same path are assumed identical; this is fine because attachments in
// chat.db are immutable once written.
function cacheKey(sourcePath: string): string {
  return createHash("sha1").update(sourcePath).digest("hex").slice(0, 24);
}

const inFlight = new Map<string, Promise<string | null>>();

export async function convertHeicToJpeg(
  sourcePath: string,
): Promise<string | null> {
  if (!existsSync(sourcePath)) return null;
  const key = cacheKey(sourcePath);
  const outPath = join(convertedDir(), `${key}.jpg`);
  if (existsSync(outPath)) return pathToFileURL(outPath).href;

  // Dedup concurrent conversions of the same file.
  const existing = inFlight.get(key);
  if (existing) return existing;

  const job = (async (): Promise<string | null> => {
    try {
      // sips: macOS-native, handles HEIC/HEIF natively, no extra deps.
      await execAsync(
        `sips -s format jpeg ${JSON.stringify(sourcePath)} --out ${JSON.stringify(outPath)}`,
        { timeout: 15_000 },
      );
      return existsSync(outPath) ? pathToFileURL(outPath).href : null;
    } catch (err) {
      console.error(
        `[media-prep] HEIC conversion failed for ${basename(sourcePath)}:`,
        (err as Error).message,
      );
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, job);
  return job;
}

/**
 * Convert a Core Audio (.caf) file — which iMessage uses for voice
 * messages — to AAC-in-MP4 (.m4a), which Chromium can decode and
 * play in an <audio> tag. Uses macOS-native `afconvert` (preinstalled
 * since OS X 10.4), no extra deps.
 *
 * Returns a file:// URL to the cached .m4a, or null on failure.
 */
export async function convertAudioToM4a(
  sourcePath: string,
): Promise<string | null> {
  if (!existsSync(sourcePath)) return null;
  const key = cacheKey(sourcePath);
  const outPath = join(convertedDir(), `${key}.m4a`);
  if (existsSync(outPath)) return pathToFileURL(outPath).href;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const job = (async (): Promise<string | null> => {
    try {
      // -f m4af  → MP4-Audio container
      // -d aac   → AAC codec inside it
      // afconvert is the macOS-native audio converter; ships with the OS.
      await execAsync(
        `afconvert -f m4af -d aac ${JSON.stringify(sourcePath)} ${JSON.stringify(outPath)}`,
        { timeout: 30_000 },
      );
      return existsSync(outPath) ? pathToFileURL(outPath).href : null;
    } catch (err) {
      console.error(
        `[media-prep] audio conversion failed for ${basename(sourcePath)}:`,
        (err as Error).message,
      );
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, job);
  return job;
}
