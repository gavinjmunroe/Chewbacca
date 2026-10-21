import { OnboardingVoiceStep } from '../../components/OnboardingVoiceStep';
import { ScrollView, View } from 'react-native';
import { ApplePermissions } from '../../components/ApplePermissions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import * as Contacts from 'expo-contacts';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  ArrowLeft,
  BookUser,
  Check,
  Globe,
  Lock,
  MapPin,
  Phone,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from 'lucide-react-native';
import { useAuthGate } from '../../components/AuthGate';
import { CButton, CCard, CPressable, CText, ClassicalGround } from '../../components/classical';
import { Screen } from '../../components/Screen';
import { TextInput } from '../../components/TextInput';
import { api, unwrapSingle, type Me } from '../../lib/api';
import {
  formatCount,
  readDeviceContacts,
  syncContactsInChunks,
  type SyncProgress,
} from '../../lib/contactsSync';
import { HAIRLINE, cl, clLayout, clRadius } from '../../lib/classical';
import { callMedhaId, medhaIdErrorCopy, errorCopy, unwrapOrThrow } from '../../lib/medhaId';
import { loadSession, markOnboarded } from '../../lib/secureStorage';
import { setSyncState } from '../../lib/syncState';
import { toast } from '../../lib/toast';
import { spacing } from '../../lib/tokens';

// Post-sign-in onboarding. Name → Privacy → City → Apple
// contacts → optional voice context → permissions. Google remains in account settings.
//
// Notifications lost its step but not its prompt: app/(gated)/_layout.tsx
// registers for push on mount, so permission is still requested — just not as a
// full screen the user has to get past.
//
// It is intentionally a SINGLE route driven by an internal step machine:
// AuthGate only treats the literal `onboarding` segment as an onboarding route,
// so a multi-route (onboarding) group would be bounced back here on every
// sub-screen. One screen, many steps, keeps the gate happy and the flow
// resumable.

type StepId = 'name' | 'privacy' | 'phone' | 'city' | 'contacts' | 'google' | 'permissions' | 'family' | 'nearby' | 'priorities';

// Privacy sits right after `name`: identity and who-can-see-it are set together,
// up front, before the flow ever asks the user to hand over a phone number or
// contacts. That framing (choose visibility, then share data) is the honest
// order.
const STEPS: StepId[] = ['name', 'privacy', 'city', 'contacts', 'family', 'nearby', 'priorities', 'permissions'];

const PROGRESS_KEY = 'amber_onboarding_progress_v1';
const EVENTS_KEY = 'amber_onboarding_events_v1';

// Onboarding offers a two-way public/private choice mapped onto the SAME
// `privacyTier` field the profile screen writes (components/pages/ProfilePage
// `setPrivacyTier`): `full_social` = Public (mutuals can find and view the
// profile), `local_only` = Private (the backend visibility tier). The middle `selective_cloud` tier is only surfaced in the profile
// settings, not here.
type PrivacyTierValue = 'local_only' | 'full_social';
const PRIVACY_DEFAULT: PrivacyTierValue = 'local_only';

// Fold whatever the server holds (any historical tier string) down to the
// binary onboarding shows. Anything that is not explicitly on-device is treated
// as a sharing tier so a returning user's existing choice is reflected.
function normalizePrivacyTier(v: unknown): PrivacyTierValue | null {
  if (v === 'local_only') return 'local_only';
  if (v === 'full_social' || v === 'selective_cloud' || v === 'public' || v === 'limited') {
    return 'full_social';
  }
  return null;
}

type PersistedProgress = {
  step?: StepId;
  index: number;
  name: string;
  city: string;
  privacyTier: PrivacyTierValue;
  contactsDone: boolean;
  syncedCount: number;
};

type OnboardingEvent = {
  event: string;
  ts: number;
  props?: Record<string, string | number | boolean>;
};

