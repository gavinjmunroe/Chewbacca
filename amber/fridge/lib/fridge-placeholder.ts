/**
 * A STAND-IN MANIFEST, BUILT FROM THE V1 RENDER, UNTIL V2 LANDS.
 *
 * Everything here points at files that already exist under public/kitchen:
 * the three 3840x2160 stills, the outlines in hotspots.json, the drawn backs
 * in backs/, and the blank journal page. It exists so the page can be built
 * and screenshotted before public/kitchen/v2/manifest.json is written, and it
 * is wrong in known ways:
 *
 * - There is no tall camera yet. "tall" reuses the wide still with a focus on
 *   the fridge, so on a phone the shelf and the journal sit off screen.
 * - There are no clips and no posters. Every `in`, `out` and `poster` is
 *   empty, so opening an object or a volume shows nothing on screen (the
 *   back's line is still announced). The v1 drawn backs exist under
 *   public/kitchen/backs, but pasted over the render they read as a flat 2D
 *   card (Caleb rejected exactly that on 2026-10-07), so they are not used.
 * - The v1 door holds different paper. The five hotspots borrow the nearest
 *   v1 outline: the note is Sagar's letter, the business card is the
 *   appointment card, the resume is the crayon drawing, the prayer card is
 *   the grocery list.
 * - There are no clock hand layers; the clock draws nothing.
 * - The journal page is the flat stand-in from make_journal.py, shown only
 *   while zoomed in, because the v1 book lies nearly edge on and there is no
 *   page to sign without it. It has the same flat look and goes when v2 lands.
 */

import type { Camera, Light, Pt, Rect } from "./fridge";
import type {
  Clip,
  FridgeObject,
  JournalPage,
  Manifest,
} from "./fridge-manifest";

const W = 3840;
const H = 2160;

function perLight<T>(make: (l: Light) => T): Record<Light, T> {
  return {
    morning: make("morning"),
    golden: make("golden"),
    night: make("night"),
  };
}

function perCamera<T>(make: (c: Camera) => T): Record<Camera, T> {
  return { wide: make("wide"), tall: make("tall") };
}

/**
 * A rect for an image of iw x ih pixels centred on `c`, `h` percent of the
 * frame tall, or `w` percent wide for a landscape image.
 */
function rectFor(c: Pt, iw: number, ih: number, size: number): Rect {
  const aspect = iw / ih;
  let w: number;
  let h: number;
  if (aspect < 1) {
    h = size;
    w = (h * H * aspect) / W;
  } else {
    w = size * 0.55;
    h = (w * W) / aspect / H;
  }
  return [c[0] - w / 2, c[1] - h / 2, w, h];
}

function stillClip(
  iw: number,
  ih: number,
  centre: Record<Camera, Pt>,
  size: Record<Camera, number>,
): Record<Camera, Record<Light, Clip>> {
  return perCamera((cam) =>
    perLight(() => ({
      rect: rectFor(centre[cam], iw, ih, size[cam]),
      in: "",
      out: "",
      poster: "",
    })),
  );
}

const DOOR: Record<Camera, Pt> = { wide: [36, 50], tall: [31, 50] };
const BIG: Record<Camera, number> = { wide: 66, tall: 46 };

type Spec = {
  id: FridgeObject["id"];
  label: string;
  backText: string;
  poly: Pt[];
  size: [number, number];
};

