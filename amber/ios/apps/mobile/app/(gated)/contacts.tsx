import { useCallback, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, X } from 'lucide-react-native';
import { Pressable } from '../../components/Pressable';
import { CText } from '../../components/classical';
import { HAIRLINE, cl, clLayout, clRadius } from '../../lib/classical';
import { ContactsPage } from '../../components/pages/ContactsPage';
import { PeopleHeader } from '../../components/SharedHeader';
import { AmberBackdrop } from '../../components/AmberBackdrop';
import { LIGHT } from '../../lib/theme';

/**
 * THE FULL CONTACTS SCREEN, NOW A ROUTE RATHER THAN A TAB.
 *
 * "For the bottom tab, just have two tabs now: the profile page and the
 *  homepage."  ...  "[People] becomes All Contacts in the Messages panel."
 *
 * The address book itself did move into the panel -- alphabetical, searchable,
 * with a circle under each name -- and for finding somebody that is the better
 * place for it, because it is two taps from anywhere and it sits next to the
 * conversations.
 *
 * BUT THE PEOPLE TAB WAS NOT ONLY A LIST. It also owns the network favorites
 * grid, the address-book sync (permission, progress, the "shared 973 contacts"
 * state), bulk enrichment over a selection, and the duplicate-contacts merge.
 * None of that fits in a slide-out and none of it was asked to go away, so
 * deleting the page to remove the tab would have quietly taken four features
 * with it. It is pushed from the Messages panel instead: the tab is gone, the
 * capability is not.
 *
 * IT BRINGS ITS OWN FIELD. On the tab, the keyword filter was typed into the
 * app's one bottom bar, which lives above the pager and does not exist on a
 * pushed route -- so the text has to come from somewhere, and a filter belongs
 * beside the list it filters anyway. Same shell, same words, same behavior as
 * the panel's field one screen back.
 */
export default function ContactsRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [headerH, setHeaderH] = useState(() => insets.top + 130);

  const openPerson = useCallback(
    (id: string) => router.push(`/(gated)/person/${id}`),
    [router],
  );
  const back = useCallback(() => router.back(), [router]);

  return (
    <View style={{ flex: 1, backgroundColor: LIGHT.canvas }}>
      <AmberBackdrop />
      <ContactsPage
        openPerson={openPerson}
        // Dead on this screen and dead on the tab it came from -- the prop is
        // declared and threaded through ContactsList and never called. Passed
        // rather than removed so this route does not become the reason a shared
        // component's signature changed.
        onGoToPage={() => {}}
        searchQuery={query}
        headerClearance={headerH}
      />

      {/* Absolutely positioned over the list, the same arrangement home.tsx uses,
          so the list keeps its full height and its own scroll. */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          setHeaderH((prev) => (Math.abs(prev - h) > 1 ? h : prev));
        }}
      >
        <PeopleHeader
          title="Contacts"
          onBack={back}
          onAdd={() => router.push('/(gated)/connect/search')}
        />
        <View
          style={{
            paddingHorizontal: clLayout.textGutter,
            paddingTop: 6,
            paddingBottom: 12,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 9,
              paddingHorizontal: 13,
              height: 42,
              borderRadius: clRadius.pill,
              backgroundColor: 'rgba(255,255,255,0.72)',
              borderWidth: HAIRLINE,
              borderColor: cl.gold40,
            }}
          >
            <Search size={16} color={cl.ink45} strokeWidth={2.2} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search contacts"
              placeholderTextColor={cl.ink38}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel="Search your contacts"
              style={{ flex: 1, padding: 0, fontSize: 15, color: cl.ink }}
            />
            {query ? (
              <Pressable
                onPress={() => setQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                hitSlop={10}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <X size={15} color={cl.ink45} strokeWidth={2.2} />
              </Pressable>
            ) : null}
          </View>
          {query ? (
            <CText t="metaSm" color={cl.ink45} style={{ paddingTop: 6, fontSize: 11.5 }}>
              Filtering your address book
            </CText>
          ) : null}
        </View>
      </View>
    </View>
  );
}