// Local analytics sink. There is no telemetry endpoint wired into the app yet,
// so step events land in a bounded AsyncStorage ring buffer. That is enough to
// locate the funnel drop-off on a device during testing, and it is the single
// place to flush to a real collector when one exists. Best-effort: a failure
// here must never interrupt onboarding.
async function recordEvent(event: string, props?: Record<string, string | number | boolean>) {
  try {
    const raw = await AsyncStorage.getItem(EVENTS_KEY);
    const buf: OnboardingEvent[] = raw ? (JSON.parse(raw) as OnboardingEvent[]) : [];
    buf.push({ event, ts: Date.now(), props });
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(buf.slice(-100)));
  } catch {
    /* analytics is best-effort */
  }
}

// Advance only after Amber ID acknowledges the profile update.
async function saveProfile(patch: Record<string, unknown>) {
  unwrapOrThrow(await callMedhaId({ path: '/v1/me', method: 'PATCH', body: patch,
    requireAuth: true, timeoutMs: 8_000 }));
}

export default function Onboarding({
  preview = false,
  onPreviewComplete,
}: { preview?: boolean; onPreviewComplete?: () => void } = {}) {
  const isPreview = __DEV__ && preview;
  const track = useCallback((event: string, props?: Record<string, string | number | boolean>) => {
    if (!isPreview) void recordEvent(event, props);
  }, [isPreview]);
  const persistProfile = useCallback((patch: Record<string, unknown>) => {
    return isPreview ? Promise.resolve() : saveProfile(patch);
  }, [isPreview]);
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { markOnboardedInState } = useAuthGate();

  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [index, setIndex] = useState(0);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [privacyTier, setPrivacyTier] = useState<PrivacyTierValue>(PRIVACY_DEFAULT);
  // Sign-in captures the phone number over OTP, so this is normally a
  // confirmation rather than an entry field. `phoneFromSession` picks which.
  const [phone, setPhone] = useState('');
  const [phoneFromSession, setPhoneFromSession] = useState(false);

  const [contactsState, setContactsState] = useState<'idle' | 'syncing'>('idle');
  const [contactsDone, setContactsDone] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncedCount, setSyncedCount] = useState(0);
  const [contactsNote, setContactsNote] = useState<string | null>(null);

  const step = STEPS[index];
  const lastIndex = STEPS.length - 1;

  // Hydrate from three sources, cheapest first: local progress (a killed app
  // resumes where it stopped), the session (the phone number sign-in captured),
  // then the saved server profile. Everything already known prefills, so a user
  // who does land here again never retypes what we have.
  useEffect(() => {
    let live = true;
    if (isPreview) {
      setPhone('+12025550123');
      setPhoneFromSession(true);
      setHydrated(true);
      return;
    }
    (async () => {
      let savedPrivacy: PrivacyTierValue | null = null;
      try {
        const raw = await AsyncStorage.getItem(PROGRESS_KEY);
        if (live && raw) {
          const saved = JSON.parse(raw) as Partial<PersistedProgress>;
          if (typeof saved.index === 'number') {
            const legacyIndex = saved.index >= 2 ? Math.max(2, saved.index - 1) : saved.index;
            const restored = saved.step === 'google' ? STEPS.length - 1 : saved.step ? STEPS.indexOf(saved.step) : legacyIndex;
            setIndex(Math.min(Math.max(restored, 0), STEPS.length - 1));
          }
          if (typeof saved.name === 'string') setName(saved.name);
          if (typeof saved.city === 'string') setCity(saved.city);
          savedPrivacy = normalizePrivacyTier(saved.privacyTier);
          if (savedPrivacy) setPrivacyTier(savedPrivacy);
          if (saved.contactsDone) setContactsDone(true);
          if (typeof saved.syncedCount === 'number') setSyncedCount(saved.syncedCount);
        }
      } catch {
        /* corrupt progress is not worth blocking on */
      }

      const session = await loadSession();
      if (live && session?.phone) {
        setPhone(session.phone);
        setPhoneFromSession(true);
      }

      try {
        const me = unwrapSingle<Me>(await api.me());
        if (live && me) {
          setName((prev) => prev || me.displayName?.trim() || '');
          setCity((prev) => prev || me.currentCity?.trim() || '');
          if (!session?.phone && me.phone) setPhone((prev) => prev || me.phone!);
          // Only take the server's tier when local progress didn't already carry
          // one, so a resumed session never clobbers an in-flow choice.
          if (!savedPrivacy) {
            const serverTier = normalizePrivacyTier(me.privacyTier);
            if (serverTier) setPrivacyTier(serverTier);
          }
        }
      } catch {
        /* offline: local progress and the session are enough to continue */
      }

      if (live) setHydrated(true);
    })();
    return () => {
      live = false;
    };
  }, [isPreview]);

  // Persist progress whenever the resumable bits change (after hydration, so the
  // initial defaults never clobber the saved state).
  useEffect(() => {
    if (!hydrated || isPreview) return;
    const payload: PersistedProgress = {
      step,
      index,
      name,
      city,
      privacyTier,
      contactsDone,
      syncedCount,
    };
    AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(payload)).catch(() => {});
  }, [hydrated, index, step, name, city, privacyTier, contactsDone, syncedCount, isPreview]);

  // Fire a view event each time a step becomes visible. This is the funnel.
  const viewedRef = useRef<StepId | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (viewedRef.current === step) return;
    viewedRef.current = step;
    track('onboarding_step_view', { step, index });
  }, [hydrated, step, index, track]);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 0), lastIndex);
      if (clamped !== index) {
        Haptics.selectionAsync().catch(() => {});
        setIndex(clamped);
      }
    },
    [index, lastIndex],
  );

  const finish = useCallback(async () => {
    if (isPreview) {
      onPreviewComplete?.();
      return;
    }
    try {
      await saveProfile({ onboardingCompletedAt: new Date().toISOString() });
      await markOnboarded();
    } catch (error) {
      toast.error('Could not finish onboarding', errorCopy(error, 'Amber ID'));
      return;
    }
    track('onboarding_finished', { syncedCount });
    await AsyncStorage.removeItem(PROGRESS_KEY).catch(() => {});
    // Flip AuthGate's in-memory flag before navigating so the segKey re-check
    // that fires on the route change cannot see a stale false from the Keychain.
    markOnboardedInState();
    router.replace('/(gated)/home');
  }, [router, syncedCount, markOnboardedInState, isPreview, onPreviewComplete, track]);

  // Advancing past the last step lands in the app — there is no "done" screen to
  // dismiss any more.
  const advance = useCallback(() => {
    track('onboarding_step_complete', { step });
    if (index >= lastIndex) {
      void finish();
      return;
    }
    goTo(index + 1);
  }, [finish, goTo, index, lastIndex, step, track]);

  const back = useCallback(() => goTo(index - 1), [goTo, index]);

  const savingRef = useRef(false);
  const saveAndAdvance = useCallback(async (patch: Record<string, unknown>, event: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await persistProfile(patch);
      track(event);
      advance();
    } catch (error) {
      toast.error('Could not save your profile', errorCopy(error, 'Amber ID'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [advance, persistProfile, track]);

  const onNameContinue = useCallback(() => {
    const clean = name.trim();
    if (clean) void saveAndAdvance({ displayName: clean }, 'onboarding_name_captured');
  }, [name, saveAndAdvance]);

  const onPrivacyContinue = useCallback(() => {
    void saveAndAdvance({ privacyTier }, 'onboarding_privacy_captured');
  }, [privacyTier, saveAndAdvance]);

  // Phone ownership is established by authentication, never a profile PATCH.
  const onPhoneContinue = advance;

  const onCityContinue = useCallback(() => {
    const clean = city.trim();
    if (clean) void saveAndAdvance({ currentCity: clean }, 'onboarding_city_captured');
    else advance();
  }, [advance, city, saveAndAdvance]);

  // Contacts: ask permission, then STAY on this step showing live progress, and
  // land on a done state the user acknowledges before advancing. Progress is
  // mirrored into the shared syncState store so the home screen's indicator
  // stays correct either way.
  const syncContacts = useCallback(async () => {
    if (isPreview) {
      setSyncedCount(3);
      setContactsDone(true);
      setContactsNote('Preview: three synthetic contacts. Your address book was not accessed.');
      return;
    }
    setContactsNote(null);
    setContactsDone(false);
    try {
      const perm = await Contacts.requestPermissionsAsync();
      if (perm.status !== 'granted') {
        track('onboarding_contacts_denied');
        setContactsNote('No problem. You can sync your contacts later from your profile.');
        advance();
        return;
      }

      setContactsState('syncing');
      setSyncProgress(null);
      setSyncState({ status: 'syncing', synced: 0, total: 0, source: 'Apple' });

      let lastSynced = 0;
      try {
        const list = await readDeviceContacts();
        const res = await syncContactsInChunks(list, (p) => {
          lastSynced = p.synced;
          setSyncProgress(p);
          setSyncState({ synced: p.synced, total: p.total });
        });
        if (res.ok && !res.failed) {
          setContactsDone(true);
          setSyncedCount(res.total);
          setSyncState({ status: 'done', synced: res.total, total: res.total });
          track('onboarding_contacts_synced', { total: res.total });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } else {
          // Partial is the common failure: earlier batches are already persisted.
          setSyncedCount(lastSynced);
          setContactsNote(
            lastSynced > 0
              ? `${formatCount(lastSynced)} processed. Tap Sync my contacts to retry the remaining contacts.`
              : res.ok ? 'Some contacts could not be saved. Tap Sync my contacts to retry.' : medhaIdErrorCopy(res, 'Amber'),
          );
          setSyncState({ status: 'error' });
          track('onboarding_contacts_partial');
        }
      } catch {
        setSyncState({ status: 'error' });
        setContactsNote('Contact sync was interrupted. Tap Sync my contacts to retry, or skip for now.');
        track('onboarding_contacts_error');
      } finally {
        // Keep Retry/Skip available on failure; only a complete sync is done.
        setContactsState('idle');
      }
    } catch {
      setContactsNote('Something went wrong requesting contacts. You can sync later from your profile.');
      track('onboarding_contacts_error');
      advance();
    }
  }, [advance, isPreview, track]);

  const canGoBack = index > 0 && contactsState !== 'syncing' && !voiceBusy;

  return (
    <View style={{ flex: 1, backgroundColor: cl.ground }}>
      <ClassicalGround />
      <Screen padded={false} background="transparent">
        <View pointerEvents={saving ? 'none' : 'auto'} accessibilityState={{ busy: saving }}
          style={{
            flex: 1,
            width: '100%',
            maxWidth: 460,
            alignSelf: 'center',
            paddingHorizontal: clLayout.textGutter,
            paddingBottom: spacing.md,
          }}
        >
          <Progress
            index={index}
            total={STEPS.length}
            canGoBack={canGoBack}
            onBack={back}
            reduceMotion={reduceMotion}
          />

          <View style={{ flex: 1, justifyContent: 'center', paddingVertical: spacing.lg }}>
            {!hydrated ? null : (
              <>
                {step === 'name' ? (
                  <FieldStep
                    icon={UserRound}
                    kicker="Your name"
                    title="What should Amber call you?"
                    blurb="Your first name when it talks to you, your full name when it introduces you to someone."
                    value={name}
                    onChangeValue={setName}
                    onSubmit={onNameContinue}
                    placeholder="Your full name"
                    textContentType="name"
                    autoCapitalize="words"
                  />
                ) : null}

                {step === 'privacy' ? (
                  <PrivacyStep value={privacyTier} onChange={setPrivacyTier} />
                ) : null}

                {step === 'phone' ? (
                  phoneFromSession ? (
                    <ConfirmStep
                      icon={Phone}
                      kicker="Your number"
                      title="This is the number you signed in with."
                      blurb="Amber uses it to match you with people who already have you in their contacts."
                      value={formatPhone(phone)}
                    />
                  ) : (
                    <FieldStep
                      icon={Phone}
                      kicker="Your number"
                      title="What's your phone number?"
                      blurb="Amber uses it to match you with people who already have you in their contacts."
                      value={phone}
                      onChangeValue={setPhone}
                      onSubmit={onPhoneContinue}
                      placeholder="+1 555 000 1234"
                      keyboardType="phone-pad"
                      textContentType="telephoneNumber"
                    />
                  )
                ) : null}

                {step === 'city' ? (
                  <FieldStep
                    icon={MapPin}
                    kicker="Where you are"
                    title="What city are you in?"
                    blurb="It helps Amber tell two people with the same name apart, and know who is nearby."
                    value={city}
                    onChangeValue={setCity}
                    onSubmit={onCityContinue}
                    placeholder="San Francisco"
                    textContentType="addressCity"
                    autoCapitalize="words"
                  />
                ) : null}

                {(step === 'family' || step === 'nearby' || step === 'priorities') && <OnboardingVoiceStep key={step} prompt={step} sample={isPreview} onNext={advance} onBusy={setVoiceBusy} />}
                {step === 'permissions' && <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 12 }}><ApplePermissions demo={isPreview} /></ScrollView>}
                {step === 'contacts' ? (
                  <ContactsStep
                    state={contactsState}
                    done={contactsDone}
                    progress={syncProgress}
                    syncedCount={syncedCount}
                    note={contactsNote}
                    reduceMotion={reduceMotion}
                  />
                ) : null}

              </>
            )}
          </View>

          {hydrated ? (
            <Footer
              step={step}
              contactsState={contactsState}
              contactsDone={contactsDone}
              nameValid={name.trim().length > 0}
              phoneValid={phone.trim().length >= 7}
              phoneFromSession={phoneFromSession}
              onName={onNameContinue}
              onPrivacy={onPrivacyContinue}
              onPhone={onPhoneContinue}
              onCity={onCityContinue}
              onSkipCity={advance}
              onSyncContacts={() => void syncContacts()}
              onSkipContacts={() => {
                track('onboarding_contacts_skipped');
                advance();
              }}
              onContactsContinue={advance}
            />
          ) : null}
        </View>
      </Screen>
    </View>
  );
}

