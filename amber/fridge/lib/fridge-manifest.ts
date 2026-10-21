/**
 * THE ONE FILE PASSED BETWEEN THE TWO TRACKS.
 *
 * The 3D track renders the kitchen and writes public/kitchen/v2/manifest.json;
 * the web track only ever reads it. These types are the schema from
 * docs/FRIDGE-CONTRACT.md, word for word, plus one optional field the web
 * track reads if it is there (`focus`, below).
 *
 * loadManifest() asks for the real file first. Until the render lands, or if
 * the file is half written mid-render, the page runs on PLACEHOLDER, built
 * from the v1 stills in lib/fridge-placeholder.ts. Dropping the placeholder
 * is deleting that import.
 */

import type { Camera, Light, Pt, Rect } from "./fridge";
import { PLACEHOLDER } from "./fridge-placeholder";

export type { Camera, Light, Pt, Rect };

export type ObjectId = "note" | "polaroid" | "bizcard" | "resume" | "prayer";

export interface Clip {
  rect: Rect;
  /** mp4 h264: out from under the magnet, forward, turned to its back. */
  in: string;
  /** The same frames reversed. */
  out: string;
  /** The last frame as webp: the reduced-motion end state and the fallback. */
  poster: string;
  /** Door objects only: the held front, and when `in` reaches it (seconds).
   *  The page pauses there until the next click turns the object over. */
  front?: string;
  frontAt?: number;
  /** Door objects only: where the held object sits, [x, y, w, h] percent of
   *  the frame. A click inside turns it; outside puts it back. */
  held?: Rect;
}

export interface FridgeObject {
  id: ObjectId;
  label: string;
  backText: string;
  hotspot: Record<Camera, Pt[]>;
  clip: Record<Camera, Record<Light, Clip>>;
}

export interface JournalPage {
  rect: Rect;
  image: string;
  nameColumn: Pt[];
  numberColumn: Pt[];
  firstLine: number;
  lineGap: number;
}

export interface AmbientLoop {
  src: string;
  rect: [number, number, number, number];
}

export interface Manifest {
  version: 2;
  cameras: Record<
    Camera,
    {
      width: number;
      height: number;
      /**
       * Web-only, optional: the point (percent) cover-cropping keeps nearest
       * the centre. The real renders are framed per camera and leave it out.
       */
      focus?: Pt;
    }
  >;
  stills: Record<Camera, Record<Light, string>>;
  objects: FridgeObject[];
  clock: Record<
    Camera,
    Record<Light, { pivot: Pt; hour: string; minute: string; cap: string }>
  >;
  shelf: {
    hotspot: Record<Camera, Pt[][]>;
    years: number[];
    clip: Record<Camera, Record<Light, Clip[]>>;
  };
  journal: {
    hotspot: Record<Camera, Pt[]>;
    page: Record<Camera, Record<Light, JournalPage>>;
  };
  // Short seamless loops, each placed over the still at its own rect.
  ambient: Record<Camera, Record<Light, { steam?: AmbientLoop; lamp?: AmbientLoop }>>;
}

export const MANIFEST_URL = "/kitchen/v2/manifest.json";

/**
 * Enough of a check to refuse a manifest the page cannot draw: a file caught
 * mid-write, or one from an older schema. Field-by-field typing is the 3D
 * track's job; this guards the shape the page indexes into.
 */
export function isManifest(value: unknown): value is Manifest {
  if (!value || typeof value !== "object") return false;
  const m = value as Partial<Manifest>;
  return (
    m.version === 2 &&
    !!m.cameras?.wide &&
    !!m.cameras?.tall &&
    !!m.stills?.wide?.golden &&
    !!m.stills?.tall?.golden &&
    Array.isArray(m.objects) &&
    !!m.journal?.page &&
    !!m.shelf?.clip &&
    !!m.clock
  );
}

export async function loadManifest(): Promise<Manifest> {
  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (res.ok) {
      const json: unknown = await res.json();
      if (isManifest(json)) return json;
    }
  } catch {
    // No render yet, or a half-written file: the placeholder below stands in.
  }
  return PLACEHOLDER;
}

export { PLACEHOLDER };
