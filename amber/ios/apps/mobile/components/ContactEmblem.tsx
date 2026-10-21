import { View } from 'react-native';
import Svg, { Circle as SvgCircle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { Text } from './Text';
import { fonts } from '../lib/tokens';

// A PERSON's emblem — one ring, one horizontal lens, serif initials.
//
// This is deliberately NOT `ChordEmblem`. That component draws a *circle*: an
// outer and inner ring, a warm bloom, an interior plate, and member nodes plotted
// on the ring. Borrowing it for a contact avatar meant carrying all of that
// scaffolding for a mark that, in the design, is a single outlined ring with a
// lens through it — which is why the avatars never looked like the rendering no
// matter how the sizes were tuned. One mark per drawing.
//
// Authored on a 100x100 canvas with the origin at the center, so the rendered
// `size` IS the emblem's diameter. (ChordEmblem's ring sits at 64.5% of its
// canvas, and every call site had to pre-multiply by 1.55 to compensate.)
//
// Two states, both from the same geometry:
//   unselected — terracotta hairline ring, lens in a lighter tan, initials in the
//                deepened accent. Nothing filled.
//   selected   — the disc fills with the accent gradient, the lens and initials
//                invert to warm white. Flat: no drop shadow, only a hairline edge,
//                because a shadow at this size reads as mud rather than lift.

const CANVAS = 100;
// Half the ring stroke has to fit inside the box or the circle clips on Android.
const RING_R = 47.5;

// Control-point offsets as a fraction of R, outermost first. A quadratic deflects
// half its control offset, so 1.15 draws an arc reaching ~0.58R — tall enough that
// the lens FRAMES the initials rather than cutting through them, which is what the
// rendering does. Every arc starts and ends exactly on the ring, at 9 and 3
// o'clock. The inner pair is the lens's "fill"; without it it reads as an empty eye.
const LENS_OFFSETS = [1.15, 0.35, -0.35, -1.15];
// Stroke weights in PIXELS (divided by `s` on the way into user space), so the
// hairlines stay hairlines at 44pt and do not turn into cables at 120pt.
const LENS_WEIGHTS = [1.1, 0.7, 0.7, 1.1];
// Below this diameter the inner pair collapses onto the initials and the mark
// reads as a smudge, so a small emblem draws the outer pair only. Established by
// rendering both at 44pt side by side, not guessed.
const DENSE_MIN_SIZE = 52;
const LENS_OFFSETS_SMALL = [1.15, -1.15];
const LENS_WEIGHTS_SMALL = [1.05, 1.05];

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Mix toward white (positive) or black (negative).
function shift(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h;
  const n = parseInt(full, 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) + amount);
  const g = clamp(((n >> 8) & 255) + amount);
  const b = clamp((n & 255) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function initialsForPerson(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function ContactEmblem({
  name,
  initials,
  size = 52,
  accent = '#C4703C',
  selected = false,
}: {
  name: string;
  /** Overrides the derived initials — pass the list's own initials helper output. */
  initials?: string;
  /** The rendered diameter, in points. */
  size?: number;
  accent?: string;
  /** Filled state: accent disc, white lens, white initials. */
  selected?: boolean;
}) {
  const s = size / CANVAS;
  const label = initials ?? initialsForPerson(name);

  // Unique per instance-shape rather than per instance: two emblems with the same
  // accent can share a gradient, and react-native-svg resolves ids document-wide,
  // so the id must encode the accent to avoid one contact's color bleeding onto
  // another's in the same list.
  const gradientId = `contactFill-${accent.replace('#', '')}`;

  const ring = selected ? withAlpha(shift(accent, -70), 0.4) : withAlpha(accent, 0.62);
  const lens = selected ? 'rgba(255,248,240,0.78)' : withAlpha(accent, 0.42);
  const ink = selected ? '#FFF8F0' : shift(accent, -46);
  const dense = size >= DENSE_MIN_SIZE;
  const offsets = dense ? LENS_OFFSETS : LENS_OFFSETS_SMALL;
  const weights = dense ? LENS_WEIGHTS : LENS_WEIGHTS_SMALL;
  // A pair of serif capitals runs wide; a single letter can be set larger. Small
  // emblems take a slightly larger fraction because their simpler lens leaves the
  // room for it.
  const fontSize = size * (label.length > 1 ? (dense ? 0.28 : 0.3) : 0.38);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg
        width={size}
        height={size}
        viewBox={`${-CANVAS / 2} ${-CANVAS / 2} ${CANVAS} ${CANVAS}`}
        style={{ position: 'absolute', left: 0, top: 0 }}
      >
        <Defs>
          <LinearGradient id={gradientId} x1="0.15" y1="0" x2="0.85" y2="1">
            <Stop offset="0%" stopColor={shift(accent, 26)} />
            <Stop offset="100%" stopColor={shift(accent, -12)} />
          </LinearGradient>
        </Defs>

        <SvgCircle
          r={RING_R}
          fill={selected ? `url(#${gradientId})` : 'none'}
          stroke={ring}
          strokeWidth={1.1 / s}
        />

        {offsets.map((o, i) => (
          <Path
            key={i}
            d={`M ${-RING_R} 0 Q 0 ${RING_R * o} ${RING_R} 0`}
            fill="none"
            stroke={lens}
            strokeWidth={weights[i]! / s}
            strokeLinecap="round"
          />
        ))}
      </Svg>

      <Text
        numberOfLines={1}
        style={{
          fontFamily: fonts.serif,
          fontSize,
          lineHeight: fontSize * 1.12,
          letterSpacing: fontSize * 0.04,
          // letterSpacing adds trailing space after the last glyph, which biases
          // the pair left; pad it back to optically center.
          paddingLeft: fontSize * 0.04,
          color: ink,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
