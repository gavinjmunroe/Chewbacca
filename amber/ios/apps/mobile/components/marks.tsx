import { Text, View } from 'react-native';
import Svg, { Circle as SvgCircle, Path } from 'react-native-svg';
import { cl } from '../lib/classical';
import { NAMED_COLORS } from '../lib/circleColors';
import { fonts } from '../lib/tokens';

/**
 * YOUR MARK.
 *
 * The profile hero used to wear a gradient terracotta disc — the single heaviest
 * object on a page otherwise made of tone, so the eye landed on it and stopped.
 * This is the same idea as the circles web three cards below it: nodes and the
 * thin lines between them. Amber is a graph, and the one picture of YOU on the
 * profile should look like a piece of it.
 *
 * A CircleMark for pinned tiles briefly lived here too — three nodes, three
 * strings. It is gone: components/ChordEmblem draws exactly that, it is what the
 * circle's own Info tab renders, and two hand-tuned drawings of "points on a
 * ring joined by strings" were never going to stay in step. The pinned grid uses
 * ChordEmblem with nodeStyle="dots".
 */


// YOUR CONSTELLATION, and every value in it is fixed on purpose.
//
// The dots are unlabelled — they are not your contacts, and a mark that looked
// like data would be lying about being data. They are placed by hand so the
// arrangement reads as composed rather than scattered: no two dots on the same
// ring at a similar angle, sizes varied so the field has depth, and the four
// with a connector are the four furthest apart.
//
// Randomising this was the alternative and it is worse in two ways: the mark
// would change every render (it is your face on your own profile), and a random
// scatter reliably clumps.
const HERO_DOTS: { ring: number; deg: number; r: number; color: string; tie: boolean }[] = [
  { ring: 0.52, deg: -64, r: 3.4, color: NAMED_COLORS.orange, tie: true },
  { ring: 0.52, deg: 118, r: 2.4, color: NAMED_COLORS.teal, tie: false },
  { ring: 0.52, deg: 208, r: 3.0, color: NAMED_COLORS.purple, tie: true },
  { ring: 0.72, deg: -14, r: 4.4, color: NAMED_COLORS.rust, tie: true },
  { ring: 0.72, deg: 62, r: 2.6, color: NAMED_COLORS.yellow, tie: false },
  { ring: 0.72, deg: 156, r: 3.6, color: NAMED_COLORS.blue, tie: false },
  { ring: 0.72, deg: 250, r: 2.3, color: NAMED_COLORS.green, tie: false },
  { ring: 0.92, deg: -108, r: 2.8, color: NAMED_COLORS.pink, tie: true },
  { ring: 0.92, deg: 24, r: 2.1, color: NAMED_COLORS.taupe, tie: false },
  { ring: 0.92, deg: 184, r: 3.2, color: NAMED_COLORS.amber, tie: false },
];

/**
 * YOUR MARK: your initial in the serif, on cream, inside a field of rings and
 * small colored dots.
 *
 * This replaces the gradient terracotta disc. That disc was built to a mockup
 * that no longer describes this app: the ground behind it is a warm gradient
 * now, so a saturated orange coin sitting on warm orange had nothing to separate
 * against except its own shadow, and it out-weighed the name underneath it.
 *
 * Cream separates against the ground on tone alone, which is the same reason
 * the cards are white; the rings carry the warmth; and the dots make the mark
 * belong to the same drawing as the circles web three cards below it.
 */
export function ProfileMark({ monogram, size }: { monogram: string; size: number }) {
  const R = size / 2;
  const dots = HERO_DOTS.map((d) => {
    const a = (d.deg * Math.PI) / 180;
    const rad = R * d.ring;
    return { ...d, x: Math.cos(a) * rad, y: Math.sin(a) * rad };
  });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg
        width={size}
        height={size}
        viewBox={`${-R} ${-R} ${size} ${size}`}
        style={{ position: 'absolute' }}
      >
        {/* The cream field. Soft rather than opaque, so it reads as a lit area
            on the ground rather than a disc stuck on top of it. */}
        <SvgCircle r={R - 0.5} fill="rgba(255,253,247,0.82)" stroke="rgba(182,130,53,0.22)" strokeWidth={1} />

        {/* Three rings for the dots to sit on, the middle one dotted so the
            field has texture at rest. */}
        <SvgCircle r={R * 0.52} fill="none" stroke="rgba(182,130,53,0.13)" strokeWidth={1} />
        <SvgCircle
          r={R * 0.72}
          fill="none"
          stroke="rgba(182,130,53,0.22)"
          strokeWidth={1}
          strokeDasharray="1.5 5"
          strokeLinecap="round"
        />
        <SvgCircle r={R * 0.92} fill="none" stroke="rgba(182,130,53,0.15)" strokeWidth={1} />

        {/* Connectors under the dots, so a line ends AT a dot rather than
            crossing it. */}
        {dots
          .filter((d) => d.tie)
          .map((d, i) => (
            <Path
              key={`tie-${i}`}
              d={`M 0 0 L ${d.x} ${d.y}`}
              stroke="rgba(182,130,53,0.16)"
              strokeWidth={0.8}
              strokeLinecap="round"
            />
          ))}

        {dots.map((d, i) => (
          <SvgCircle key={`dot-${i}`} cx={d.x} cy={d.y} r={d.r} fill={d.color} opacity={0.9} />
        ))}

        {/* A small clear disc behind the letter, so a connector passing under it
            does not run into the serif. */}
        <SvgCircle r={R * 0.3} fill="rgba(255,253,247,0.96)" />
      </Svg>
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: fonts.serif,
          fontSize: Math.round(size * 0.28),
          lineHeight: Math.round(size * 0.34),
          letterSpacing: 1.1,
          color: cl.goldDeep,
        }}
      >
        {monogram}
      </Text>
    </View>
  );
}

