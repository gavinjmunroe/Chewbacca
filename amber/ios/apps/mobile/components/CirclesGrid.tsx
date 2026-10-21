import { useCallback, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect } from 'expo-router';
import { Avatar } from './Avatar';
import { Text } from './Text';
import { elevation, radius, spacing } from '../lib/tokens';
import { LIGHT } from '../lib/theme';
import { HAIRLINE, cl } from '../lib/classical';
import { useCircles, type CircleMember, type CirclePreview } from '../lib/circles';
import { NAMED_COLORS } from '../lib/circleColors';
import { FadeInUp, PressableScale } from '../lib/motion';

const CARD_MIN_H = 140;

// Falls back to the app's amber accent for null/unrecognized color values.
const DEFAULT_BASE = '#E8954A';

function shade(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = parseInt(full, 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((num >> 16) + amount);
  const g = clamp(((num >> 8) & 0xff) + amount);
  const b = clamp((num & 0xff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function baseColorFor(color: string | null): string {
  if (!color) return DEFAULT_BASE;
  const trimmed = color.trim();
  if (trimmed.startsWith('#')) return trimmed;
  return NAMED_COLORS[trimmed.toLowerCase()] ?? DEFAULT_BASE;
}

// A subtle two-stop gradient derived from a single base color, so any hex or
// named color the backend sends gets a consistent light-to-dark treatment.
function gradientFor(color: string | null): [string, string] {
  const base = baseColorFor(color);
  return [shade(base, 18), shade(base, -22)];
}

export function CirclesGrid({
  /**
   * Draw the "Circles  + New" heading. Off when the caller already has one --
   * the profile wraps this in a Section titled Circles whose header carries the
   * + New action, and two headings a line apart read as two sections with the
   * second one empty.
   */
  heading = true,
}: { heading?: boolean } = {}) {
  const circles = useCircles();
  const router = useRouter();

  const openCreate = () => router.push('/(gated)/circle/new');
  const openEdit = (circle: CirclePreview) => router.push(`/(gated)/circle/${circle.id}`);

  // The editor is now a pushed screen, not a Modal, so there's no onSaved
  // callback to reload from — reload when the grid regains focus after
  // returning from it. Skip the first focus (the initial mount) since
  // useCircles already loads on mount. Depend on `reload` itself (stable,
  // useRef-backed), not the `circles` object — useCircles returns a new
  // object every render, so depending on it re-subscribes this effect and
  // re-fires reload() every render, which setState-loops the app into
  // "Maximum update depth exceeded".
  const { reload } = circles;
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      reload();
    }, [reload]),
  );

  return (
    // No horizontal padding here: this is currently only embedded inside
    // ContactsPage's FlatList, whose contentContainerStyle already applies
    // paddingHorizontal — adding it again here would misalign the cards
    // against the contact rows below.
    <View style={{ paddingTop: heading ? spacing.lg : spacing.base, paddingBottom: spacing.xl }}>
      {heading ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: spacing.base,
          }}
        >
          <Text variant="displaySm" style={{ color: LIGHT.textPrimary }}>
            Circles
          </Text>
          <Pressable
            onPress={openCreate}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="New circle"
          >
            <Text variant="buttonSm" style={{ color: LIGHT.accentText }}>
              + New
            </Text>
          </Pressable>
        </View>
      ) : null}

      {circles.status === 'loading' ? (
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : circles.status === 'error' ? (
        <Text variant="bodySm" style={{ color: LIGHT.textMuted }}>
          {circles.errorMsg ?? "Couldn't load your circles."}
        </Text>
      ) : circles.items.length === 0 ? (
        <View style={{ alignItems: 'flex-start', gap: spacing.base }}>
          <Text variant="bodyMd" style={{ color: LIGHT.textSecondary }}>
            Group your people into circles like Close Friends, Work, or School.
          </Text>
          <Pressable
            onPress={openCreate}
            accessibilityRole="button"
            accessibilityLabel="Create your first circle"
            style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
          >
            <View
              style={{
                backgroundColor: cl.tint100,
                borderWidth: HAIRLINE,
                borderColor: cl.gold55,
                borderRadius: radius.full,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.sm,
              }}
            >
              <Text variant="buttonSm" style={{ color: cl.goldDeep }}>
                Create your first circle
              </Text>
            </View>
          </Pressable>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          {circles.items.map((c, i) => (
            <FadeInUp key={c.id} index={i} step={50} style={{ width: '47%' }}>
              <CircleCard circle={c} onPress={() => openEdit(c)} />
            </FadeInUp>
          ))}
        </View>
      )}
    </View>
  );
}