const OBJECTS: Spec[] = [
  {
    id: "note",
    label: "Notebook page on the freezer door",
    backText: "Not sure if it's a like-minded friend or a well-made bot...",
    poly: [
      [22.22, 33.31],
      [31.75, 32.65],
      [31.6, 26.2],
      [31.37, 17.77],
      [31.24, 12.31],
      [31.23, 11.03],
      [31.26, 10.38],
      [21.65, 10.96],
      [21.63, 11.65],
      [21.64, 12.38],
      [21.79, 18.28],
      [22.02, 25.82],
    ],
    size: [900, 1180],
  },
  {
    id: "polaroid",
    label: "Polaroid of five friends",
    backText:
      "Finding the perfect group for that road trip you've been wanting to take.",
    poly: [
      [31.04, 25.96],
      [37.2, 26.93],
      [37.81, 13.84],
      [31.63, 12.87],
      [31.39, 18.23],
      [31.37, 18.39],
    ],
    size: [640, 760],
  },
  {
    id: "bizcard",
    label: "Business card for Halden and Rue, furniture makers",
    backText: "Met at Maya's party. Needs a designer.",
    poly: [
      [29.4, 63.77],
      [31.36, 63.94],
      [37.5, 64.51],
      [37.73, 56.11],
      [29.62, 55.36],
    ],
    size: [700, 400],
  },
  {
    id: "resume",
    label: "Lucia Moreno's resume with a sticky note on it",
    backText:
      "Introducing your little sister... to your friend's company because you know it'd be a good fit.",
    poly: [
      [27.52, 52.75],
      [34.53, 53.17],
      [37.6, 53.4],
      [37.73, 48.15],
      [37.89, 39.43],
      [27.76, 38.8],
      [27.59, 50.13],
    ],
    size: [900, 1160],
  },
  {
    id: "prayer",
    label: "Index card in pencil, who to pray for this week",
    backText: "Talk to God before you talk to anyone else today.",
    poly: [
      [21.21, 86.79],
      [21.36, 86.83],
      [21.76, 86.89],
      [26.56, 87.38],
      [26.84, 80.99],
      [27.15, 72.23],
      [21.84, 71.57],
      [21.69, 76.02],
      [21.56, 79.62],
      [21.38, 83.55],
    ],
    size: [820, 480],
  },
];

/** Seven spines on the floating shelf, 52.1% to 57.1% across, 2019 first. */
const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const SPINES: Pt[][] = YEARS.map((_, i) => {
  const x0 = 52.1 + i * 0.714;
  const x1 = x0 + 0.714;
  return [
    [x0, 6.1],
    [x1, 6.1],
    [x1, 15.9],
    [x0, 15.9],
  ];
});

/**
 * The journal on the counter is nearly edge on in the v1 render, so its page
 * rect is drawn a little above the book, at the stand-in page's own aspect
 * (920 x 1280). The stand-in's rules start at 10.9% and step 5% of its height.
 */
function journalPage(): JournalPage {
  const w = 8;
  const h = (w * W * (1280 / 920)) / H;
  const rect: Rect = [64, 40, w, h];
  const px = (fx: number) => rect[0] + fx * w;
  const py = (fy: number) => rect[1] + fy * h;
  return {
    rect,
    image: "/kitchen/journal/page-standin.png",
    nameColumn: [
      [px(0.07), py(0.06)],
      [px(0.58), py(0.06)],
      [px(0.58), py(0.88)],
      [px(0.07), py(0.88)],
    ],
    numberColumn: [
      [px(0.62), py(0.06)],
      [px(0.94), py(0.06)],
      [px(0.94), py(0.88)],
      [px(0.62), py(0.88)],
    ],
    firstLine: py(0.159),
    lineGap: 0.05 * h,
  };
}

const still = (l: Light) => `/kitchen/kitchen-${l}.webp`;

export const PLACEHOLDER: Manifest = {
  version: 2,
  cameras: {
    wide: { width: W, height: H },
    tall: { width: W, height: H, focus: [31, 52] },
  },
  stills: perCamera(() => perLight(still)),
  objects: OBJECTS.map((o) => ({
    id: o.id,
    label: o.label,
    backText: o.backText,
    hotspot: { wide: o.poly, tall: o.poly },
    clip: stillClip(o.size[0], o.size[1], DOOR, BIG),
  })),
  clock: perCamera(() =>
    perLight(() => ({ pivot: [0, 0] as Pt, hour: "", minute: "", cap: "" })),
  ),
  shelf: {
    hotspot: { wide: SPINES, tall: SPINES },
    years: YEARS,
    clip: perCamera((cam) =>
      perLight(() =>
        YEARS.map(() => ({
          rect: rectFor(
            cam === "wide" ? [52, 50] : [31, 50],
            920,
            1280,
            BIG[cam],
          ),
          in: "",
          out: "",
          poster: "",
        })),
      ),
    ),
  },
  journal: {
    hotspot: {
      wide: [
        [63.6, 53.4],
        [72.4, 53.4],
        [72.4, 56.4],
        [63.6, 56.4],
      ],
      tall: [
        [63.6, 53.4],
        [72.4, 53.4],
        [72.4, 56.4],
        [63.6, 56.4],
      ],
    },
    page: perCamera(() => perLight(journalPage)),
  },
  ambient: perCamera(() => perLight(() => ({}))),
};

