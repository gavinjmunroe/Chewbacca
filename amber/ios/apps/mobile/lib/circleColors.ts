// The circle color palette.
//
// Circles persist their color BY KEY NAME (see createCircle / colorKeyFor), not
// as a hex value. So the eight original keys — purple, blue, green, orange, pink,
// yellow, red, teal — MUST keep existing forever: every circle already created
// references one of them, and deleting a key orphans that circle's color.
//
// What changed: the hex values were retuned from saturated web colors to the
// muted, earthy palette in the design, and eight new keys were added to reach the
// 16-swatch grid. Existing circles keep their key and simply render in the new
// tone — no migration needed, nothing orphaned.
//
// KEY ORDER IS THE SWATCH ORDER. Object.keys() drives the picker grid (8 per
// row), so this literal is laid out to match the design exactly. Three rows now.
export const NAMED_COLORS: Record<string, string> = {
  // Row 1 — warm
  orange: '#D67F48', // terracotta (the default)
  amber: '#E0A45C',
  yellow: '#C9A227', // mustard
  rust: '#B0553F',
  red: '#98423F', // brick
  green: '#8FA073', // sage
  forest: '#5F7357',
  teal: '#4F7B7E',
  // Row 2 — cool + neutral
  slate: '#6F7F8C',
  blue: '#5A6A94', // indigo
  purple: '#9A7AA0', // lilac
  plum: '#7B5E83',
  pink: '#C98A9B', // rose
  taupe: '#A1907F',
  stone: '#645C50',
  ink: '#2E2B25',
  // Row 3 — added because sixteen was not enough once people started making
  // circles in earnest. Same rule as above: these keys are permanent from the
  // moment one circle references one of them. Chosen to sit across the wheel
  // from the first sixteen rather than beside them — another terracotta would
  // give the picker a third indistinguishable warm swatch, which is more
  // choices and not more choice.
  apricot: '#E09A6B',
  lime: '#A8B06A',
  mint: '#7FA898',
  sky: '#7B9BC4',
  lavender: '#A9A2C7',
  mauve: '#B08AA6',
  coral: '#D9736A',
  cocoa: '#7A5C4B',
};

// Tint drawn ON TOP of a swatch (the selected checkmark) and on solid accent
// buttons. Warm off-white so it reads on every swatch including the dark four.
export const ON_COLOR = '#FFF2EB';
