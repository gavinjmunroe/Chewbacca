/**
 * THE TOPS OF THE THREE PAGES MATCH, AND THAT IS ARITHMETIC RATHER THAN TASTE.
 *
 * Run with:  node --experimental-strip-types scripts/palette-check.mts
 *
 * "Between the tabs, because of how light the calendar is, there's this weird
 *  look... make the People and Profile tabs a lot lighter at the top."
 *
 * The seam he saw mid-swipe was a step in LIGHTNESS across a straight vertical
 * line: Home's header band is a white glass tint over the page wash, so its top
 * rendered at about 93 L* while the top of the wash was 78 L*. Fifteen points
 * across a hard edge reads as a rendering fault, not as two pages.
 *
 * These checks hold the relationships that fix it, so a future retune of the
 * palette cannot quietly put the step back:
 *
 *   - the top of the wash is genuinely light
 *   - the header band and the bare wash are within a few points of each other
 *   - the page never gets darker as it goes up (the old radial mesh's mistake)
 *   - text still holds its contrast on the lighter page
 *   - a card is still a visible surface on it, which is what lightening a page
 *     puts at risk
 */
// THE VALUES ARE READ OUT OF THE FILE AS TEXT, not imported.
//
// lib/classical.ts pulls in react-native for Platform, which node cannot load
// (Flow syntax). Reading the source has a second advantage worth having: this
// checks what is WRITTEN in the palette, with no module graph and nothing that
// can be stubbed differently than the app sees it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'lib', 'classical.ts'), 'utf8');
// The two places a PAGE paints over the shared wash. Both are read as text for
// the same reason the palette is: what ships is what is written in the file, and
// a constant copied into this script is a constant that drifts.
const CHEADER_SRC = readFileSync(join(HERE, '..', 'components', 'classical.tsx'), 'utf8');
const PROFILE_SRC = readFileSync(
  join(HERE, '..', 'components', 'pages', 'ProfilePage.tsx'),
  'utf8',
);

function token(name: string): string {
  const m = SRC.match(new RegExp(`\\b${name}:\\s*'(#[0-9A-Fa-f]{6})'`));
  if (!m) throw new Error(`palette token ${name} not found in lib/classical.ts`);
  return m[1];
}
const cl = {
  groundTop: token('groundTop'),
  groundMid: token('groundMid'),
  groundFoot: token('groundFoot'),
  goldKicker: token('goldKicker'),
  ink: token('ink'),
};

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

type RGB = [number, number, number];