// ── THE TWO TAB MARKS ────────────────────────────────────────────────────────
//
// Redrawn against the rendering rather than described from one. Both are line
// art in a single color, sized to sit in a 52pt pill: the flower of life on the
// tan lozenge when Home is active, and a person inside their circles on white
// when it is not.
//
// ONE COLOR IN, EVERY STROKE OUT. TabBar renders each icon twice -- once in ink,
// once in the active tone -- and crossfades the two layers from the pager cursor
// so the recolor happens on the UI thread with no re-render. That only works if
// the whole mark takes its color from one argument, so nothing in here may
// hardcode a hue.

/**
 * HOME: the flower of life.
 *
 * NINETEEN CIRCLES, not seven. The first version drew the seven-circle "seed" --
 * one in the middle and six around it -- which at 21pt is a daisy. The rendering
 * is the full flower: the seed, plus two more hexagonal shells, nineteen circles
 * of equal radius on a triangular lattice, every one passing through the centers
 * of its neighbors. That density is the whole character of the mark; drawn with
 * six petals it reads as a clip-art flower and with nineteen it reads as
 * geometry.
 *
 * THE LATTICE IS GENERATED, NOT LISTED. Nineteen hand-typed centers is nineteen
 * chances to be a pixel out, and being a pixel out in a flower of life is
 * immediately visible -- the crossings stop meeting at a point. Every center is
 * a hex lattice point within 2r of the middle, which is exactly the classical
 * construction and cannot be typed wrong.
 */
export function HomeMark({ size, color }: { size: number; color: string }) {
  // Circle radius r, centers out to 2r, so the drawing's own extent is 3r.
  const r = size / 6;
  const centers: { x: number; y: number }[] = [];
  const ROW = (Math.sqrt(3) / 2) * r;
  for (let row = -2; row <= 2; row += 1) {
    for (let col = -2; col <= 2; col += 1) {
      const x = (col + row / 2) * r;
      const y = row * ROW;
      // 2r plus a hair, so floating point cannot drop a shell.
      if (Math.hypot(x, y) <= 2 * r + 0.001) centers.push({ x, y });
    }
  }
  const half = size / 2;
  return (
    <Svg width={size} height={size} viewBox={`${-half} ${-half} ${size} ${size}`}>
      {centers.map((c, i) => (
        <SvgCircle
          key={`fol-${i}`}
          cx={c.x}
          cy={c.y}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={0.75}
          // The nineteen overlap into roughly a hundred crossings. At full
          // strength that is a solid disc at this size; at three quarters the
          // lattice stays a lattice.
          opacity={0.78}
        />
      ))}
      {/* The enclosing circle the construction is always drawn inside. It is
          also what stops the outermost petals reading as a ragged edge. */}
      <SvgCircle cx={0} cy={0} r={half - 0.4} fill="none" stroke={color} strokeWidth={0.9} />
    </Svg>
  );
}

/**
 * YOU: a person inside their circles.
 *
 * A head and shoulders in solid ink, with two outlined circles overlapping
 * through the shoulders -- the same "points on a ring" language as ProfileMark
 * above and ChordEmblem, reduced to what survives at twenty-one points, and
 * bounded by the ring that makes it a mark rather than an avatar.
 */
export function YouMark({ size, color }: { size: number; color: string }) {
  const half = size / 2;
  const headR = half * 0.2;
  const headY = -half * 0.26;
  const shoulderR = half * 0.42;
  const shoulderY = half * 0.28;
  // The two overlapping circles the figure sits in. Placed so each passes
  // through the other's center, which is the same relation the flower is built
  // on -- the two marks are the same drawing at two densities.
  const vennR = half * 0.34;
  const vennY = half * 0.16;
  return (
    <Svg width={size} height={size} viewBox={`${-half} ${-half} ${size} ${size}`}>
      <SvgCircle cx={0} cy={0} r={half - 0.5} fill="none" stroke={color} strokeWidth={1} />
      <SvgCircle
        cx={-vennR / 2}
        cy={vennY}
        r={vennR}
        fill="none"
        stroke={color}
        strokeWidth={0.85}
        opacity={0.65}
      />
      <SvgCircle
        cx={vennR / 2}
        cy={vennY}
        r={vennR}
        fill="none"
        stroke={color}
        strokeWidth={0.85}
        opacity={0.65}
      />
      {/* SOLID, so the figure reads as a person and not as a third circle. */}
      <SvgCircle cx={0} cy={headY} r={headR} fill={color} />
      <Path
        d={`M ${-shoulderR} ${shoulderY}
            A ${shoulderR} ${shoulderR * 0.92} 0 0 1 ${shoulderR} ${shoulderY} Z`}
        fill={color}
      />
    </Svg>
  );
}
