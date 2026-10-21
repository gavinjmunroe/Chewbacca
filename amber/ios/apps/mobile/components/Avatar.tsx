import { Image } from 'expo-image';
import { radius } from '../lib/tokens';
import { cl } from '../lib/classical';
import { CAvatar } from './classical';

// The mockups' "DA / RL / EC" chip. Delegates to CAvatar so the photo path and
// the initials path stay one component across the app: tan gradient face
// (#FFF3E4 → #F0D9B4), deep-gold initials (#7D5411), gold hairline edge.
//
// `tone="neutral"` is the grayed face design-reference uses for lower-ranked
// rows in the network list.
export function Avatar({
  name,
  url,
  size = 64,
  tone = 'gold',
}: {
  name?: string;
  url?: string;
  size?: number;
  tone?: 'gold' | 'neutral';
}) {
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        accessibilityIgnoresInvertColors
        // Cross-fade in once the image decodes instead of popping from blank.
        transition={220}
        contentFit="cover"
        cachePolicy="memory-disk"
        style={{
          width: size,
          height: size,
          borderRadius: radius.full,
          backgroundColor: cl.tint200,
          borderWidth: 0.5,
          borderColor: cl.gold40,
        }}
      />
    );
  }
  return <CAvatar name={name} size={size} tone={tone} />;
}
