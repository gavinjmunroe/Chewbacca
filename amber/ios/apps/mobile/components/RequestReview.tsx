import { PlanPeopleChoice } from './PlanPeopleChoice';
import { MemoPlanChoice } from './MemoPlanChoice';
import { MemoImpact } from './MemoImpact';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  AudioLines,
  CalendarDays,
  Check,
  ContactRound,
  Plus,
  Sparkles,
  X,
} from 'lucide-react-native';
import { requestStyles as s } from './MemoStyles';
import { ComputerMark } from './ComputerMark';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import { proposeMemoActions } from '../lib/proposeMemoActions';
import {
  parseMemoActions,
  actionKey,
  blankMemoAction,
  validMemoAction,
  type MemoEntry,
  type MemoReceipt,
  type ReviewRequest,
} from '../lib/memoActions';
import { transcribeVoice } from '../lib/voiceTranscribe';
import { File } from 'expo-file-system';
import { GoogleCalendarDestination } from './GoogleCalendarDestination';
import { cl } from '../lib/classical';
export type { MemoEntry, ReviewRequest } from '../lib/memoActions';
export { requestStyles } from './MemoStyles';
type Draft = {
  id: number;
  request: ReviewRequest;
  status: 'ready' | 'saving' | 'saved' | 'error';
  message?: string;
};
export type MemoActionsHandle = { addAction: (kind: ReviewRequest['kind']) => void };
export function RequestReview({
  actionRef,
  prepared,
  autoPrepare = true,
  visible,
  embedded = false,
  inline = false,
  showActions = !inline,
  onProcessingChange,
  initialText = '',
  media,
  source,
  contacts,
  sample = false,
  receipts = [],
  onBusyChange,
  onTextChange,
  onClose,
  onConfirm,
}: {
  prepared?: import('../lib/memoObjects').MemoSorting;
  autoPrepare?: boolean;
  actionRef?: Ref<MemoActionsHandle>;
  visible: boolean;
  embedded?: boolean;
  inline?: boolean;
  showActions?: boolean;
  onProcessingChange?: (processing: boolean) => void;
  initialText?: string;
  media?: MemoEntry['media'];
  source?: MemoEntry['source'];
  contacts: { id: string; name: string; detail?: string }[];
  sample?: boolean;
  receipts?: MemoReceipt[];
  onBusyChange?: (busy: boolean) => void;
  onTextChange?: (text: string) => void;
  onClose: () => void;
  onConfirm: (request: ReviewRequest) => Promise<string>;
}) {
  const [text, setText] = useState(initialText);
  const [contactQuery, setContactQuery] = useState('');
  const contactMatches = useMemo(
    () =>
      contacts
        .filter(
          (c) =>
            !!contactQuery.trim() &&
            `${c.name} ${c.detail || ''}`
              .toLocaleLowerCase()
              .includes(contactQuery.trim().toLocaleLowerCase()),
        )
        .slice(0, 30),
    [contacts, contactQuery],
  );
  const changeText = (value: string) => {
    setText(value);
    onTextChange?.(value);
  };
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processingError, setProcessingError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const sequence = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const savedKeys = useRef(new Set(receipts.map(actionKey)));
  const initial = useRef({ text: initialText, contacts, sample, receipts, autoPrepare });
  const preparedText = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!prepared || prepared.text !== text || preparedText.current === text || drafts.length)
      return;
    preparedText.current = text;
    const additions = parseMemoActions(
      JSON.stringify({ actions: prepared.actions }),
      contacts.map((c) => c.id),
    )
      .filter((p) => !savedKeys.current.has(actionKey(p)))
      .map((request) => ({ id: ++sequence.current, request, status: 'ready' as const }));
    setDrafts(additions);
    setSelected(additions[0]?.id ?? null);
  }, [prepared, text, contacts, drafts.length]);
  const active = drafts.find((d) => d.id === selected);
  const request = active?.request;
  const add = useCallback(
    (kind: ReviewRequest['kind']) => {
      const id = ++sequence.current;
      setDrafts((old) => [...old, { id, request: blankMemoAction(text, kind), status: 'ready' }]);
      setSelected(id);
    },
    [text],
  );
  useImperativeHandle(
    actionRef,
    () => ({
      addAction: (kind) => {
        if (!busy && !processing) add(kind);
      },
    }),
    [add, busy, processing],
  );
  const patch = (value: Partial<ReviewRequest>) =>
    setDrafts((old) =>
      old.map((d) =>
        d.id === selected && d.status !== 'saved'
          ? { ...d, request: { ...d.request, ...value }, status: 'ready', message: undefined }
          : d,
      ),
    );
  const prepare = useCallback(async (value: string, available: { id: string; name: string }[]) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setProcessing(true);
    setProcessingError('');
    try {
      const proposals = await proposeMemoActions(value, available, controller.signal);
      if (controller.signal.aborted) return;
      const additions = proposals
        .filter((p) => !savedKeys.current.has(actionKey(p)))
        .map((p) => ({ id: ++sequence.current, request: p, status: 'ready' as const }));
      setDrafts((old) => [...old.filter((d) => d.status === 'saved'), ...additions]);
      setSelected(additions[0]?.id ?? null);
      if (!additions.length)
        setProcessingError(
          'No new actions could be prepared confidently. Add a person or plan below.',
        );
    } catch {
      if (!controller.signal.aborted)
        setProcessingError(
          'Could not prepare suggestions. Your note is still here; retry or add an action yourself.',
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setProcessing(false);
      }
    }
  }, []);
  useEffect(() => {
    const start = initial.current;
    if (start.autoPrepare && !start.sample && start.text.trim() && !start.receipts.length)
      void prepare(start.text, start.contacts);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [prepare]);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    onProcessingChange?.(processing);
    return () => onProcessingChange?.(false);
  }, [processing, onProcessingChange]);
  async function retryTranscription() {
    if (!media || busy || processing || lock.current) return;
    lock.current = true;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setProcessingError('');
    try {
      const audio = await new File(media.uri).base64();
      const response = await transcribeVoice(audio, 'audio/m4a', controller.signal);
      if (controller.signal.aborted) return;
      if (!response.ok || !response.data.transcript.trim()) throw Error('No transcript');
      const value = response.data.transcript.trim();
      changeText(value);
      void prepare(value, contacts);
    } catch {
      if (!controller.signal.aborted)
        setProcessingError(
          'Transcription is unavailable. Your audio is safe; retry or type the transcript below.',
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function confirm() {
    if (
      !active ||
      (!sample &&
        active.request.kind === 'calendar' &&
        (!active.request.planChoice ||
          (!active.request.planId && !active.request.googleAccountId))) ||
      !validMemoAction(
        active.request,
        contacts.map((c) => c.id),
      ) ||
      lock.current ||
      active.status === 'saved'
    )
      return;
    const key = actionKey(active.request);
    if (savedKeys.current.has(key)) {
      setDrafts((old) =>
        old.map((d) =>
          d.id === active.id
            ? { ...d, status: 'saved', message: 'This exact action was already saved.' }
            : d,
        ),
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setDrafts((old) =>
      old.map((d) => (d.id === active.id ? { ...d, status: 'saving', message: undefined } : d)),
    );
    try {
      const message = await onConfirm(active.request);
      savedKeys.current.add(key);
      setDrafts((old) =>
        old.map((d) => (d.id === active.id ? { ...d, status: 'saved', message } : d)),
      );
    } catch (error) {
      setDrafts((old) =>
        old.map((d) =>
          d.id === active.id
            ? {
                ...d,
                status: 'error',
                message:
                  error instanceof Error && error.name === 'CalendarWriteError'
                    ? error.message
                    : 'Save was not confirmed. This draft is still here. Check the destination before retrying.',
              }
            : d,
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const body = (
    <>
      {source && !inline && (
        <View style={s.notice}>
          <View style={{ flex: 1, gap: 8 }}>
            <Text style={s.label}>YOUR ATTACHMENT</Text>
            <Text style={s.body}>{source.name}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void Share.share({ url: source.uri }).catch(() => {})}
            >
              <Text style={s.hint}>Open original · saved on this device</Text>
            </Pressable>
          </View>
        </View>
      )}
      {media && !inline && (
        <View style={s.notice}>
          <View style={{ flex: 1, gap: 10 }}>
            <Text style={s.label}>YOUR RECORDING</Text>
            <VoiceNotePlayer
              durationMs={media.durationMs}
              peaks={media.peaks}
              fetchAudio={async () => ({ playbackUrl: media.uri })}
            />
          </View>
        </View>
      )}
      <Text style={s.hint}>
        {sample
          ? 'Local preview · add a transcript to prepare actions. Nothing is sent to a service.'
          : 'People and plans from your memo. Confirm the details you want to save.'}
      </Text>
      {!sample && media && !text.trim() && (
        <Pressable
          style={s.row}
          disabled={busy || processing}
          accessibilityRole="button"
          onPress={() => void retryTranscription()}
        >
          <Text style={s.body}>
            {busy ? 'Transcribing your saved audio…' : 'Retry transcription'}
          </Text>
          {busy && <ActivityIndicator color={cl.goldDeep} />}
        </Pressable>
      )}
      {!inline && (
        <TextInput
          multiline
          maxLength={32000}
          editable={!busy && !processing}
          accessibilityLabel="Memo transcript"
          placeholder="Add or correct your transcript…"
          placeholderTextColor={cl.ink55}
          value={text}
          onChangeText={changeText}
          style={s.transcript}
        />
      )}
      {sample && (
        <Pressable
          disabled={busy || processing}
          accessibilityRole="button"
          onPress={() =>
            changeText(
              'Maya prefers morning catch-ups. Plan coffee together, then prepare a short agenda.',
            )
          }
          style={s.row}
        >
          <Text style={s.hint}>Use an example memo</Text>
        </Pressable>
      )}
      {!sample && (!inline || !drafts.length) && (
        <Pressable
          disabled={busy || processing || !text.trim()}
          accessibilityRole="button"
          onPress={() => void prepare(text, contacts)}
          style={s.row}
        >
          <Sparkles color={cl.goldDeep} size={20} />
          <Text style={s.body}>
            {processing ? 'Preparing action drafts…' : 'Find people & plans'}
          </Text>
        </Pressable>
      )}
      {processing && (
        <ActivityIndicator accessibilityLabel="Preparing memo actions" color={cl.goldDeep} />
      )}
      {!!processingError && (
        <Text accessibilityRole="alert" style={s.hint}>
          {processingError}
        </Text>
      )}
      {(receipts.length > 0 || drafts.some((draft) => draft.status === 'saved')) && (
        <MemoImpact
          sample={sample}
          community={
            receipts.some((r) => r.kind === 'contact') ||
            drafts.some((d) => d.status === 'saved' && d.request.kind === 'contact')
          }
          calendar={
            receipts.some((r) => r.kind === 'calendar') ||
            drafts.some((d) => d.status === 'saved' && d.request.kind === 'calendar')
          }
        />
      )}
      {receipts.map((receipt, i) => (
        <View key={i} style={s.notice}>
          <Check color={cl.goldDeep} />
          <Text style={s.body}>{receipt.result}</Text>
        </View>
      ))}
      {(inline && drafts.length === 1 && active?.status !== 'saved' ? [] : drafts).map((draft) => (
        <Pressable
          key={draft.id}
          disabled={busy || processing}
          accessibilityRole="button"
          accessibilityState={{ selected: selected === draft.id }}
          onPress={() => setSelected(draft.id)}
          style={[
            s.notice,
            {
              borderWidth: 1,
              borderColor: selected === draft.id ? cl.goldDeep : cl.cardHairline,
            },
          ]}
        >
          {draft.status === 'saved' ? (
            <Check color={cl.goldDeep} />
          ) : draft.request.kind === 'contact' ? (
            <ContactRound color={cl.goldDeep} />
          ) : draft.request.kind === 'calendar' ? (
            <CalendarDays color={cl.goldDeep} />
          ) : (
            <ComputerMark color={cl.goldDeep} />
          )}
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.body}>
              {draft.request.kind === 'contact'
                ? contacts.find((c) => c.id === draft.request.contactId)?.name ||
                  draft.request.personName ||
                  'Person update'
                : draft.request.kind === 'calendar'
                  ? draft.request.title || 'Plan'
                  : 'Ask Amber'}
            </Text>
            <Text style={s.hint}>
              {draft.status === 'saved'
                ? draft.message
                : draft.request.text || 'Add the details below'}
            </Text>
          </View>
        </Pressable>
      ))}
      {showActions && (
        <>
          <Text style={s.label}>ADD AN ACTION</Text>
          <View style={s.destinations}>
            {(
              [
                { key: 'contact', label: 'Person', Icon: ContactRound },
                { key: 'calendar', label: 'Plan', Icon: CalendarDays },
              ] as const
            ).map(({ key, label, Icon }) => (
              <Pressable
                key={key}
                disabled={busy || processing}
                accessibilityRole="button"
                accessibilityLabel={`Add ${label.toLowerCase()} action`}
                onPress={() => add(key)}
                style={s.destination}
              >
                <Icon color={cl.goldDeep} size={23} />
                <Text style={s.body}>{label}</Text>
                <Plus color={cl.ink62} size={14} />
              </Pressable>
            ))}
          </View>
        </>
      )}
      {request && active?.status !== 'saved' && (
        <View style={{ gap: 12 }}>
          <Text style={s.label}>ACTION DETAILS</Text>
          <TextInput
            multiline
            editable={!busy && !processing}
            maxLength={32000}
            accessibilityLabel="Action text"
            value={request.text}
            onChangeText={(value) => patch({ text: value })}
            style={s.input}
          />
          {request.kind === 'contact' && (
            <>
              <Text style={s.hint}>
                Who should this update? Choose an existing person or add someone new.
              </Text>
              {!!request.contactId && (
                <Text style={s.body}>{contacts.find((c) => c.id === request.contactId)?.name}</Text>
              )}
              <TextInput
                value={contactQuery}
                onChangeText={setContactQuery}
                placeholder="Search your contacts"
                accessibilityLabel="Find contact for this action"
                style={s.input}
              />
              {contactMatches.map((contact) => (
                <Pressable
                  disabled={busy || processing}
                  key={contact.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: request.contactId === contact.id }}
                  onPress={() => patch({ contactId: contact.id, newPerson: false })}
                  style={s.row}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.body}>{contact.name}</Text>
                    {!!contact.detail && <Text style={s.hint}>{contact.detail}</Text>}
                  </View>
                  {request.contactId === contact.id && <Check color={cl.goldDeep} size={20} />}
                </Pressable>
              ))}
              <Pressable
                disabled={busy || processing}
                accessibilityRole="button"
                onPress={() => patch({ newPerson: !request.newPerson, contactId: '' })}
                style={s.row}
              >
                <Text style={s.body}>
                  {request.newPerson ? 'Choose an existing person instead' : 'Add a new person'}
                </Text>
              </Pressable>
              {request.newPerson && (
                <>
                  <TextInput
                    accessibilityLabel="Full name"
                    placeholder="Full name"
                    value={request.personName}
                    onChangeText={(personName) => patch({ personName })}
                    style={s.input}
                  />
                  <Text style={s.hint}>
                    Add an email or phone number so Amber can match the right person.
                  </Text>
                  <TextInput
                    accessibilityLabel="Email"
                    placeholder="Email"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={request.personEmail}
                    onChangeText={(personEmail) => patch({ personEmail })}
                    style={s.input}
                  />
                  <TextInput
                    accessibilityLabel="Phone number"
                    placeholder="Phone number"
                    keyboardType="phone-pad"
                    value={request.personPhone}
                    onChangeText={(personPhone) => patch({ personPhone })}
                    style={s.input}
                  />
                </>
              )}
              {!contacts.length && !request.newPerson && (
                <Text style={s.hint}>Connect contacts first. Your memo stays here.</Text>
              )}
            </>
          )}
          {request.kind === 'calendar' && (
            <>
              <PlanPeopleChoice
                contacts={contacts}
                selected={request.participantIds || []}
                onChange={(participantIds) => patch({ participantIds })}
                disabled={busy || processing}
              />
              <MemoPlanChoice
                key={active.id}
                request={request}
                onChange={patch}
                disabled={busy || processing}
                sample={sample}
              />
              <TextInput
                editable={!busy && !processing}
                value={request.title}
                onChangeText={(value) => patch({ title: value })}
                placeholder="Event title"
                accessibilityLabel="Event title"
                style={s.input}
              />
              {!sample && !request.planId && (
                <GoogleCalendarDestination
                  value={request.googleAccountId}
                  onChange={(googleAccountId) => patch({ googleAccountId })}
                  disabled={busy || processing}
                />
              )}
              {request.needsTiming && (
                <Text style={s.hint}>
                  When is this plan? These times are suggestions until you confirm.
                </Text>
              )}
              <Text style={s.label}>START</Text>
              <DateTimePicker
                disabled={busy || processing}
                value={request.startsAt}
                mode="datetime"
                onChange={(_, date) => {
                  if (date) patch({ startsAt: date });
                }}
              />
              <Text style={s.label}>END</Text>
              <DateTimePicker
                disabled={busy || processing}
                value={request.endsAt}
                mode="datetime"
                onChange={(_, date) => {
                  if (date) patch({ endsAt: date });
                }}
              />
              {request.needsTiming && (
                <Pressable
                  accessibilityRole="button"
                  disabled={request.endsAt <= request.startsAt}
                  style={s.row}
                  onPress={() => patch({ needsTiming: false })}
                >
                  <Text style={s.body}>Use these times</Text>
                </Pressable>
              )}
              {request.endsAt <= request.startsAt && (
                <Text style={s.hint}>Choose an end after the start.</Text>
              )}
            </>
          )}
          {request.kind !== 'task' && (
            <View style={{ gap: 8 }}>
              <Text style={s.label}>PLACE</Text>
              <TextInput
                accessibilityLabel="Place context"
                placeholder="Where? A place, city or online"
                value={request.place || ''}
                editable={!busy && !processing}
                maxLength={200}
                onChangeText={(place) => patch({ place, placeConfirmed: !!place.trim() })}
                style={s.input}
              />
              {!request.place?.trim() && (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy || processing}
                  style={s.row}
                  onPress={() => patch({ placeConfirmed: true })}
                >
                  <Text style={s.hint}>
                    {request.placeConfirmed ? 'Place left open' : 'Not decided / not relevant'}
                  </Text>
                </Pressable>
              )}
            </View>
          )}
          {request.kind === 'task' && (
            <Text style={s.hint}>
              Ask Amber to research or draft a response. Sending messages and computer actions are
              not connected yet.
            </Text>
          )}
          {active?.message && (
            <Text accessibilityRole="alert" style={s.body}>
              {active.message}
            </Text>
          )}
        </View>
      )}
    </>
  );
  const content = (
    <>
      {!inline && (
        <View style={s.heading}>
          <AudioLines color={cl.goldDeep} size={27} />
          <Text style={s.title}>{processing ? 'Finding the next steps' : 'Your memo'}</Text>
          <Pressable
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Close memo"
            onPress={onClose}
            style={s.close}
          >
            <X color={cl.ink} />
          </Pressable>
        </View>
      )}
      {inline ? (
        <View style={{ gap: 16 }}>{body}</View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
          {body}
        </ScrollView>
      )}

      <View style={{ padding: 16, paddingTop: 8 }}>
        {active && active.status !== 'saved' ? (
          <Pressable
            disabled={
              busy ||
              processing ||
              (!sample &&
                active.request.kind === 'calendar' &&
                (!active.request.planChoice ||
                  (!active.request.planId && !active.request.googleAccountId))) ||
              !validMemoAction(
                active.request,
                contacts.map((c) => c.id),
              )
            }
            accessibilityRole="button"
            onPress={() => void confirm()}
            style={[
              s.confirm,
              (busy ||
                processing ||
                (!sample &&
                  active.request.kind === 'calendar' &&
                  (!active.request.planChoice ||
                    (!active.request.planId && !active.request.googleAccountId))) ||
                !validMemoAction(
                  active.request,
                  contacts.map((c) => c.id),
                )) && { opacity: 0.4 },
            ]}
          >
            <Text style={s.confirmText}>
              {busy
                ? 'Saving action…'
                : sample
                  ? 'Confirm in preview'
                  : active.request.kind === 'task'
                    ? 'Ask Amber'
                    : active.request.kind === 'calendar'
                      ? active.request.planId
                        ? 'Update this plan'
                        : 'Add to Google Calendar'
                      : 'Save to person'}
            </Text>
          </Pressable>
        ) : !inline ? (
          <Pressable disabled={busy} accessibilityRole="button" onPress={onClose} style={s.confirm}>
            <Text style={s.confirmText}>Done</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
  if (embedded) return content;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <KeyboardAvoidingView
        style={s.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.glow}>
          <View style={s.sheet} accessibilityViewIsModal>
            {content}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