// --- Chrome ------------------------------------------------------------------

// The progress bar reads `Step n of <total>` (driven by STEPS.length), and its
// fill is (n / total) so the last step shows a full bar — the flow really does
// end there.
function Progress({
  index,
  total,
  canGoBack,
  onBack,
  reduceMotion,
}: {
  index: number;
  total: number;
  canGoBack: boolean;
  onBack: () => void;
  reduceMotion: boolean;
}) {
  const target = (index + 1) / total;
  const fill = useSharedValue(target);

  useEffect(() => {
    fill.value = reduceMotion ? target : withTiming(target, { duration: 320 });
  }, [target, reduceMotion, fill]);

  const barStyle = useAnimatedStyle(() => ({ width: `${Math.max(fill.value, 0.02) * 100}%` }));

  return (
    <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
        {canGoBack ? (
          <CPressable
            onPress={onBack}
            accessibilityLabel="Go back"
            outer={{ width: 44, height: 44 }}
            inner={{
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(255,255,255,0.62)',
              borderWidth: HAIRLINE,
              borderColor: cl.cardHairline,
            }}
          >
            <ArrowLeft color={cl.ink55} size={20} strokeWidth={1.8} />
          </CPressable>
        ) : (
          <View style={{ width: 44, height: 44 }} />
        )}
        <View style={{ flex: 1 }} />
        <CText t="metaSm" color={cl.ink48}>
          {`Step ${index + 1} of ${total}`}
        </CText>
      </View>

      <View
        style={{
          height: 4,
          borderRadius: 2,
          backgroundColor: cl.ruleFaint,
          overflow: 'hidden',
        }}
      >
        <Animated.View
          style={[{ height: 4, borderRadius: 2, backgroundColor: cl.gold }, barStyle]}
        />
      </View>
    </View>
  );
}

