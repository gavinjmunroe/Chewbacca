import { View } from 'react-native';
import {
  AtSign,
  CalendarClock,
  FileText,
  Mail,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react-native';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { Text } from './Text';
import { colors, radius, spacing } from '../lib/tokens';
import type { ConnectionRow } from '../lib/api';

type Props = {
  platform: string;
  label: string;
  blurb: string;
  status?: ConnectionRow;
  busy?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
};

// Real provider icons in a tinted bubble. lucide-react-native ships no brand
// glyphs, so each platform maps to the closest functional icon (mail, chat,
// docs) rather than an emoji or a text character.
const PLATFORM_ICON: Record<string, LucideIcon> = {
  google: Mail,
  microsoft: Mail,
  slack: MessageSquare,
  notion: FileText,
  twitter: AtSign,
};

// "Connected 3 days ago" style relative time. Returns null for missing or
// unparseable input so the caller can omit the line entirely.
function timeAgo(iso?: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

export function PlatformCard({
  platform,
  label,
  blurb,
  status,
  busy,
  onConnect,
  onDisconnect,
}: Props) {
  const connected = !!status?.connected;
  const needsUpgrade = !!status?.needsScopeUpgrade;
  const Icon = PLATFORM_ICON[platform] ?? CalendarClock;
  const synced = timeAgo(status?.lastVerifiedAt ?? status?.connectedAt);

  return (
    <Card>
      <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: radius.sm,
              backgroundColor: connected ? '#fdeef1' : colors.surfaceStrong,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon size={18} color={connected ? colors.primary : colors.muted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="titleMd">{label}</Text>
          </View>
          {connected ? (
            <Badge
              label={needsUpgrade ? 'Action needed' : 'Connected'}
              tone={needsUpgrade ? 'dnc' : 'active'}
            />
          ) : (
            <Badge label="Not connected" tone="neutral" />
          )}
        </View>

        <Text variant="bodySm" color="muted">
          {blurb}
        </Text>

        {connected && status?.account ? (
          <Text variant="bodySm" color="primary">
            Connected as {status.account}
          </Text>
        ) : null}

        {connected && synced ? (
          <Text variant="captionSm" color="mutedSoft">
            Last synced {synced}
          </Text>
        ) : null}

        {needsUpgrade ? (
          <Text variant="bodySm" color="error">
            Reconnect for full access
            {status?.missingRequiredScopes && status.missingRequiredScopes.length > 0
              ? `: ${status.missingRequiredScopes.flatMap((s) => (s.label ? [s.label] : [])).join(', ')}`
              : '.'}
          </Text>
        ) : null}

        {status?.error ? (
          <Text variant="bodySm" color="error">
            {status.error}
          </Text>
        ) : null}

        <View style={{ marginTop: spacing.sm }}>
          {connected ? (
            <Button
              label={busy ? 'Disconnecting' : needsUpgrade ? 'Reconnect' : 'Disconnect'}
              variant="secondary"
              onPress={needsUpgrade ? onConnect : onDisconnect}
              loading={busy}
              accessibilityLabel={needsUpgrade ? `Reconnect ${label}` : `Disconnect ${label}`}
            />
          ) : (
            <Button
              label={busy ? 'Opening' : 'Connect'}
              onPress={onConnect}
              loading={busy}
              accessibilityLabel={`Connect ${label}`}
            />
          )}
        </View>
      </View>
    </Card>
  );
}
