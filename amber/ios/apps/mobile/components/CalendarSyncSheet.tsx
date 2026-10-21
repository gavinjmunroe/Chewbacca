import { connectCalendarProvider } from '../lib/calendarConnect';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronRight, Plus, Smartphone, TriangleAlert, X } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { CText } from './classical';
import { cl, HAIRLINE } from '../lib/classical';
import { toast } from '../lib/toast';
import { calendarAccess, requestCalendarAccess, readCalendarSources } from '../lib/deviceCalendar';
import {
  accountStatusLine,
  disconnectCalendarAccount,
  getCalendarAccounts,
  PROVIDER_LABEL,
  type CalendarAccount,
  type CalendarProvider,
} from '../lib/calendarAccounts';

/**
 * EVERY CALENDAR, AND WHERE EACH ONE COMES FROM.
 *
 *   "The Manage Calendars button still doesn't show me all the calendars I can
 *    manage. It should show me Google logins so I can log into multiple
 *    calendars. It's showing me the calendars I already have logged in. If I
 *    have Apple and one Google account, it should say 'you have your Apple and
 *    this Google account', and you should have the option to add another Apple
 *    account, another Google account, another Calendly account, or whatever."
 *
 * THERE ARE TWO LISTS AND THEY BEHAVE DIFFERENTLY, so the sheet shows two lists
 * and says which is which. Merging them into one would be tidier and would lie
 * about what the buttons do.
 *
 *   ON THIS PHONE -- iOS keeps ONE calendar database and every account added in
 *   iOS Settings writes into it: iCloud, a work Exchange, a Google signed in on
 *   the device. One permission brings in all of them, already syncing, with no
 *   tokens for Amber to hold. Nothing in here can ADD one: account setup lives
 *   in the Settings app and no third-party app is allowed near it. So that row
 *   is a link to Settings, and it is honest about being one.
 *
 *   LOGGED INTO AMBER -- an account this app authorized itself, with its own row
 *   and its own refresh token. This is the answer to "another Google account":
 *   a work calendar that is not on the phone, or a second one alongside the
 *   first. Migration 046 made these rows rather than a single slot in a secrets
 *   bag, which is what makes "another" possible at all.
 *
 * WHAT THIS SHEET STILL WILL NOT DO is a Calendly, or any provider Amber has no
 * OAuth client for. Those are named nowhere rather than drawn as a button that
 * opens nothing, because a control that does nothing is the thing this app
 * cannot afford. The previous version of this file said the same about a second
 * Google account; that one is now real, and this is what it looks like when it
 * lands.
 */

/** The providers Amber can log into directly, in the order they are offered. */
const ADDABLE: { id: CalendarProvider; label: string; blurb: string }[] = [
  { id: 'google', label: 'Google', blurb: 'A work or personal Google Calendar.' },
  { id: 'microsoft', label: 'Outlook', blurb: 'An Outlook or Microsoft 365 calendar.' },
];

