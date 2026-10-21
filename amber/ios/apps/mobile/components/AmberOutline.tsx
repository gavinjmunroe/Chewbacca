import Svg, { Path } from 'react-native-svg';
import { cl } from '../lib/classical';
/** Amber's asymmetric stone silhouette, kept unfilled as a search control. */
export function AmberOutline({ size = 24, active = false }: { size?: number; active?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 36" accessible={false}>
      <Path
        d="M18 3C23 3 25 8 26 13L29 22C30 29 25 33 18 34C10 35 4 31 4 24C4 19 7 16 9 12C11 7 13 3 18 3Z"
        fill="none"
        stroke={active ? cl.goldDeep : cl.ink62}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
