import { ContactImport } from './ContactImport';
import { AmberLiveCard } from './AmberLiveCard';
import { McpConnectionSection } from './McpConnectionSection';
import { ImessageChannelSection } from './ImessageChannelSection';
import { Pressable } from './Pressable';
import { useEffect, useRef, useState } from 'react';
import { Image, Linking, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronRight, Link, Plug, X } from 'lucide-react-native';
import { api, fetchConnections, unwrapSingle, type ConnectionRow, type Me } from '../lib/api';
import { SourceLogo } from './SourceLogo';
import { connectCalendarProvider } from '../lib/calendarConnect';
import { ApplePermissions } from './ApplePermissions';
import { cl } from '../lib/classical';

type Page = 'card' | 'connections' | 'permissions' | 'google' | 'meta' | 'mcp';
const titles: Record<Page, string> = {
  card: 'Your Amber card',
  connections: 'Connections',
  permissions: 'Apple',
  google: 'Google',
  meta: 'Meta',
  mcp: 'Amber',
};

/** Account controls stay private; the share payload is a separate, explicit allowlist. */
export function AmberAccountCard({
  importIntent,
  initialMe,
  fallbackName,
  onLoaded,
  onClose,
  onCalendars,
}: {
  importIntent?: string;
  initialMe: Me | null;
  fallbackName: string;
  onLoaded: (me: Me) => void;
  onClose: () => void;
  onCalendars: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(true);
  const afterDismiss = useRef<(() => void) | null>(null);
  const [page, setPage] = useState<Page>('card');
  const [me, setMe] = useState(initialMe);
  const [connections, setConnections] = useState<Record<string, ConnectionRow> | null>(null);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState('');
  const connectionLock = useRef(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    void api
      .me()
      .then((result) => {
        const value = unwrapSingle<Me>(result);
        if (!alive) return;
        if (value) {
          setMe(value);
          onLoaded(value);
        } else setError('Could not refresh your card. Close and reopen to retry.');
      })
      .catch(() => {
        if (alive) setError('Could not refresh your card. Close and reopen to retry.');
      });
    return () => {
      alive = false;
    };
  }, [onLoaded]);
  useEffect(() => {
    if (page !== 'connections' && page !== 'google') return;
    let alive = true;
    setConnectionError('');
    void fetchConnections()
      .then((result) => {
        if (!alive) return;
        if (result.ok) setConnections(result.data);
        else setConnectionError('Could not refresh connections. Tap to retry.');
      })
      .catch(() => {
        if (alive) setConnectionError('Could not refresh connections. Tap to retry.');
      });
    return () => {
      alive = false;
    };
  }, [page, retry]);
  const name = me?.displayName || fallbackName;
  const phone = me?.phone || me?.phoneNumber;
  const leaveFor = (action: () => void) => {
    afterDismiss.current = action;
    setVisible(false);
  };
  async function connectGoogle() {
    if (connectionLock.current) return;
    connectionLock.current = true;
    setConnecting(true);
    try {
      const result = await connectCalendarProvider('google', setConnectionMessage);
      setConnectionMessage(result.message);
      setRetry((v) => v + 1);
    } catch (e) {
      setConnectionMessage(
        e instanceof Error ? e.message : 'Could not connect Google. Please retry.',
      );
    } finally {
      connectionLock.current = false;
      setConnecting(false);
    }
  }
  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      onDismiss={() => {
        const action = afterDismiss.current;
        afterDismiss.current = null;
        if (action) {
          onClose();
          action();
        }
      }}
    >
      <View style={[s.screen, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={page === 'card' ? 'Close Amber card' : 'Back to Amber card'}
            onPress={() => (page === 'card' ? onClose() : setPage('card'))}
            style={s.icon}
          >
            {page === 'card' ? (
              <X size={23} color={cl.ink} />
            ) : (
              <ArrowLeft size={23} color={cl.ink} />
            )}
          </Pressable>
          <Text style={s.headerTitle}>
            {page === 'card' && importIntent ? 'Add contact' : titles[page]}
          </Text>
          <View style={s.icon} />
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]}
        >
          {page === 'card' && (
            <>
              {!importIntent && (
                <AmberLiveCard name={name} phone={phone || undefined} bio={me?.bio || undefined} />
              )}
              {!!error && <Text style={s.caption}>{error}</Text>}
              <ContactImport importIntent={importIntent} />
              <View style={s.group}>
                <Row
                  title="Connections"
                  detail="Apple, Google, Meta and Amber"
                  icon={<Plug size={20} color={cl.goldDeep} />}
                  onPress={() => setPage('connections')}
                />
                <Row
                  title="Amber in other apps"
                  detail="MCP connection settings"
                  icon={<Link size={20} color={cl.goldDeep} />}
                  onPress={() => setPage('mcp')}
                />
              </View>
            </>
          )}
          {page === 'connections' && (
            <>
              <Text style={s.body}>Your sources, together.</Text>
              <Text style={s.caption}>
                Choose what each source contributes to your people and plans.
              </Text>
              <View style={s.group}>
                <Row
                  title="Apple"
                  detail="Contacts, photos, location, Health and calendars"
                  icon={<SourceLogo name="Apple" size={26} />}
                  onPress={() => setPage('permissions')}
                />
                <Row
                  title="Google"
                  detail={
                    connections?.google?.connected
                      ? `${connections.google.account || 'Connected'}${connections.google.needsScopeUpgrade ? ' · Update access' : ''}`
                      : connections
                        ? 'Connect Gmail and Calendar'
                        : connectionError
                          ? 'Status unavailable · tap to retry'
                          : 'Checking connection…'
                  }
                  icon={<SourceLogo name="Google" size={26} />}
                  onPress={() => setPage('google')}
                />
                <Row
                  title="Meta"
                  detail="Muse · not connected yet"
                  icon={<SourceLogo name="Meta" size={26} />}
                  onPress={() => setPage('meta')}
                />
                <Row
                  title="Amber"
                  detail="Your network, voice memos and connected agents"
                  icon={
                    <Image
                      source={require('../assets/amber-logo.png')}
                      style={{ width: 26, height: 30 }}
                    />
                  }
                  onPress={() => setPage('mcp')}
                />
              </View>
            </>
          )}
          {page === 'google' && (
            <>
              <SourceLogo name="Google" size={36} />
              <Text style={s.body}>
                {connections?.google?.connected
                  ? connections.google.account || 'Google connected'
                  : 'Connect your Google account'}
              </Text>
              <Text style={s.caption}>
                Gmail and Calendar provide context for people and plans. You choose access during
                Google sign-in.
              </Text>
              {!!connectionError && (
                <Pressable accessibilityRole="button" onPress={() => setRetry((v) => v + 1)}>
                  <Text style={s.body}>{connectionError}</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                disabled={connecting}
                onPress={() => void connectGoogle()}
                style={[s.primary, connecting && { opacity: 0.6 }]}
              >
                <Text style={s.primaryText}>
                  {connecting
                    ? 'Connecting…'
                    : connections?.google?.connected
                      ? 'Review Google access'
                      : 'Connect Google'}
                </Text>
              </Pressable>
              {!!connectionMessage && (
                <Text accessibilityLiveRegion="polite" style={s.body}>
                  {connectionMessage}
                </Text>
              )}
              <View style={s.group}>
                <Row
                  title="Google calendars"
                  detail="Accounts, event visibility and sync"
                  onPress={() => leaveFor(onCalendars)}
                />
              </View>
            </>
          )}
          {page === 'meta' && (
            <>
              <SourceLogo name="Meta" size={40} />
              <Text style={s.name}>Amber with Muse.</Text>
              <Text style={s.body}>Not connected yet</Text>
              <Text style={s.caption}>
                We are evaluating an Amber connector for Muse. It would let you bring selected
                context into Amber and access your people and plans from Muse, with confirmation
                before saving changes.
              </Text>
              <Text style={s.caption}>
                This does not grant access to private Instagram, WhatsApp or Facebook data.
              </Text>
              <Pressable
                accessibilityRole="link"
                onPress={() =>
                  void Linking.openURL('https://muse.ai/platform/docs').catch(() =>
                    setError('Could not open Meta documentation.'),
                  )
                }
                style={s.primary}
              >
                <Text style={s.primaryText}>About Muse connectors</Text>
              </Pressable>
              {!!error && (
                <Text accessibilityRole="alert" style={s.caption}>
                  {error}
                </Text>
              )}
            </>
          )}
          {page === 'permissions' && (
            <>
              <Text style={s.body}>Choose a source. Review what it adds.</Text>
              <Text style={s.caption}>
                Review and confirm voice memo suggestions before saving people or plans. Device
                access alone does not attach data to anyone.
              </Text>
              <ApplePermissions />
              <View style={s.group}>
                <Row
                  title="Apple calendars"
                  detail="Calendar access on this device"
                  onPress={() => leaveFor(onCalendars)}
                />
              </View>
              <View style={s.group}>
                <Text style={s.rowTitle}>Where data goes</Text>
                <Text style={s.body}>
                  Voice memos: review People and Plans before saving. Google: contacts and calendar
                  sync through your connected account. Apple Health: reviewed daily summaries stay
                  on your own record.
                </Text>
                <Text style={s.caption}>
                  Automatic photo-to-person matching and friend location sharing are not connected
                  yet.
                </Text>
              </View>
            </>
          )}
          {page === 'mcp' && (
            <>
              <ImessageChannelSection />
              <McpConnectionSection />
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
function Row({
  title,
  detail,
  icon,
  onPress,
}: {
  title: string;
  detail: string;
  icon?: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.row, { opacity: pressed ? 0.55 : 1 }]}
    >
      {icon}
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={s.rowTitle}>{title}</Text>
        <Text style={s.caption}>{detail}</Text>
      </View>
      <ChevronRight size={18} color={cl.ink62} />
    </Pressable>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cl.ground },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'Outfit_500Medium',
    fontSize: 16,
    color: cl.ink,
  },
  content: { padding: 24, gap: 16 },
  card: {
    backgroundColor: cl.card,
    borderWidth: 1,
    borderColor: cl.cardHairline,
    borderRadius: 28,
    padding: 26,
    gap: 12,
    minHeight: 240,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 22 },
  rock: { width: 28, height: 34 },
  wordmark: { fontFamily: 'Newsreader_500Medium', fontSize: 25, color: cl.ink },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  name: { fontFamily: 'Newsreader_500Medium', fontSize: 32, lineHeight: 38, color: cl.ink },
  body: { fontFamily: 'Outfit_400Regular', fontSize: 15, lineHeight: 22, color: cl.ink },
  caption: { fontFamily: 'Outfit_400Regular', fontSize: 12, lineHeight: 18, color: cl.ink62 },
  link: { fontFamily: 'Outfit_400Regular', fontSize: 13, color: cl.goldDeep },
  toggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  primary: {
    minHeight: 52,
    borderRadius: 26,
    backgroundColor: cl.ink,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: 'Outfit_500Medium', fontSize: 15, color: cl.card },
  group: {
    backgroundColor: cl.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: cl.cardHairline,
    padding: 16,
    gap: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 },
  rowTitle: { fontFamily: 'Outfit_500Medium', fontSize: 15, color: cl.ink },
});