function hex(h: string): RGB {
  const s = h.replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

/** Composite a translucent color over an opaque one. */
function over(fg: RGB, alpha: number, bg: RGB): RGB {
  return [0, 1, 2].map((i) => alpha * fg[i] + (1 - alpha) * bg[i]) as RGB;
}

/** WCAG relative luminance. */
function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** CIE L*, which is what the eye reads as a "step" in lightness. */
function lstar(c: RGB): number {
  const y = luminance(c);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE: RGB = [255, 255, 255];
const top = hex(cl.groundTop);
const mid = hex(cl.groundMid);
const foot = hex(cl.groundFoot);

// ── WHAT THE PAGES PAINT ON TOP OF THE SHARED WASH ─────────────────────────
//
// Every screen sits on one ClassicalGround behind the pager, so at a given height
// the three pages are the same color BY CONSTRUCTION. The seam he kept seeing
// mid-swipe came from the two places a page overrides that: CHeader's glass tint
// on Today and People, and the Profile hero's bloom on You. Both are checked
// here against the bare wash, because "it should blend in perfectly" is a
// numeric claim about those two composites and nothing else.

/**
 * CHEADER PAINTS NOTHING, and this is checked STRUCTURALLY rather than
 * numerically now.
 *
 * Three fixes in a row set this band's white tint lower and each was undone by
 * the next reach for a material: 0.22, 0.14, 0.05, and finally a zero-tint iOS 26
 * GlassView kept "for its refraction" -- which still brightened the band, because
 * Liquid Glass is a material and brightening is what it does. A number this
 * script could read was zero while the screen still had a seam.
 *
 * So the assertion is about the code: CHeader's body contains no GlassView and no
 * white overlay. There is no tint to be within a point of, because there is no
 * layer.
 */
const CHEADER_BODY = (() => {
  const at = CHEADER_SRC.indexOf('export function CHeader(');
  if (at < 0) throw new Error('CHeader not found in components/classical.tsx');
  // To the end of the function: the next top-level `export function`.
  const rest = CHEADER_SRC.slice(at + 1);
  const next = rest.indexOf('\nexport function ');
  return next < 0 ? rest : rest.slice(0, next);
})();
const band = top; // the band IS the page — nothing is painted over it

/** The Profile hero bloom's peak: its first stop color at its own opacity. */
const BLOOM = (() => {
  const m = PROFILE_SRC.match(
    /offset="0%" stopColor="(#[0-9A-Fa-f]{6})" stopOpacity=\{([0-9.]+)\}/,
  );
  if (!m) throw new Error('the profile bloom stop was not found in ProfilePage.tsx');
  return { color: hex(m[1]), alpha: Number(m[2]) };
})();
const bloom = over(BLOOM.color, BLOOM.alpha, top);
/** Where the bloom's box starts, relative to the hero's own top. */
const BLOOM_TOP = (() => {
  const m = PROFILE_SRC.match(/style=\{\{ position: 'absolute', top: (-?[0-9]+), width: [0-9]+/);
  if (!m) throw new Error('the profile bloom offset was not found in ProfilePage.tsx');
  return Number(m[1]);
})();

check('the top of the page is very light', lstar(top) >= 88, `L* ${lstar(top).toFixed(1)}`);
check(
  'CHeader paints no glass material over the page',
  !/<GlassView/.test(CHEADER_BODY),
  'a GlassView is a material: it brightens even at zero tint',
);
check(
  'CHeader paints no white overlay over the page',
  !/rgba\(255,\s*255,\s*255/.test(CHEADER_BODY),
  'any white alpha over a page at L* 93 is a visible step',
);
check(
  'the header band is not a visible step against the bare page',
  Math.abs(lstar(band) - lstar(top)) <= 1.5,
  `band ${lstar(band).toFixed(1)} vs page ${lstar(top).toFixed(1)}`,
);
check(
  'the profile bloom does not bleed off the top of the screen',
  BLOOM_TOP >= 0,
  `bloom box starts at ${BLOOM_TOP}`,
);
check(
  'the profile bloom is a shade of the page, not a second pigment',
  Math.abs(lstar(bloom) - lstar(top)) <= 4,
  `bloom ${lstar(bloom).toFixed(1)} vs page ${lstar(top).toFixed(1)}`,
);
check(
  '...and it is a whisper of warmth, not a pigment',
  /**
   * The bar used to be RELATIVE to the page -- "no more than fourteen points
   * redder than the wash" -- which was the right shape while the wash was itself
   * sixty-nine points warm. The page is neutral white now, so relative-to-page
   * means "must be neutral", and that would forbid the one warm note the profile
   * hero is allowed to have.
   *
   * So it is absolute: warm in the right direction (red over green over blue),
   * and faint. Twenty-four points of red-over-blue on a near-white bloom is a
   * warmth you feel rather than see; a terracotta at a quarter strength, which
   * is the failure this check was written for, lands far past it.
   */
  bloom[0] > bloom[1] && bloom[1] > bloom[2] && bloom[0] - bloom[2] <= 24,
  `bloom R-B ${(bloom[0] - bloom[2]).toFixed(0)}, ceiling 24`,
);
check(
  'the tops of Today, People and You are within a point of each other',
  Math.abs(lstar(band) - lstar(top)) <= 1.5 && BLOOM_TOP >= 0,
  `Today/People ${lstar(band).toFixed(1)}, You ${lstar(top).toFixed(1)}`,
);
check(
  'the page never darkens upward',
  lstar(top) <= lstar(mid) && lstar(mid) <= lstar(foot),
  `${lstar(top).toFixed(1)} / ${lstar(mid).toFixed(1)} / ${lstar(foot).toFixed(1)}`,
);
/**
 * THE PAGE IS WHITE PAPER, and these two replace the checks that used to hold
 * the warm wash in place.
 *
 * "Make everything a white background. No more need for this orange and yellow
 *  and burnt color theme."
 *
 * The old pair asserted that the page TRAVELS at least three points of lightness
 * and that it is at least thirty points warmer than gray. Both were true
 * statements about a design that no longer exists, and both are now the opposite
 * of what is wanted -- so they are rewritten rather than deleted. What survives
 * from them is the reason they existed at all: a page can be wrong by being too
 * dark, and it can be wrong by being the wrong temperature.
 */
check(
  'the page is white paper — every stop is at least 98 L*',
  lstar(top) >= 98 && lstar(mid) >= 98 && lstar(foot) >= 98,
  `${lstar(top).toFixed(1)} / ${lstar(mid).toFixed(1)} / ${lstar(foot).toFixed(1)}`,
);
check(
  'it is never COOLER than neutral — white paper, never blue-white',
  top[0] >= top[2] && mid[0] >= mid[2] && foot[0] >= foot[2],
  `R-B ${top[0] - top[2]} / ${mid[0] - mid[2]} / ${foot[0] - foot[2]}`,
);

// Text on the lightest and the warmest ends of the page.
for (const [name, ground] of [
  ['top', top],
  ['mid', mid],
  ['foot', foot],
] as const) {
  check(
    `the gold kicker holds 4.5:1 on the ${name}`,
    contrast(hex(cl.goldKicker), ground) >= 4.5,
    contrast(hex(cl.goldKicker), ground).toFixed(2),
  );
  check(
    `ink holds 7:1 on the ${name}`,
    contrast(hex(cl.ink), ground) >= 7,
    contrast(hex(cl.ink), ground).toFixed(2),
  );
}

/**
 * A CARD IS STILL A VISIBLE SURFACE -- BY ITS EDGE NOW, NOT BY ITS FILL.
 *
 * This used to assert that a card's fill lands at least two points of lightness
 * ABOVE the page, which is how a translucent white veil separated from the amber
 * wash. On white paper that is unachievable by construction: white over white is
 * white, and the check would have forced the page back off white to satisfy it.
 *
 * The renderings answer it the other way -- a card is either TINTED (the three
 * note kinds, the agenda row) or drawn with a light gray hairline around it --
 * so what has to be true now is that the hairline is actually visible. A card
 * bounded by a 2% line on white is an invisible card, which is the same failure
 * this check has always been about.
 *
 * 1.06:1 is deliberately a low bar in ratio terms and a real one in practice: a
 * hairline is one point wide, and anything darker than about 12% ink starts to
 * read as a drawn outline rather than as an edge. Both ends are checked.
 */
const CARD_FILL = 0.72;
const cardOnMid = over(WHITE, CARD_FILL, mid);
const hairlineAlpha = (() => {
  const m = SRC.match(/cardHairline:\s*'rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)'/);
  if (!m) throw new Error('cl.cardHairline not found in lib/classical.ts');
  return Number(m[1]);
})();
const edgeOnPage = over(hex(cl.ink), hairlineAlpha, cardOnMid);
check(
  'a card is still a visible surface — its edge separates from the page',
  contrast(edgeOnPage, mid) >= 1.06 && hairlineAlpha <= 0.12,
  `edge ${contrast(edgeOnPage, mid).toFixed(3)}:1 at ${(hairlineAlpha * 100).toFixed(1)}% ink`,
);

// ── THE THREE KINDS IN NOTES & JOURNAL ─────────────────────────────────────
//
// "Reminders purple, journal entries green, network notes burnt orange."
//
// Three new pigments went onto a page that had exactly two, and a kicker is the
// smallest tracked type in the app -- 10pt, letter-spaced, all caps. A hue that
// looks right beside its neighbors and cannot be READ on the card is the
// failure mode, and it is invisible in a screenshot review because the reviewer
// already knows what the word says.
//
// Read as text, like everything else here, so what ships is what is checked.
const KINDS_SRC = readFileSync(join(HERE, '..', 'lib', 'journalKinds.ts'), 'utf8');
const journalKinds = (() => {
  /**
   * THE TINT IS AN OPAQUE HEX NOW, not an rgba wash.
   *
   * This pattern used to require `rgba(r,g,b,a)` and silently matched nothing
   * the moment the three tints went opaque for the white page -- so the whole
   * block below (three kickers on three cards, six contrast assertions) reported
   * "found none" and, if the length check had not been here, would have passed
   * by checking nothing at all. That is the failure mode a parsing gate has, and
   * it is why the length check exists.
   *
   * Both spellings are accepted: opaque is what the file holds today, and rgba
   * is still a legitimate way to write a tint if a surface ever wants to take
   * the ground's color again.
   */
  const out: { kind: string; ink: string; tint: RGB; tintAlpha: number; dot: string }[] = [];
  const block =
    /(\w+):\s*\{\s*label:[^}]*?ink:\s*'(#[0-9A-Fa-f]{6})',\s*tint:\s*'(#[0-9A-Fa-f]{6}|rgba\([^)]*\))',\s*dot:\s*'(#[0-9A-Fa-f]{6})',?\s*\}/g;
  for (const m of KINDS_SRC.matchAll(block)) {
    const raw = m[3];
    const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)$/.exec(raw);
    out.push({
      kind: m[1],
      ink: m[2],
      tint: rgba ? ([Number(rgba[1]), Number(rgba[2]), Number(rgba[3])] as RGB) : hex(raw),
      tintAlpha: rgba ? Number(rgba[4]) : 1,
      dot: m[4],
    });
  }
  return out;
})();
check(
  'all three note kinds have a color entry that can be read out of the file',
  journalKinds.length === 3,
  `found ${journalKinds.map((k) => k.kind).join(', ') || 'none'}`,
);
for (const k of journalKinds) {
  // A kicker sits on the card, and a card is white at 0.72 over the wash. The
  // foot is the lightest ground and the mid is the darkest a card ever sits on,
  // so the mid is the one that can fail.
  const card = over(WHITE, CARD_FILL, mid);
  // ...and on a tinted card, which is the same surface with the kind's own tint
  // laid over it. Checked separately because a tint of the SAME hue as the ink
  // is exactly what pulls the two together.
  const tinted = over(k.tint, k.tintAlpha, card);
  check(
    `the ${k.kind} kicker holds 4.5:1 on a card`,
    contrast(hex(k.ink), card) >= 4.5,
    contrast(hex(k.ink), card).toFixed(2),
  );
  check(
    `the ${k.kind} kicker holds 4.5:1 on its own tinted card`,
    contrast(hex(k.ink), tinted) >= 4.5,
    contrast(hex(k.ink), tinted).toFixed(2),
  );
  // The tint is a WASH, not a color field: it has to leave the card reading as
  // a card. A tint heavy enough to be a swatch turns the note list into three
  // colored blocks, which is the thing that always follows "color-code it".
  check(
    `the ${k.kind} tint stays a wash rather than a swatch`,
    Math.abs(lstar(tinted) - lstar(card)) <= 6,
    `${Math.abs(lstar(tinted) - lstar(card)).toFixed(1)} points off the plain card`,
  );
}
// AND THEY HAVE TO BE TELLABLE APART, which is the whole point of coloring
// them. Two inks a few points apart in hue are two labels somebody reads as the
// same label.
for (let i = 0; i < journalKinds.length; i += 1) {
  for (let j = i + 1; j < journalKinds.length; j += 1) {
    const a = hex(journalKinds[i].ink);
    const b = hex(journalKinds[j].ink);
    const apart = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    check(
      `${journalKinds[i].kind} and ${journalKinds[j].kind} are visibly different colors`,
      apart >= 60,
      `${apart} apart across the channels`,
    );
  }
}

// ── THE TWO PALETTES MUST NOT DRIFT ────────────────────────────────────────
//
// lib/theme.ts's LIGHT.canvas is the flat base a dozen screens paint with no
// ClassicalGround over them (person, circle, intros, the public profile). Its own
// comment says it has to be kept in step with cl.ground BY HAND, which is exactly
// the kind of promise that quietly stops being true -- and when it does, the app
// changes temperature depending on which screen you are on. That is a version of
// the seam he has reported three times, so it is checked rather than promised.
const THEME_SRC = readFileSync(join(HERE, '..', 'lib', 'theme.ts'), 'utf8');
const themeCanvas = (() => {
  const m = THEME_SRC.match(/canvas:\s*'(#[0-9A-Fa-f]{6})',\s*\/\/ the warm ground/);
  if (!m) throw new Error('LIGHT.canvas not found in lib/theme.ts');
  return m[1];
})();
check(
  'LIGHT.canvas is the same color as cl.ground',
  themeCanvas.toUpperCase() === token('ground').toUpperCase(),
  `theme ${themeCanvas} vs classical ${token('ground')}`,
);

console.log(failures === 0 ? '\nall palette checks passed' : `\n${failures} FAILED`);
if (failures > 0) process.exitCode = 1;
