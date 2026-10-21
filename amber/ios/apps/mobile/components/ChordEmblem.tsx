import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, {
  Circle as SvgCircle,
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
} from 'react-native-svg';
import { Text } from './Text';
import { fonts } from '../lib/tokens';
import { ON_COLOR } from '../lib/circleColors';

// The circle emblem — member nodes on a ring joined by chords, name in the middle.
//
// Geometry, colors and stroke weights are transcribed from the design source
// (`Circle Chord Light.dc.html`), authored on a 620x620 canvas with the origin at
// the center. Everything is expressed in those design units and multiplied by `s`,
// so one authored coordinate space drives every rendered size — a 120px grid tile
// and a 300px Info-screen emblem are the same drawing, not two hand-tuned ones.
//
// Rings, chords and the glow are SVG. Nodes and labels are absolutely-positioned
// RN Views, because SVG <Text> font resolution is unreliable across iOS and
// Android with dynamically-loaded fonts and the initials MUST render.

const CANVAS = 620;
const RING_R = 200; // the track nodes sit on; chords terminate here too
const INNER_RING_R = 176; // decorative, fainter
const NODE_R = 27;
const MAX_SLOTS = 8; // past this, the last slot becomes a "+N" overflow chip

// Every stroke in the emblem derives from the circle's own color. This used to
// be a hardcoded terracotta, so picking a swatch in the Info tab changed the Save
// button and the tab underline but left the emblem stubbornly orange -- and the
// emblem is the most visible thing the color is meant to tint.
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Pull a hex toward black, for the strong edge on a highlighted node.
function darken(hex: string, amount = 45): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 255) - amount);
  const g = clamp(((n >> 8) & 255) - amount);
  const b = clamp((n & 255) - amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// The eight chord stroke weights from the design, in order. Hand-tuned there, so
// they are transcribed rather than derived: the varying weight is what stops the
// chords reading as a flat wireframe.
const CHORD_WIDTHS = [2.5, 1.6, 1.2, 2.2, 1.4, 1.8, 1.2, 1.1];

// The two-member sheaf, outermost arc first: heavy outside, hairline through the
// middle, so the lens has an edge and a fill rather than six equal lines.
const LENS_WIDTHS = [2.6, 1.1, 0.8, 0.8, 1.1, 2.3];

export type EmblemMember = {
  id: string;
  name: string;
  /** Filled in the accent color with a soft halo — e.g. newest note. */
  highlighted?: boolean;
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// Every node must be an endpoint of exactly two chords (a 2-regular graph) — that
// is what reads as a constellation rather than a hub or a scribble. Stepping
// i -> i+k around the ring gives that, and a `k` coprime with N makes it one
// closed cycle visiting every node. Largest k below N/2 = longest chords.
function chordStep(n: number): number {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  for (let k = Math.floor(n / 2) - (n % 2 === 0 ? 1 : 0); k >= 2; k -= 1) {
    if (gcd(k, n) === 1) return k;
  }
  return 1;
}

export function ChordEmblem({
  name,
  memberCount,
  members,
  accent,
  size = 280,
  showLabels = true,
  centerText,
  showCount = true,
  decorativeChords = false,
  nodeStyle = 'faces',
}: {
  name: string;
  memberCount: number;
  members: EmblemMember[];
  accent: string;
  size?: number;
  /** Node name labels outside the ring. Off for small tiles. */
  showLabels?: boolean;
  /**
   * Overrides the center label. Grid tiles show a single letter (the design puts
   * the circle's NAME under the tile, not inside it), while the Info-screen hero
   * shows the full name inside the ring.
   */
  centerText?: string;
  /** The "N PEOPLE" line under the center label. Off for tiles. */
  showCount?: boolean;
  /**
   * Draw the chord sheaf with NO nodes. For a single person (a contact avatar),
   * where there is no membership to plot but the mark should still read as an
   * Amber circle: rings + lens + initials. Without this, zero members means zero
   * chords and the emblem is just two bare hairlines.
   */
  decorativeChords?: boolean;
  /**
   * HOW A NODE IS DRAWN, and 'dots' exists because of a hard floor above.
   *
   * 'faces' is the original: a 30pt-minimum disc carrying two initials, with the
   * member's first name under it. That floor is not negotiable at hero size --
   * the faces ARE the mark -- but it means a 62pt pinned tile would render three
   * 30pt discs, half the tile each, and the drawing disappears under its own
   * nodes.
   *
   * 'dots' keeps the geometry exactly (same ring points, same chords, same
   * curvature) and draws each node as a small filled dot INSIDE the svg, with no
   * initials and no labels. At tile size that is what the eye reads anyway: three
   * points on a ring joined by three sagging strings. Same drawing, told smaller.
   */
  nodeStyle?: 'faces' | 'dots';
}) {
  const s = size / CANVAS;
  const c = size / 2;

  const layout = useMemo(() => {
    // Past 8 members, show 7 faces and turn the last slot into "+N" rather than
    // shrinking nodes until the initials are unreadable.
    const overflow = members.length > MAX_SLOTS ? members.length - (MAX_SLOTS - 1) : 0;
    const shown = overflow > 0 ? members.slice(0, MAX_SLOTS - 1) : members;
    const slots = overflow > 0 ? MAX_SLOTS : shown.length;

    // Two members sit at 9 and 3 o'clock, not 12 and 6. A vertical pair reads as
    // a broken ring; a horizontal pair reads as a pair. This is what the design
    // does and it is deliberately a special case, not a bug in the formula.
    const offset = slots === 2 ? -Math.PI / 2 : 0;

    const points = Array.from({ length: slots }, (_, i) => {
      const theta = offset + (i * 2 * Math.PI) / Math.max(1, slots);
      return { x: RING_R * Math.sin(theta), y: -RING_R * Math.cos(theta) };
    });

    let chords: string[] = [];

    // Decorative lens for a person-sized emblem: the same sheaf the two-member
    // case draws, but between two implied points on the horizontal axis and with
    // no nodes rendered. This is the ST-monogram mark from the design.
    if (decorativeChords) {
      const a = { x: -RING_R, y: 0 };
      const b = { x: RING_R, y: 0 };
      chords = [0.9, 0.3, -0.3, -0.9].map((o) => {
        const cy = RING_R * o;
        return `M ${a.x} ${a.y} Q 0 ${cy} ${b.x} ${b.y}`;
      });
      return { points: [], chords, shown: [], overflow: 0 };
    }

    // TWO MEMBERS IS ITS OWN DRAWING, not a degenerate case of the ring.
    // One chord between two nodes is a dead straight line. The design instead
    // draws a SHEAF of chords between the same pair at varying curvature, which
    // opens into a lens and gives a two-person circle as much presence as an
    // eight-person one. Offsets are the control point's perpendicular distance as
    // a fraction of R; a quadratic deflects half that, so 0.95 reads as an arc
    // reaching about 0.48R.
    if (slots === 2) {
      const a = points[0]!;
      const b = points[1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const px = -dy / len;
      const py = dx / len;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      // Six arcs is right at hero size and muddy at tile size, where they
      // collapse into a solid blob behind the center letter. Drop to four.
      const offsets = size < 200 ? [0.9, 0.26, -0.26, -0.9] : [0.95, 0.34, 0.1, -0.1, -0.34, -0.95];
      chords = offsets.map((o) => {
        const cx = mx + px * RING_R * o;
        const cy = my + py * RING_R * o;
        return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
      });
    } else if (slots >= 3) {
      const k = chordStep(slots);
      const seen = new Set<string>();
      points.forEach((p0, i) => {
        const j = (i + k) % slots;
        // With an even N and k = N/2 the cycle doubles back, so dedupe the pair.
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) return;
        seen.add(key);
        const p1 = points[j]!;
        // Quadratic Bézier with the control point at the midpoint pulled toward
        // the center, so every chord sags inward. 0.18 of R sits inside the
        // design's hand-tuned 0.14–0.28 range.
        const mx = (p0.x + p1.x) / 2;
        const my = (p0.y + p1.y) / 2;
        const mlen = Math.hypot(mx, my) || 1;
        const cx = (mx / mlen) * RING_R * 0.18;
        const cy = (my / mlen) * RING_R * 0.18;
        chords.push(`M ${p0.x} ${p0.y} Q ${cx} ${cy} ${p1.x} ${p1.y}`);
      });
    }

    return { points, chords, shown, overflow };
  }, [members, size, decorativeChords]);

  const { points, chords, shown, overflow } = layout;

  // Nodes do NOT scale purely with the canvas. At tile size (116px) a faithful
  // 54-design-unit node is a 10px circle, which cannot hold two initials — the
  // faces are the whole point of the mark, so they get a legibility floor and a
  // slight overall bump. Everything else stays proportional.
  const nodePx = Math.max(30, NODE_R * 2 * s * 1.18);
  const initialsSize = nodePx * 0.33;

  // A sparse ring (1-5 members) has few or no chords, so the plain two-hairline
  // treatment reads as unfinished rather than minimal. The design's low-count
  // variants compensate two ways, and both are reproduced below: the ring
  // emphasis INVERTS (inner ring becomes the strong one) and a warm plate fills
  // the interior. That is what keeps a two-person circle looking designed.
  const sparse = points.length < 6;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg
        width={size}
        height={size}
        viewBox={`${-CANVAS / 2} ${-CANVAS / 2} ${CANVAS} ${CANVAS}`}
        style={{ position: 'absolute', left: 0, top: 0 }}
      >
        <Defs>
          {/* The warm bloom behind the ring. Without it the emblem reads as two
              thin wireframe circles on bare canvas — which is most of why this
              looked nothing like the design. */}
          <RadialGradient id="emblemGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={accent} stopOpacity={0.22} />
            <Stop offset="45%" stopColor={accent} stopOpacity={0.06} />
            {/* Terminal stops are the canvas color at zero alpha, never
                "transparent" — that premultiplies to black on iOS and grays the
                whole bloom. */}
            <Stop offset="72%" stopColor="#F5EAD8" stopOpacity={0} />
            <Stop offset="100%" stopColor="#F5EAD8" stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="chordA" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={accent} stopOpacity={0.85} />
            <Stop offset="100%" stopColor={accent} stopOpacity={0.35} />
          </LinearGradient>
          {/* Interior plate for sparse rings. Off-center (45% down) exactly as the
              design's low-count variants do, so the light reads as coming from
              above rather than as a flat disc. */}
          <RadialGradient id="emblemPlate" cx="50%" cy="45%" r="50%">
            <Stop offset="0%" stopColor={accent} stopOpacity={0.1} />
            <Stop offset="68%" stopColor={accent} stopOpacity={0.02} />
            <Stop offset="100%" stopColor="#FFF2EB" stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="chordB" x1="1" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={accent} stopOpacity={0.7} />
            <Stop offset="100%" stopColor={darken(accent)} stopOpacity={0.3} />
          </LinearGradient>
        </Defs>

        <SvgCircle r={250} fill="url(#emblemGlow)" />

        {/* Sparse-ring extras: a faint outermost hairline and a warm interior
            plate, so a 2-person circle has material instead of empty canvas. */}
        {sparse ? (
          <>
            {size >= 200 ? (
              <SvgCircle r={236} fill="none" stroke={withAlpha(accent, 0.22)} strokeWidth={1 / s} />
            ) : null}
            <SvgCircle r={INNER_RING_R} fill="url(#emblemPlate)" />
          </>
        ) : null}

        <SvgCircle
          r={RING_R}
          fill="none"
          stroke={accent}
          strokeOpacity={sparse ? 0.3 : 0.4}
          strokeWidth={1 / s}
        />
        <SvgCircle
          r={INNER_RING_R}
          fill="none"
          stroke={accent}
          strokeOpacity={sparse ? 0.55 : 0.2}
          strokeWidth={(sparse ? 1.5 : 1) / s}
        />
        {chords.map((d, i) => (
          <Path
            key={i}
            d={d}
            fill="none"
            stroke={i % 2 === 0 ? 'url(#chordA)' : 'url(#chordB)'}
            strokeWidth={
              (decorativeChords
                ? [1.5, 0.9, 0.9, 1.5][i % 4]!
                : points.length === 2
                  ? LENS_WIDTHS[i % LENS_WIDTHS.length]!
                  : CHORD_WIDTHS[i % CHORD_WIDTHS.length]!) / s
            }
            strokeLinecap="round"
          />
        ))}

        {/* Tile-sized nodes: drawn here rather than as RN views, so they sit in
            the same coordinate space as the chords that terminate on them and
            cannot drift by a subpixel at small sizes. The pale rim is what keeps
            a chord passing behind a dot from reading as passing through it. */}
        {nodeStyle === 'dots'
          ? points.map((p, i) => (
              <SvgCircle
                key={`nodedot-${i}`}
                cx={p.x}
                cy={p.y}
                r={34}
                fill={accent}
                fillOpacity={0.95}
                stroke="#FFFDF7"
                strokeWidth={1.5 / s}
              />
            ))
          : null}
      </Svg>

      <View style={{ alignItems: 'center', paddingHorizontal: size * 0.15 }}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{
            fontFamily: fonts.serif,
            // Tiles carry a single glyph, so they can run larger relative to the
            // canvas than a full name can.
            fontSize: (centerText ? 96 : 58) * s,
            lineHeight: (centerText ? 104 : 64) * s,
            letterSpacing: 1.16 * s,
            color: '#2E2B25',
          }}
        >
          {centerText ?? name ?? 'Circle'}
        </Text>
        {showCount ? (
          <Text
            style={{
              fontFamily: fonts.body,
              fontSize: Math.max(8, 13 * s),
              lineHeight: Math.max(12, 20 * s),
              letterSpacing: 2.08 * s,
              color: darken(accent),
              marginTop: 6 * s,
            }}
          >
            {`${memberCount} ${memberCount === 1 ? 'PERSON' : 'PEOPLE'}`}
          </Text>
        ) : null}
      </View>

      {/* Each node's CENTER lands on its ring point, which is also where chords
          terminate, so faces and chords meet exactly. */}
      {(nodeStyle === 'dots' ? [] : points).map((p, i) => {
        const isOverflowSlot = overflow > 0 && i === points.length - 1;
        const member = isOverflowSlot ? null : shown[i];
        if (!isOverflowSlot && !member) return null;
        const highlighted = !!member?.highlighted;

        return (
          <View
            key={isOverflowSlot ? 'overflow' : member!.id}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: c + p.x * s - nodePx / 2,
              top: c + p.y * s - nodePx / 2,
              alignItems: 'center',
            }}
          >
            {/* A hard spread ring, not a blurred drop shadow — RN shadowRadius
                would blur it and Android ignores it outright. */}
            {highlighted ? (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: -6 * s,
                  top: -6 * s,
                  width: nodePx + 12 * s,
                  height: nodePx + 12 * s,
                  borderRadius: (nodePx + 12 * s) / 2,
                  backgroundColor: accent,
                  opacity: 0.2,
                }}
              />
            ) : null}
            <View
              style={{
                width: nodePx,
                height: nodePx,
                borderRadius: nodePx / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: highlighted ? accent : '#F9F4ED',
                borderWidth: Math.max(1, 1.5 * s),
                borderColor: highlighted ? darken(accent) : withAlpha(accent, 0.55),
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.bodySemibold,
                  fontSize: initialsSize,
                  lineHeight: initialsSize * 1.3,
                  letterSpacing: initialsSize * 0.08,
                  // letterSpacing adds trailing space after the last glyph, which
                  // biases the pair left; pad it back to optically center.
                  paddingLeft: initialsSize * 0.08,
                  color: highlighted ? ON_COLOR : darken(accent),
                }}
              >
                {isOverflowSlot ? `+${overflow}` : initialsOf(member!.name)}
              </Text>
            </View>
            {showLabels && !isOverflowSlot ? (
              <Text
                numberOfLines={1}
                style={{
                  marginTop: 6 * s,
                  fontFamily: fonts.body,
                  fontSize: Math.max(10, 12.5 * s),
                  lineHeight: Math.max(15, 19 * s),
                  letterSpacing: 0.625 * s,
                  color: highlighted ? darken(accent) : 'rgba(32,30,29,0.62)',
                  maxWidth: 110 * s,
                  textAlign: 'center',
                }}
              >
                {member!.name.split(/\s+/)[0]}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