// The step's mark: the same gold-on-tint icon square the rest of the app uses,
// one size up.
function StepIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <View
      style={{
        width: 52,
        height: 52,
        borderRadius: clRadius.iconSqLg,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: cl.tint100,
        borderWidth: HAIRLINE,
        borderColor: cl.gold40,
      }}
    >
      <Icon size={24} color={cl.goldKicker} strokeWidth={1.7} />
    </View>
  );
}

function StepHead({
  icon,
  kicker,
  title,
  blurb,
}: {
  icon: LucideIcon;
  kicker: string;
  title: string;
  blurb: string;
}) {
  return (
    <View style={{ gap: 16 }}>
      <StepIcon icon={icon} />
      <View style={{ gap: 8 }}>
        <CText t="kicker">{kicker}</CText>
        <CText t="screenTitle" style={{ fontSize: 28, lineHeight: 34 }}>
          {title}
        </CText>
        <CText t="quote" color={cl.ink55}>
          {blurb}
        </CText>
      </View>
    </View>
  );
}

// --- Steps -------------------------------------------------------------------

function FieldStep({
  icon,
  kicker,
  title,
  blurb,
  value,
  onChangeValue,
  onSubmit,
  placeholder,
  keyboardType,
  textContentType,
  autoCapitalize,
}: {
  icon: LucideIcon;
  kicker: string;
  title: string;
  blurb: string;
  value: string;
  onChangeValue: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  keyboardType?: 'phone-pad';
  // Narrowed to the three hints this flow actually asks for, so iOS offers the
  // right autofill (the user's own name, number and city) instead of guessing
  // from the placeholder.
  textContentType?: 'name' | 'telephoneNumber' | 'addressCity';
  autoCapitalize?: 'words';
}) {
  return (
    <View style={{ gap: 28 }}>
      <StepHead icon={icon} kicker={kicker} title={title} blurb={blurb} />
      {/* The app's shared field, styled exactly as the sign-in screen styles it —
          onboarding follows sign-in, so the two must not look like two apps. */}
      <TextInput
        value={value}
        onChangeText={onChangeValue}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        keyboardType={keyboardType}
        textContentType={textContentType}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        autoCorrect={false}
        autoFocus
        returnKeyType="next"
        style={{ backgroundColor: cl.card, color: cl.ink, borderColor: cl.ruleFaint }}
      />
    </View>
  );
}

