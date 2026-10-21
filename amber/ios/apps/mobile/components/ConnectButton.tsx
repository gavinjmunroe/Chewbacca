import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './Text';
import type { ConnectSearchUser } from '../lib/connect';
import { radius, spacing } from '../lib/tokens';
import { LIGHT } from '../lib/theme';
import { HAIRLINE, cl } from '../lib/classical';

// The Connect button's four status states, shared by the search screen and the
// contact card so both stay in lockstep:
//   'none'        → "Connect"          (fires onConnect)
//   'pending_out' → "Requested"        (disabled)
//   'connected'   → "Connected"        (disabled)
//   'pending_in'  → "Wants to connect" (fires onGoToInbox)
export function ConnectButton({
  status,
  busy,
  onConnect,
  onGoToInbox,
}: {
  status: ConnectSearchUser['status'];
  busy: boolean;
  onConnect: () => void;
  onGoToInbox: () => void;
}) {
  if (status === 'connected') {
    return (
      <View
        style={{
          paddingHorizontal: spacing.md,
          height: 32,
          borderRadius: radius.full,
          backgroundColor: LIGHT.surfaceSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text variant="captionSm" style={{ color: LIGHT.textMuted }}>
          Connected
        </Text>
      </View>
    );
  }

  if (status === 'pending_out') {
    return (
      <View
        style={{
          paddingHorizontal: spacing.md,
          height: 32,
          borderRadius: radius.full,
          backgroundColor: LIGHT.surfaceSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text variant="captionSm" style={{ color: LIGHT.textMuted }}>
          Requested
        </Text>
      </View>
    );
  }

  if (status === 'pending_in') {
    return (
      <Pressable onPress={onGoToInbox} accessibilityRole="button" accessibilityLabel="Wants to connect">
        <View
          style={{
            paddingHorizontal: spacing.md,
            height: 32,
            borderRadius: radius.full,
            backgroundColor: LIGHT.chipBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="captionSm" style={{ color: LIGHT.chipText }}>
            Wants to connect
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onConnect}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Connect"
    >
      <View
        style={{
          paddingHorizontal: spacing.md,
          height: 32,
          borderRadius: radius.full,
          backgroundColor: cl.tint100,
          borderWidth: HAIRLINE,
          borderColor: cl.gold55,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? (
          <ActivityIndicator size="small" color={cl.goldDeep} />
        ) : (
          <Text variant="buttonSm" style={{ color: cl.goldDeep }}>
            Connect
          </Text>
        )}
      </View>
    </Pressable>
  );
}
