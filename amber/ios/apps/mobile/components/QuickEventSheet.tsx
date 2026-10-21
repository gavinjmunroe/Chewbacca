import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { X, Video } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { createGoogleMemoEvent } from '../lib/googleCalendarWrite';
import { GoogleCalendarDestination } from './GoogleCalendarDestination';
import { memoActionId } from '../lib/memoActionId';
import { randomUUID } from 'expo-crypto';
import { GlassSurface } from './LiquidGlass';
import { requestStyles as s } from './MemoStyles';
import { cl } from '../lib/classical';
export type QuickEvent = { title: string; startsAt: string; endsAt: string; link?: string };
export function QuickEventSheet({
  day,
  sample,
  onClose,
  onSaved,
}: {
  day: Date;
  sample: boolean;
  onClose: () => void;
  onSaved: (event: QuickEvent) => void;
}) {
  const [googleAccountId, setGoogleAccountId] = useState('');
  const [draftId] = useState(() => randomUUID());
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(() => {
    const date = new Date(day);
    date.setHours(new Date().getHours() + 1, 0, 0, 0);
    return date;
  });
  const [link, setLink] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const validLink = (() => {
    if (!link.trim()) return true;
    try {
      const url = new URL(link.trim());
      return (
        url.protocol === 'https:' &&
        url.hostname === 'facetime.apple.com' &&
        url.pathname.length > 1
      );
    } catch {
      return false;
    }
  })();
  async function save() {
    if (lock.current || !title.trim() || !validLink || (!sample && !googleAccountId)) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const event = {
      title: title.trim(),
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + minutes * 60000).toISOString(),
      link: link.trim(),
    };
    try {
      if (!sample) {
        const request = {
          kind: 'calendar' as const,
          contactId: '',
          googleAccountId,
          title: event.title,
          text: event.link ? `FaceTime: ${event.link}` : '',
          startsAt: start,
          endsAt: new Date(event.endsAt),
        };
        const result = await createGoogleMemoEvent(request, await memoActionId(draftId, request));
        if (!result.data.ok || result.data.destination !== 'google') throw new Error();
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSaved(event);
      onClose();
    } catch (error) {
      setError(
        error instanceof Error && error.name === 'CalendarWriteError'
          ? error.message
          : 'Could not confirm the save. Retry this unchanged draft safely.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.backdrop}
      >
        <GlassSurface
          style={{ maxHeight: '90%', borderRadius: 32, overflow: 'hidden' }}
          fallbackStyle={{ backgroundColor: cl.card }}
        >
          <View style={s.heading}>
            <Text style={s.title}>Make a plan</Text>
            <Pressable
              disabled={busy}
              onPress={onClose}
              accessibilityLabel="Close new event"
              style={s.close}
            >
              <X color={cl.ink} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
            <Text style={s.hint}>
              {sample ? 'Preview event · saved in this session only' : 'Save to Google Calendar'}
            </Text>
            <TextInput
              accessibilityLabel="Event title"
              placeholder="What’s the plan?"
              value={title}
              onChangeText={setTitle}
              editable={!busy}
              maxLength={200}
              style={s.input}
            />
            {!sample && (
              <GoogleCalendarDestination
                value={googleAccountId}
                onChange={setGoogleAccountId}
                disabled={busy}
              />
            )}
            <Text style={s.label}>WHEN</Text>
            <DateTimePicker
              disabled={busy}
              value={start}
              mode="datetime"
              onChange={(_, date) => {
                if (date) setStart(date);
              }}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[15, 30, 60].map((value) => (
                <Pressable
                  key={value}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ selected: minutes === value }}
                  onPress={() => setMinutes(value)}
                  style={[s.destination, minutes === value && s.selected]}
                >
                  <Text style={s.body}>{value} min</Text>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Video color={cl.goldDeep} size={20} />
              <Text style={s.body}>FaceTime · optional</Text>
            </View>
            <TextInput
              accessibilityLabel="FaceTime link"
              placeholder="Paste a FaceTime link"
              value={link}
              onChangeText={setLink}
              editable={!busy}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={s.input}
            />
            <Text style={s.hint}>
              Create a link in FaceTime and paste it here. Adding an event does not send
              invitations.
            </Text>
            {!validLink && (
              <Text accessibilityRole="alert" style={s.body}>
                Use a link beginning https://facetime.apple.com/
              </Text>
            )}
            <Pressable
              disabled={busy || !title.trim() || !validLink || (!sample && !googleAccountId)}
              onPress={() => void save()}
              style={[
                s.confirm,
                (!title.trim() || !validLink || busy || (!sample && !googleAccountId)) && {
                  opacity: 0.45,
                },
              ]}
            >
              <Text style={s.confirmText}>
                {busy ? 'Saving…' : sample ? 'Add preview event' : 'Add to Google Calendar'}
              </Text>
            </Pressable>
            {error ? (
              <Text accessibilityRole="alert" style={s.body}>
                {error}
              </Text>
            ) : null}
          </ScrollView>
        </GlassSurface>
      </KeyboardAvoidingView>
    </Modal>
  );
}