// The phone number we already hold from sign-in: shown to confirm, not to retype.
function ConfirmStep({
  icon,
  kicker,
  title,
  blurb,
  value,
}: {
  icon: LucideIcon;
  kicker: string;
  title: string;
  blurb: string;
  value: string;
}) {
  return (
    <View style={{ gap: 28 }}>
      <StepHead icon={icon} kicker={kicker} title={title} blurb={blurb} />
      <CCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Check size={20} color={cl.goldDeep} strokeWidth={2.2} />
          <CText t="cardName" style={{ flex: 1 }}>
            {value}
          </CText>
        </View>
      </CCard>
    </View>
  );
}

function ContactsStep({
  state,
  done,
  progress,
  syncedCount,
  note,
  reduceMotion,
}: {
  state: 'idle' | 'syncing';
  done: boolean;
  progress: SyncProgress | null;
  syncedCount: number;
  note: string | null;
  reduceMotion: boolean;
}) {
  if (state === 'syncing') {
    return <SyncingView progress={progress} reduceMotion={reduceMotion} />;
  }

  if (done) {
    return (
      <View style={{ gap: 16 }}>
        <StepIcon icon={Check} />
        <View style={{ gap: 8 }}>
          <CText t="kicker">Your people</CText>
          <CText t="screenTitle" style={{ fontSize: 28, lineHeight: 34 }}>
            {syncedCount > 0
              ? `${formatCount(syncedCount)} ${syncedCount === 1 ? 'contact' : 'contacts'} in`
              : 'Contacts ready'}
          </CText>
          <CText t="quote" color={cl.ink55}>
            {note ?? 'Amber can already see who is in your network.'}
          </CText>
        </View>
      </View>
    );
  }

  return (
    <StepHead
      icon={BookUser}
      kicker="Your people"
      title="Sync your Apple contacts"
      blurb="Your selected contacts, including their details and notes, are stored privately in Amber ID so you can find and remember your people. Nothing is posted or sent to your contacts."
    />
  );
}

