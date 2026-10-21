import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, X } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { CText } from './classical';
import { HAIRLINE, cl, clLayout, clRadius } from '../lib/classical';
import { Avatar } from './Avatar';
import { enterFullscreenLayer } from '../lib/fullscreenLayer';
import type { Connection } from '../lib/connect';
import { matchesTerms, searchTerms } from '../lib/peopleSearch';

// YOUR CONNECTIONS, AS CARDS, FROM THE NUMBER THAT COUNTS THEM.
//
// "When I press Connections in the three connections area, I should be able to
//  see my three connections as cards appear in my view page. I X out of that at
//  the top, and then it disappears elegantly. As many connections as I have
//  should appear. There should be a search bar at the top for me to have a
//  keyword search for them next to the X bar."
//
// The number was already on the profile hero and already correct; it just was not
// a button. Tapping a count and having nothing happen is the app telling you it
// knows something it will not show you.
//
// SPACING, because he has had to say this more than once: "Make sure that it's
// not too close to the top banner. You keep pushing things to the very top, and
// it doesn't look good with iPhones, so make sure it is properly spaced. Make
// sure this fits every phone ever." So every edge here is derived from
// useSafeAreaInsets and nothing is a measured-on-one-device constant: the top row
// sits at inset + 14, the list ends at inset + 24, and on a phone with no insets
// at all the Math.max floors keep real padding rather than collapsing to zero.
//
// Fade, not slide -- see scripts/motion-check.mts. "I X out of that at the top,
// and then it disappears elegantly" is the same transition on the way out.

/**
 * Different columns from the contacts list, deliberately -- a connection carries
 * a username, an occupation and a city -- but the same RULE, from
 * lib/peopleSearch.ts: accents folded, words in any order, every word has to
 * match something.
 *
 * The `.some()` this replaces was also wrong in a way the others were not: it
 * matched if ANY ONE field contained the whole query, so a two-word search
 * across a name and a city could not work at all.
 */
function matches(c: Connection, needle: string): boolean {
  const u = c.user;
  return matchesTerms([u.fullName, u.username, u.occupation, u.currentCity], searchTerms(needle));
}

export function ConnectionsSheet({
  visible,
  connections,
  loading = false,
  onClose,
  onOpenPerson,
}: {
  visible: boolean;
  connections: Connection[];
  loading?: boolean;
  onClose: () => void;
  /** Their card, when the viewer has one for them. Optional: not every connection is a contact. */
  onOpenPerson?: (amberId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [needle, setNeedle] = useState('');

  const shown = useMemo(
    () => connections.filter((c) => matches(c, needle.trim())),
    [connections, needle],
  );

  // This covers the screen, so the app chrome underneath steps aside. Claimed
  // only while actually visible -- a Modal that is not visible still renders.
  useEffect(() => {
    if (!visible) return undefined;
    return enterFullscreenLayer();
  }, [visible]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: cl.ground }}>
        {/* THE TOP ROW: the search field, and the X beside it. In that order,
            because the X is the thing you reach for last and it belongs at the
            trailing edge where every other close button in the app lives. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: clLayout.gutter,
            paddingTop: Math.max(insets.top, 12) + 14,
            paddingBottom: 12,
          }}
        >
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 9,
              height: 44,
              paddingHorizontal: 14,
              borderRadius: 22,
              backgroundColor: cl.card,
              borderWidth: HAIRLINE,
              borderColor: cl.cardHairline,
            }}
          >
            <Search size={18} color={cl.ink45} strokeWidth={2.1} />
            <TextInput
              value={needle}
              onChangeText={setNeedle}
              placeholder="Search connections"
              placeholderTextColor={cl.ink45}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              // 17: the iOS body size. A search field is a place someone reads
              // what they are typing, and every field in this app that was
              // smaller than this has been reported as too small.
              style={{ flex: 1, padding: 0, fontSize: 17, color: cl.ink }}
            />
            {needle.length > 0 ? (
              <Pressable
                onPress={() => setNeedle('')}
                accessibilityRole="button"
                accessibilityLabel="Clear the search"
                hitSlop={10}
              >
                <X size={16} color={cl.ink45} strokeWidth={2.2} />
              </Pressable>
            ) : null}
          </View>

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close connections"
            hitSlop={12}
            style={{ padding: 4 }}
          >
            <X size={26} color={cl.goldDeep} strokeWidth={2.2} />
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: clLayout.gutter, paddingBottom: 10 }}>
          <CText t="kicker" color={cl.goldKicker}>
            {needle.trim()
              ? `${shown.length} of ${connections.length}`
              : `${connections.length} ${connections.length === 1 ? 'connection' : 'connections'}`}
          </CText>
        </View>

        <FlatList
          data={shown}
          keyExtractor={(c) => c.connectionId}
          contentContainerStyle={{
            paddingHorizontal: clLayout.gutter,
            // The list's own bottom, on every phone: the home indicator's inset
            // plus real air, floored so a device without one still gets padding.
            paddingBottom: Math.max(insets.bottom, 12) + 24,
            gap: 10,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            loading ? (
              <View style={{ paddingTop: 48, alignItems: 'center' }}>
                <ActivityIndicator color={cl.ink45} />
              </View>
            ) : (
              <View style={{ paddingTop: 48, alignItems: 'center', paddingHorizontal: 24 }}>
                <CText t="aside" color={cl.ink48} style={{ textAlign: 'center' }}>
                  {connections.length === 0
                    ? 'Nobody yet. Share your card and the people who accept show up here.'
                    : 'Nobody matches that.'}
                </CText>
              </View>
            )
          }
          renderItem={({ item }) => (
            <ConnectionCard connection={item} onOpen={onOpenPerson} />
          )}
        />
      </View>
    </Modal>
  );
}

function ConnectionCard({
  connection,
  onOpen,
}: {
  connection: Connection;
  onOpen?: (amberId: string) => void;
}) {
  const u = connection.user;
  const name = (u.fullName || u.username || 'Someone').trim();
  // "@handle · Role · City", each part optional, so the separator only shows
  // where there is something on both sides of it.
  const sub = [u.username ? `@${u.username}` : null, u.occupation, u.currentCity]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join('  ·  ');

  return (
    <Pressable
      onPress={onOpen ? () => onOpen(u.amberId) : undefined}
      accessibilityRole={onOpen ? 'button' : undefined}
      accessibilityLabel={onOpen ? `Open ${name}` : undefined}
      style={{ borderRadius: clRadius.card }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 13,
          padding: 14,
          borderRadius: clRadius.card,
          backgroundColor: cl.card,
          borderWidth: HAIRLINE,
          borderColor: cl.cardHairline,
        }}
      >
        <Avatar name={name} url={u.avatarUrl ?? undefined} size={46} />
        <View style={{ flex: 1, gap: 3 }}>
          <CText t="listTitle" numberOfLines={1}>
            {name}
          </CText>
          {sub ? (
            <CText t="metaSm" color={cl.ink48} numberOfLines={1}>
              {sub}
            </CText>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
