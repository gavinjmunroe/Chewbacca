import { View } from 'react-native';
import Svg, { Circle, Line, Polygon } from 'react-native-svg';
import { Text } from './Text';
import { LIGHT } from '../lib/theme';
import { RADAR_DIMENSIONS } from '../lib/healthDimensions';

/**
 * The six-dimension health radar, clockwise from the top.
 *
 * THE LIST MOVED TO lib/healthDimensions.ts. Node's type-stripping cannot load a
 * .tsx, so a constant defined here is a constant no test can import -- and the
 * mapping from the server's dimension order onto these spokes is precisely the
 * thing that has to be tested, because getting it wrong plots every score on the
 * wrong axis and produces a shape that looks entirely correct.
 *
 * Imported AND re-exported: `export { X } from` creates no local binding, and
 * this file uses the list below.
 *
 * `values` is six numbers 0..1 in THIS order, which is a display order and not
 * the ontology's id order. Use dimensionsToRadar in lib/selfDimensions.ts to map
 * rather than assuming the two agree; they do not.
 *
 * With `values` omitted the radar draws its frame in a "building your read"
 * state, no plotted shape, so it shows the shape of the question without
 * inventing an answer.
 */
export { RADAR_DIMENSIONS } from '../lib/healthDimensions';

const GRID = 'rgba(182,130,53,0.30)';
const FILL = 'rgba(199,142,54,0.28)';
const STROKE = '#9A6E28';

export function HealthRadar({
  size = 280,
  values,
}: {
  size?: number;
  values?: number[];
}) {
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.3;
  const N = 6;

  const angle = (i: number) => ((-90 + i * 60) * Math.PI) / 180;
  const point = (i: number, r: number) => ({
    x: cx + r * Math.cos(angle(i)),
    y: cy + r * Math.sin(angle(i)),
  });
  const ringPoints = (r: number) =>
    Array.from({ length: N }, (_, i) => point(i, r));
  const toPoly = (pts: { x: number; y: number }[]) =>
    pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const rings = [0.34, 0.67, 1].map((f) => toPoly(ringPoints(R * f)));
  const spokes = Array.from({ length: N }, (_, i) => point(i, R));

  const hasValues = Array.isArray(values) && values.length === N;
  const dataPts = hasValues
    ? values!.map((v, i) => point(i, R * Math.max(0.06, Math.min(1, v))))
    : null;

  const labelPos = Array.from({ length: N }, (_, i) => point(i, R * 1.32));

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {rings.map((pts, i) => (
          <Polygon key={`ring-${i}`} points={pts} fill="none" stroke={GRID} strokeWidth={1} opacity={0.55 - i * 0.12} />
        ))}
        {spokes.map((p, i) => (
          <Line key={`spoke-${i}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={GRID} strokeWidth={1} opacity={0.4} />
        ))}
        {dataPts ? (
          <Polygon points={toPoly(dataPts)} fill={FILL} stroke={STROKE} strokeWidth={2} />
        ) : null}
        {dataPts ? (
          dataPts.map((p, i) => <Circle key={`pt-${i}`} cx={p.x} cy={p.y} r={3} fill={STROKE} />)
        ) : (
          <Circle cx={cx} cy={cy} r={4} fill={STROKE} opacity={0.4} />
        )}
      </Svg>

      {labelPos.map((p, i) => {
        const side = p.x < cx - 4 ? 'left' : p.x > cx + 4 ? 'right' : 'center';
        const left = side === 'center' ? p.x - 52 : side === 'right' ? p.x + 2 : p.x - 94;
        const width = side === 'center' ? 104 : 92;
        const textAlign = side === 'center' ? 'center' : side === 'right' ? 'left' : 'right';
        const top = i === 0 ? p.y - 20 : i === 3 ? p.y + 3 : p.y - 9;
        return (
          <Text
            key={`label-${i}`}
            variant="captionSm"
            style={{ position: 'absolute', left, top, width, textAlign, color: LIGHT.textSecondary }}
          >
            {RADAR_DIMENSIONS[i]}
          </Text>
        );
      })}
    </View>
  );
}
