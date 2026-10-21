import Svg, { Path } from 'react-native-svg';
/** Exact Computer icon paths from perplexity.ai/products/computer, #computer-icon. */
export function ComputerMark({ size = 24, color = '#292622' }: { size?: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 29 24" fill="none" accessible={false}><Path d="M22.41 1.334H6.59c-1.455 0-2.635 1.194-2.635 2.667v10.666c0 1.473 1.18 2.667 2.636 2.667h15.818c1.456 0 2.637-1.194 2.637-2.667V4.001c0-1.473-1.18-2.667-2.637-2.667ZM1.318 22.668h26.364" stroke={color} strokeWidth={2.667} strokeLinecap="round" strokeLinejoin="round" /><Path d="M11.8638 6.6670V9.3337M17.1362 6.6670V9.3337" stroke={color} strokeWidth={2.667} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}