function CircleCard({ circle, onPress }: { circle: CirclePreview; onPress: () => void }) {
  const [start, end] = gradientFor(circle.color);
  const members = circle.preview.slice(0, 4);
  const peopleLabel = `${circle.memberCount} ${circle.memberCount === 1 ? 'person' : 'people'}`;
  const connectedLabel = circle.connectedCount > 0 ? ` · ${circle.connectedCount} on Amber` : '';

  return (
    <PressableScale
      onPress={onPress}
      pressedScale={0.97}
      accessibilityLabel={circle.name}
      style={{ borderRadius: radius.lg, ...elevation.md }}
    >
      <View style={{ borderRadius: radius.lg, overflow: 'hidden' }}>
        <LinearGradient
          colors={[start, end]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            minHeight: CARD_MIN_H,
            padding: spacing.base,
            justifyContent: 'space-between',
          }}
        >
          {members.length > 0 ? (
            <View style={{ flexDirection: 'row' }}>
              {members.map((m, i) => (
                <View key={m.contactId} style={{ marginLeft: i === 0 ? 0 : -10 }}>
                  <MemberBubble member={m} />
                </View>
              ))}
            </View>
          ) : (
            <View />
          )}

          <View style={{ gap: 2 }}>
            <Text variant="titleMd" numberOfLines={1} style={{ color: '#FFFFFF' }}>
              {circle.name}
            </Text>
            <Text variant="captionSm" style={{ color: 'rgba(255,255,255,0.85)' }}>
              {`${peopleLabel}${connectedLabel}`}
            </Text>
          </View>
        </LinearGradient>

        {/* Glass gloss: a faint top-lit sheen over the circle's own color,
            without washing it out like a heavier blur/tint would. */}
        <LinearGradient
          colors={['rgba(255,255,255,0.18)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: radius.lg,
          }}
        />
      </View>

      {/* Amber glowing dot: unseen shared notes in this circle. Sits OUTSIDE the
          overflow-hidden inner view so its glow isn't clipped. Opening the
          circle's Feed marks the notes seen, and the grid refetch on focus drops
          the dot. */}
      {circle.hasUnseen ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -3,
            right: -3,
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: '#E8954A',
            borderWidth: 2,
            borderColor: '#FFFFFF',
            shadowColor: '#E8954A',
            shadowOpacity: 0.9,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 0 },
            elevation: 4,
          }}
        />
      ) : null}
    </PressableScale>
  );
}

function MemberBubble({ member }: { member: CircleMember }) {
  return (
    <View>
      <View
        style={{
          borderWidth: 2,
          borderColor: 'rgba(255,255,255,0.9)',
          borderRadius: radius.full,
        }}
      >
        <Avatar name={member.name} url={member.avatarUrl ?? undefined} size={28} />
      </View>
      {member.connected ? (
        <View
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: 9,
            height: 9,
            borderRadius: radius.full,
            backgroundColor: '#22C55E',
            borderWidth: 1.5,
            borderColor: '#FFFFFF',
          }}
        />
      ) : null}
    </View>
  );
}

function SkeletonCard() {
  return (
    <View
      style={{
        flex: 1,
        minHeight: CARD_MIN_H,
        borderRadius: radius.lg,
        backgroundColor: LIGHT.surface,
      }}
    />
  );
}