function SyncingView({
  progress,
  reduceMotion,
}: {
  progress: SyncProgress | null;
  reduceMotion: boolean;
}) {
  const total = progress?.total ?? 0;
  const synced = progress?.synced ?? 0;
  const target = total > 0 ? synced / total : 0;
  const fill = useSharedValue(0);

  useEffect(() => {
    fill.value = reduceMotion ? target : withTiming(target, { duration: 280 });
  }, [target, reduceMotion, fill]);

  const barStyle = useAnimatedStyle(() => ({ width: `${Math.max(fill.value, 0.02) * 100}%` }));

  return (
    <View style={{ gap: 24 }}>
      <StepIcon icon={BookUser} />
      <View style={{ gap: 8 }}>
        <CText t="screenTitle" style={{ fontSize: 28, lineHeight: 34 }}>
          Syncing your network
        </CText>
        <CText t="quote" color={cl.ink55}>
          {total > 0
            ? `Synced ${formatCount(synced)} of ${formatCount(total)} contacts`
            : 'Reading your contacts'}
        </CText>
      </View>
      <View
        style={{ height: 6, borderRadius: 3, backgroundColor: cl.ruleFaint, overflow: 'hidden' }}
      >
        <Animated.View
          style={[{ height: 6, borderRadius: 3, backgroundColor: cl.gold }, barStyle]}
        />
      </View>
    </View>
  );
}

