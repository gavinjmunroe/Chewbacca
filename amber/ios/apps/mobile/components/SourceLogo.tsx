import { Image } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Svg, { Path, SvgXml } from 'react-native-svg';
import { AmberOutline } from './AmberOutline';
const artwork = {
  WhatsApp: require('../assets/providers/whatsapp.jpg'),
  LinkedIn: require('../assets/providers/linkedin.jpg'),
  Instagram: require('../assets/providers/instagram.jpg'),
  Snapchat: require('../assets/providers/snapchat.jpg'),
  TikTok: require('../assets/providers/tiktok.jpg'),
  iMessage: require('../assets/providers/imessage.jpg'),
  Partiful: require('../assets/providers/partiful.jpg'),
};
export type SourceName = 'Apple' | 'Web' | 'Google' | 'Meta' | 'Slack' | 'Attio' | keyof typeof artwork;
export function SourceLogo({ name, size = 32 }: { name: SourceName; size?: number }) {
  if (name === 'Google')
    return <Image source={require('../assets/providers/google-official.png')} style={{ width: size, height: size }} resizeMode="contain" accessible={false} />;
  if (name === 'Meta')
    return <ExpoImage source={require('../assets/providers/meta-official.svg')} style={{ width: size, height: size }} contentFit="contain" accessible={false} />;
  if (name === 'Slack')
    return <FontAwesome5 name="slack" size={size} color="#4A154B" accessible={false} />;
  if (name === 'Attio')
    return (
      <SvgXml
        xml={
          '<svg xmlns="http://www.w3.org/2000/svg" width="37" height="30" fill="none" viewBox="0 0 37 30">\n    <path fill="#000"\n        d="m35.705 20.45-3.014-4.778s-.011-.02-.018-.029l-.238-.375a2.44 2.44 0 0 0-2.072-1.142l-4.854-.015-.34.537-5.8 9.195-.32.509 2.43 3.846a2.43 2.43 0 0 0 2.079 1.142h6.803c.839 0 1.633-.438 2.077-1.14l.24-.38s.009-.01.01-.015l3.02-4.784a2.41 2.41 0 0 0 0-2.572zm-.92 2-3.018 4.784q-.021.032-.042.058a.41.41 0 0 1-.652-.06l-3.02-4.784a1.3 1.3 0 0 1-.154-.344 1.37 1.37 0 0 1 0-.737c.034-.118.085-.236.152-.342l3.014-4.78.007-.01a.38.38 0 0 1 .24-.172c.031-.009.058-.011.08-.015h.034c.07 0 .243.022.35.195l3.014 4.777a1.34 1.34 0 0 1 0 1.43zM26.786 8.89a2.42 2.42 0 0 0 0-2.572l-3.014-4.777-.251-.402A2.44 2.44 0 0 0 21.442 0H14.64c-.85 0-1.626.426-2.08 1.142L.378 20.452A2.4 2.4 0 0 0 0 21.738c0 .453.13.9.374 1.284l3.268 5.181a2.44 2.44 0 0 0 2.076 1.14h6.804c.854 0 1.63-.427 2.079-1.142l.248-.391v-.005s.005-.006.005-.008l2.429-3.847 7.198-11.409 2.3-3.649zm-.71-1.286c0 .247-.07.496-.212.715L13.93 27.237a.41.41 0 0 1-.35.19c-.07 0-.24-.02-.35-.19l-3.016-4.786a1.35 1.35 0 0 1 0-1.428L22.15 2.11a.41.41 0 0 1 .35-.193c.069 0 .242.02.352.195l3.013 4.777c.142.22.211.469.211.715" />\n</svg>'
        }
        width={size}
        height={size}
        accessible={false}
      />
    );
  if (name === 'Web') return <AmberOutline size={size} />;
  if (name === 'Apple')
    return (
      <Svg width={size} height={size} viewBox="0 12 14 17" accessible={false}>
        <Path
          fill="#20201E"
          d="m13.0729 17.6825a3.61 3.61 0 0 0 -1.7248 3.0365 3.5132 3.5132 0 0 0 2.1379 3.2223 8.394 8.394 0 0 1 -1.0948 2.2618c-.6816.9812-1.3943 1.9623-2.4787 1.9623s-1.3633-.63-2.613-.63c-1.2187 0-1.6525.6507-2.644.6507s-1.6834-.9089-2.4787-2.0243a9.7842 9.7842 0 0 1 -1.6628-5.2776c0-3.0984 2.014-4.7405 3.9969-4.7405 1.0535 0 1.9314.6919 2.5924.6919.63 0 1.6112-.7333 2.8092-.7333a3.7579 3.7579 0 0 1 3.1604 1.5802zm-3.7284-2.8918a3.5615 3.5615 0 0 0 .8469-2.22 1.5353 1.5353 0 0 0 -.031-.32 3.5686 3.5686 0 0 0 -2.3445 1.2084 3.4629 3.4629 0 0 0 -.8779 2.1585 1.419 1.419 0 0 0 .031.2892 1.19 1.19 0 0 0 .2169.0207 3.0935 3.0935 0 0 0 2.1586-1.1368z"
        />
      </Svg>
    );
  return (
    <Image
      source={artwork[name]}
      style={{ width: size, height: size, borderRadius: size * 0.23 }}
      accessible={false}
    />
  );
}
