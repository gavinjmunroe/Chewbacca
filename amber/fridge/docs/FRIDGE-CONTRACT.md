# Fridge build contract, v2

Rewritten 2026-10-07 for the locked spec. Every agent on `feat/fridge-draft`
reads this, then `docs/FRIDGE-SPEC.md`, then the "Paused" section of
`docs/FRIDGE-NEXT.md`, before writing anything. The spec wins over every
older doc. The phone, the threads, the eight capability cards and the side
panels are gone.

## Two tracks, one handoff file

| Track | Owns                                                                                                                                                | Dev port / dist dir |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 3D    | `scratch-render/**`, `public/kitchen/v2/**` (renders, clips, `manifest.json`)                                                                       | none                |
| Web   | `components/Kitchen.tsx`, `components/objects/**`, `components/join/**`, `app/kitchen.css`, `app/page.tsx`, `lib/fridge.ts`, `app/api/guestbook/**` | 3205, `.next-web`   |

Never edit a file the other track owns. Never touch Karthik's files
(`lib/phone.ts`, `lib/amber.ts`, `lib/card.ts`, `lib/constellation.ts`,
`lib/people-rows.ts`, `components/ContactCard.tsx`, `NetworkGraph.tsx`,
`app/login`, `app/network`, existing `app/api` routes).

The only thing passed between tracks is `public/kitchen/v2/manifest.json`.
The web track builds against `lib/fridge-manifest.ts` (types below, web owns
it) and a placeholder manifest until the real one lands.

## manifest.json

All coordinates are percentages (0..100) of the frame for that camera.

```ts
type Light = "morning" | "golden" | "night";
type Camera = "wide" | "tall"; // wide 16:9 desktop, tall 9:19.5 phone, separate Blender cameras
type Pt = [number, number];

interface Manifest {
  version: 2;
  cameras: Record<Camera, { width: number; height: number }>;
  stills: Record<Camera, Record<Light, string>>; // webp, plus "-1920"/"-1080" smaller variants
  objects: {
    id: "note" | "polaroid" | "bizcard" | "resume" | "prayer";
    label: string; // accessible name, e.g. "Notebook page on the freezer door"
    backText: string; // the back's line, for screen readers
    hotspot: Record<Camera, Pt[]>; // polygon over the object at rest
    clip: Record<
      Camera,
      Record<
        Light,
        {
          rect: [number, number, number, number]; // x, y, w, h of the clip over the still
          in: string; // mp4 h264, object slides out, comes forward, turns to its back, last frame holds
          out: string; // the same frames reversed
          poster: string; // last frame as webp, the reduced-motion end state
        }
      >
    >;
  }[];
  clock: Record<
    Camera,
    Record<
      Light,
      {
        pivot: Pt;
        hour: string;
        minute: string;
        cap: string; // full-frame transparent PNG layers
      }
    >
  >;
  shelf: {
    hotspot: Record<Camera, Pt[]>; // one polygon per volume, in year order
    years: number[]; // 2019..2025
    clip: Record<
      Camera,
      Record<
        Light,
        {
          rect: [number, number, number, number];
          in: string;
          out: string;
          poster: string;
        }[]
      >
    >;
  };
  journal: {
    hotspot: Record<Camera, Pt[]>;
    page: Record<
      Camera,
      Record<
        Light,
        {
          rect: [number, number, number, number];
          image: string;
          nameColumn: Pt[];
          numberColumn: Pt[];
          firstLine: number;
          lineGap: number;
        }
      >
    >;
  };
  ambient: Record<Camera, Record<Light, { steam?: { src: string; rect: [number, number, number, number] }; lamp?: { src: string; rect: [number, number, number, number] } }>>; // short seamless mp4 loops
}
```

## Rules both tracks follow

- The browser never draws a physical thing. No CSS shadows, gradients, magnets,
  paper or clocks on top of the render. The only things the browser draws are
  the visitor's own pen strokes and the typed number as pen ink, both with
  the engine in `components/join/ink.ts`.
- No visible chrome: no nav, logo, wordmark, buttons, labels or copy on the page.
  The only text in the DOM is visually hidden accessible text.
- One UI typeface where any is needed: the system stack. No handwriting fonts.
- Every interactive region is a real focusable element with a visible
  `:focus-visible` outline (3px, #e2a13c), and Enter/Space do what tap does.
- Reduced motion: clips are skipped and the poster shows.
- No em or en dashes, no "not this, not that", no "X, Y." captions in any
  string. Run `python3 ~/code/chewbacca/bin/slop-check --stdin --issues`.
- The guestbook API writes to a draft store only, never to Karthik's backend.
- Renders run one at a time. Never start a second Blender alongside a render.

## Done means

`npx tsc --noEmit`, `npm run build` (with `NEXT_DIST_DIR=.next-web`) and
`npm test` pass, and every state is screenshotted at 1440x900 and 390x844 in
all three lights, every screenshot read, and what looked wrong fixed. Report
command output, screenshot paths and anything still wrong. Do not commit,
push or deploy; the main session does.