export function CalendarSyncSheet({
  visible,
  onClose,
  onConnected,
  googleOnly = false,
}: {
  visible: boolean;
  googleOnly?: boolean;
  onClose: () => void;
  /** Fired once anything changes, so the day can reload with real events. */
  onConnected?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [access, setAccess] = useState<'granted' | 'undetermined' | 'denied' | null>(null);
  const [sources, setSources] = useState<{ title: string; account: string | null }[]>([]);
  const [accounts, setAccounts] = useState<CalendarAccount[] | null>(null);
  const [accountError, setAccountError] = useState('');
  const [asking, setAsking] = useState(false);
  const [adding, setAdding] = useState<CalendarProvider | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const a = await calendarAccess();
    setAccess(a);
    setSources(a === 'granted' ? await readCalendarSources() : []);
    // The server list is independent of the phone permission: somebody can have
    // a Google account logged into Amber and never have granted calendar access
    // on the device, and the reverse.
    const result = await getCalendarAccounts().catch(() => null);
    setAccountError(result?.ok ? '' : 'Could not load your Amber calendar accounts. Try again.');
    if (result?.ok) setAccounts(result.data.accounts);
  }, []);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void (async () => {
      const a = await calendarAccess();
      if (!alive) return;
      setAccess(a);
      const [src, accts] = await Promise.all([
        a === 'granted' ? readCalendarSources() : Promise.resolve([]),
        getCalendarAccounts().catch(() => null),
      ]);
      if (!alive) return;
      setSources(src);
      setAccountError(
        accts?.ok ? '' : 'Could not load your Amber calendar accounts. Reopen to retry.',
      );
      if (accts?.ok) setAccounts(accts.data.accounts);
    })();
    return () => {
      alive = false;
    };
  }, [visible]);

  const connect = useCallback(async () => {
    setAsking(true);
    const granted = await requestCalendarAccess();
    setAsking(false);
    setAccess(granted);
    if (granted === 'granted') {
      setSources(await readCalendarSources());
      onConnected?.();
    }
  }, [onConnected]);

  /**
   * ADD AN ACCOUNT: the same OAuth round trip the Connected apps section runs,
   * pointed at the calendar. It can be run again for a SECOND account of the
   * same provider -- see the note on select_account in the server's init.
   */
  const addAccount = useCallback(
    async (provider: CalendarProvider) => {
      setAdding(provider);
      try {
        const result = await connectCalendarProvider(provider, () => {}, true);
        if (!result.connected) return;
        toast.success('Calendar connection', result.message);
        await refresh();
        onConnected?.();
      } catch (error) {
        toast.error(
          'Calendar connection',
          error instanceof Error ? error.message : 'Could not complete sign-in.',
        );
      } finally {
        setAdding(null);
      }
    },
    [refresh, onConnected],
  );

  const removeAccount = useCallback(
    async (account: CalendarAccount) => {
      setRemoving(account.id);
      // OPTIMISTIC, because the row is gone from the server's point of view the
      // moment this returns and a list that lags reads as a failed tap.
      const before = accounts ?? [];
      setAccounts(before.filter((a) => a.id !== account.id));
      const res = await disconnectCalendarAccount(account.id);
      setRemoving(null);
      if (!res.ok) {
        setAccounts(before);
        toast.error('Could not disconnect', 'Try again in a moment.');
        return;
      }
      toast.success(`${account.accountEmail} disconnected.`, 'Its events are off your day.');
      onConnected?.();
    },
    [accounts, onConnected],
  );

  const deviceCount = sources.length;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessible={false}
        style={{ flex: 1, backgroundColor: 'rgba(32,31,29,0.28)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          accessible={false}
          style={{
            backgroundColor: cl.groundCream,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingTop: 16,
            paddingBottom: Math.max(insets.bottom, 12) + 10,
            maxHeight: '88%',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 18,
              paddingBottom: 12,
            }}
          >
            <CText t="kicker" color={cl.ink45}>
              YOUR CALENDARS
            </CText>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={12}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <X size={19} color={cl.ink48} strokeWidth={2} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 18, gap: 22 }}>
            {!!accountError && (
              <CText t="metaSm" color={cl.goldDeep}>
                {accountError}
              </CText>
            )}
            {/* ── ON THIS PHONE ──────────────────────────────────────────── */}
            <View style={{ gap: 10 }}>
              <SectionHead
                title="On this phone"
                blurb={
                  access === 'granted'
                    ? deviceCount > 0
                      ? 'Every account you have added in iOS Settings, kept current by the phone. Amber reads these and holds no password for them.'
                      : 'Access is on, and the phone is not reporting any calendars yet.'
                    : 'One permission brings in every account already on this phone at once. iCloud, a work Exchange, a Google signed in on the device.'
                }
              />

              {access === 'granted' ? (
                <>
                  <View style={{ gap: 1 }}>
                    {sources.map((s, i) => (
                      <Row
                        key={`${s.title}-${i}`}
                        first={i === 0}
                        icon={<Check size={16} color={cl.goldDeep} strokeWidth={2.4} />}
                        title={s.title}
                        sub={s.account}
                      />
                    ))}
                  </View>
                  {/*
                    THE ONE THING THIS APP GENUINELY CANNOT DO. Adding an iCloud
                    or a device Google account is the Settings app's job, and a
                    button here pretending otherwise would be the worst kind of
                    dead control. Whatever they add there shows up on the next
                    read with no further permission.
                  */}
                  <LinkRow
                    label="Add an account in iOS Settings"
                    accessibilityLabel="Add another account"
                    onPress={() => void Linking.openSettings().catch(() => {})}
                  />
                </>
              ) : access === 'denied' ? (
                <View style={{ gap: 10 }}>
                  <CText t="metaSm" color={cl.ink48}>
                    {/* iOS only offers the permission sheet once, so an "Allow"
                        button here would do nothing. */}
                    iOS only asks once, so this has to be turned back on in Settings, Amber,
                    Calendars.
                  </CText>
                  <BigButton
                    label="Open Settings"
                    accessibilityLabel="Open Settings"
                    onPress={() => void Linking.openSettings().catch(() => {})}
                  />
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  <BigButton
                    label={asking ? 'Asking…' : 'Use the calendars on this phone'}
                    accessibilityLabel="Sync my calendars"
                    disabled={asking}
                    onPress={() => void connect()}
                  />
                  <Pressable
                    onPress={() => void refresh()}
                    accessibilityRole="button"
                    accessibilityLabel="Check again"
                    hitSlop={8}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignSelf: 'center' })}
                  >
                    <CText t="metaXs" color={cl.ink45}>
                      Already added one? Check again
                    </CText>
                  </Pressable>
                </View>
              )}
            </View>

            {/* ── LOGGED INTO AMBER ──────────────────────────────────────── */}
            <View style={{ gap: 10 }}>
              <SectionHead
                title="Logged into Amber"
                blurb="Accounts Amber signed into itself. This is how a calendar that is not on your phone gets in, and how a second Google sits alongside the first."
              />

              {accounts === null ? (
                <ActivityIndicator color={cl.gold55} />
              ) : accounts.length > 0 ? (
                <View style={{ gap: 1 }}>
                  {accounts.map((a, i) => (
                    <Row
                      key={a.id}
                      first={i === 0}
                      icon={
                        a.lastError ? (
                          <TriangleAlert size={16} color="#B4562E" strokeWidth={2.2} />
                        ) : (
                          <Check size={16} color={cl.goldDeep} strokeWidth={2.4} />
                        )
                      }
                      title={`${PROVIDER_LABEL[a.provider]} · ${a.accountEmail}`}
                      sub={accountStatusLine(a)}
                      action={
                        <Pressable
                          onPress={() => void removeAccount(a)}
                          disabled={removing === a.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Disconnect ${a.accountEmail}`}
                          hitSlop={10}
                          style={({ pressed }) => ({
                            opacity: pressed || removing === a.id ? 0.5 : 1,
                          })}
                        >
                          <CText t="metaSm" color={cl.ink48}>
                            {removing === a.id ? 'Removing…' : 'Disconnect'}
                          </CText>
                        </Pressable>
                      }
                    />
                  ))}
                </View>
              ) : (
                <CText t="metaSm" color={cl.ink48}>
                  None yet.
                </CText>
              )}

              <View style={{ gap: 1, marginTop: 2 }}>
                {ADDABLE.filter((provider) => !googleOnly || provider.id === 'google').map(
                  (p, i) => (
                    <Pressable
                      key={p.id}
                      onPress={() => void addAccount(p.id)}
                      disabled={adding !== null}
                      accessibilityRole="button"
                      accessibilityLabel={`Add a ${p.label} account`}
                      style={({ pressed }) => ({
                        opacity: adding !== null && adding !== p.id ? 0.4 : pressed ? 0.6 : 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        paddingVertical: 12,
                        borderTopWidth: i === 0 ? 0 : HAIRLINE,
                        borderTopColor: cl.ruleFaint,
                      })}
                    >
                      <Plus size={16} color={cl.goldDeep} strokeWidth={2.4} />
                      <View style={{ flex: 1 }}>
                        <CText t="body" color={cl.goldDeep}>
                          {adding === p.id ? `Opening ${p.label}…` : `Add a ${p.label} account`}
                        </CText>
                        <CText t="metaXs" color={cl.ink45}>
                          {p.blurb}
                        </CText>
                      </View>
                      {adding === p.id ? (
                        <ActivityIndicator color={cl.gold55} />
                      ) : (
                        <ChevronRight size={16} color={cl.goldDeep} strokeWidth={2} />
                      )}
                    </Pressable>
                  ),
                )}
              </View>

              {/* SAID ONCE, PLAINLY, rather than drawn as a row that does nothing. */}
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <Smartphone size={13} color={cl.ink45} strokeWidth={2} style={{ marginTop: 2 }} />
                <CText t="metaXs" color={cl.ink45} style={{ flex: 1 }}>
                  An iCloud account cannot be added from inside an app. Add it in iOS Settings and
                  it arrives in the list above.
                </CText>
              </View>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SectionHead({ title, blurb }: { title: string; blurb: string }) {
  return (
    <View style={{ gap: 4 }}>
      <CText t="cardTitle" style={{ fontSize: 18 }}>
        {title}
      </CText>
      <CText t="metaSm" color={cl.ink48}>
        {blurb}
      </CText>
    </View>
  );
}

function Row({
  first,
  icon,
  title,
  sub,
  action,
}: {
  first: boolean;
  icon: React.ReactNode;
  title: string;
  sub: string | null;
  action?: React.ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 12,
        borderTopWidth: first ? 0 : HAIRLINE,
        borderTopColor: cl.ruleFaint,
      }}
    >
      {icon}
      <View style={{ flex: 1 }}>
        <CText t="body" color={cl.ink} numberOfLines={1}>
          {title}
        </CText>
        {sub ? (
          <CText t="metaXs" color={cl.ink45} numberOfLines={1}>
            {sub}
          </CText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

function LinkRow({
  label,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  /** See BigButton: the gate reads the literal, and this capability is unchanged. */
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => ({
        opacity: pressed ? 0.6 : 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 6,
      })}
    >
      <CText t="metaSm" color={cl.goldDeep} style={{ flex: 1 }}>
        {label}
      </CText>
      <ChevronRight size={16} color={cl.goldDeep} strokeWidth={2} />
    </Pressable>
  );
}

function BigButton({
  label,
  accessibilityLabel,
  onPress,
  disabled,
}: {
  label: string;
  /**
   * The accessible name, when it must not move with the visible one.
   *
   * NAMED EXACTLY AS REACT NATIVE SPELLS IT, and that is load-bearing twice
   * over: the screen-contract gate reads `accessibilityLabel` literals to know
   * what the app can still do, and a capability that moves behind a helper's
   * differently-named prop reads to the gate as a deleted one. It caught this
   * refactor doing precisely that.
   */
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => ({
        opacity: disabled ? 0.6 : pressed ? 0.7 : 1,
        backgroundColor: cl.goldDeep,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
      })}
    >
      <CText t="listTitle" color="#FFFFFF">
        {label}
      </CText>
    </Pressable>
  );
}