// Public vs private, on the same classical design as every other step: a
// StepHead, then two selectable option cards. The selected one takes the gold
// border, gold-tinted icon well, and a check — mirroring the profile screen's
// privacy rows so the two settings read as the same control.
function PrivacyStep({
  value,
  onChange,
}: {
  value: PrivacyTierValue;
  onChange: (v: PrivacyTierValue) => void;
}) {
  return (
    <View style={{ gap: 28 }}>
      <StepHead
        icon={ShieldCheck}
        kicker="Your privacy"
        title="Public or private?"
        blurb="Public lets other people on Amber find you and view your profile. Private keeps it to yourself — only you can see it. You can change this anytime."
      />
      <View style={{ gap: spacing.sm }}>
        <PrivacyOption
          icon={Globe}
          label="Public"
          blurb="Others can find you and see your name, role and city."
          selected={value === 'full_social'}
          onSelect={() => onChange('full_social')}
        />
        <PrivacyOption
          icon={Lock}
          label="Private"
          blurb="Your profile is private. Account data is stored by Amber."
          selected={value === 'local_only'}
          onSelect={() => onChange('local_only')}
        />
      </View>
    </View>
  );
}

function PrivacyOption({
  icon: Icon,
  label,
  blurb,
  selected,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  blurb: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <CPressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}. ${blurb}`}
      outer={{ alignSelf: 'stretch' }}
      inner={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.base,
        paddingHorizontal: clLayout.cardPadX,
        paddingVertical: clLayout.cardPadY,
        borderRadius: clRadius.card,
        borderWidth: selected ? 1 : HAIRLINE,
        borderColor: selected ? cl.gold55 : cl.cardHairline,
        backgroundColor: cl.card,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: selected ? cl.tint100 : '#F4F2EF',
          borderWidth: HAIRLINE,
          borderColor: selected ? cl.gold40 : cl.ruleFaint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={19} color={selected ? cl.goldDeep : cl.ink50} strokeWidth={1.7} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <CText t="listTitle">{label}</CText>
        <CText t="metaSm" color={cl.ink48}>
          {blurb}
        </CText>
      </View>
      <View style={{ width: 24, alignItems: 'center' }}>
        {selected ? <Check size={20} color={cl.goldDeep} strokeWidth={2.2} /> : null}
      </View>
    </CPressable>
  );
}

// --- Footer ------------------------------------------------------------------

function Footer(props: {
  step: StepId;
  contactsState: 'idle' | 'syncing';
  contactsDone: boolean;
  nameValid: boolean;
  phoneValid: boolean;
  phoneFromSession: boolean;
  onName: () => void;
  onPrivacy: () => void;
  onPhone: () => void;
  onCity: () => void;
  onSkipCity: () => void;
  onSyncContacts: () => void;
  onSkipContacts: () => void;
  onContactsContinue: () => void;
}) {
  const { step, contactsState, contactsDone } = props;

  // Nothing to press while the sync runs: the progress bar is the whole screen.
  if (step === 'contacts' && contactsState === 'syncing') {
    return <View style={{ height: 44 }} />;
  }

  return (
    <View style={{ gap: spacing.xs }}>
      {step === 'name' ? (
        <CButton label="Continue" onPress={props.onName} disabled={!props.nameValid} full tone="solid" />
      ) : null}

      {step === 'privacy' ? (
        <CButton label="Continue" onPress={props.onPrivacy} full tone="solid" />
      ) : null}

      {step === 'phone' ? (
        <CButton
          label={props.phoneFromSession ? "That's me" : 'Continue'}
          onPress={props.onPhone}
          disabled={!props.phoneValid}
          full
          tone="solid"
        />
      ) : null}

      {step === 'city' ? (
        <>
          <CButton label="Continue" onPress={props.onCity} full tone="solid" />
          <SkipLink label="Skip for now" onPress={props.onSkipCity} />
        </>
      ) : null}

      {step === 'contacts' && !contactsDone ? (
        <>
          <CButton label="Sync my contacts" onPress={props.onSyncContacts} full tone="solid" />
          <SkipLink label="Skip for now" onPress={props.onSkipContacts} />
        </>
      ) : null}

      {step === 'permissions' && <CButton label="Start using Amber" onPress={props.onContactsContinue} full tone="solid" />}
      {step === 'contacts' && contactsDone ? (
        <CButton label="Continue" onPress={props.onContactsContinue} full tone="solid" />
      ) : null}


    </View>
  );
}

function SkipLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <CPressable
      onPress={onPress}
      accessibilityLabel={label}
      outer={{ alignSelf: 'center' }}
      inner={{ paddingVertical: 12, paddingHorizontal: 18, minHeight: 44, justifyContent: 'center' }}
    >
      <CText t="metaSm" color={cl.ink48}>
        {label}
      </CText>
    </CPressable>
  );
}

// "+15551234567" reads better as "+1 555 123 4567" on a confirmation screen.
// Deliberately light-touch: it only groups the digits of a plain E.164 US-shaped
// number and returns anything else untouched, so an unexpected shape is shown
// as-is rather than mangled.
function formatPhone(raw: string): string {
  const t = raw.trim();
  const m = /^\+(\d)(\d{3})(\d{3})(\d{4})$/.exec(t.replace(/[\s()-]/g, ''));
  return m ? `+${m[1]} ${m[2]} ${m[3]} ${m[4]}` : t;
}
