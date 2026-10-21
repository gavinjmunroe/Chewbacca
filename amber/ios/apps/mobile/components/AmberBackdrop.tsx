import { useWindowDimensions } from 'react-native';
import { ClassicalGround } from './classical';

// The ground behind the Home and Contacts pages. Delegates to ClassicalGround so
// the page wash is defined once, matching design-reference/Amber.dc.html's three
// warm radial gradients over #F3F2F2.
//
// This began as a depth layer for GlassCard's blur; GlassCard is now an opaque
// near-white card, so the wash is purely the ground's own warmth.
export function AmberBackdrop() {
  const { width, height } = useWindowDimensions();
  return <ClassicalGround width={width} height={height} />;
}
