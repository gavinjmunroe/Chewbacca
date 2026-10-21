import { Pressable, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { ProfilePage } from '../../components/pages/ProfilePage';
import { TabBar } from '../../components/TabBar';
import { HAIRLINE, cl } from '../../lib/classical';
import { ClassicalGround } from '../../components/classical';

// mockup-2's "You" screen. The header row is just a back affordance now — the
// wordmark and everything below it live in ProfilePage, matching the reference,
// which has no second title bar here.
//
// The floating tab pill renders on this route too (with YOU active, as the mockup
// shows) so Home stays one tap away. The route itself is unchanged: it is still a
// push, and selecting the other tab routes back to /(gated)/home.
//
// TWO TABS NOW. There is one other place to go from here, so the branch that
// chose between People and Today is gone with the People tab.
export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  return (
    <View style={{ flex: 1, backgroundColor: cl.ground }}>
      <ClassicalGround width={width} height={height} />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 14,
          paddingTop: insets.top + 10,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.66)',
              borderWidth: HAIRLINE,
              borderColor: 'rgba(32,31,29,0.10)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ArrowLeft color="#605D5D" size={18} strokeWidth={1.8} />
          </View>
        </Pressable>
      </View>

      <ProfilePage isActive />

      <TabBar
        active="you"
        onSelect={(key) => {
          if (key === 'you') return;
          router.replace('/(gated)/home?tab=today');
        }}
      />
    </View>
  );
}
