import { listJournalHistory, type JournalCursor } from '../lib/journalHistory';
import { memoRecordedOn } from '../lib/memoQuery';
import { journalSyncLabel } from '../lib/journalSync';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, AudioLines, ChevronRight, FileText, X } from 'lucide-react-native';
import {
  getConversation,
  type ConversationMessage,
  type ConversationDetail,
  type ConversationSummary,
} from '../lib/conversations';
import { getMyMessageAudio } from '../lib/noteMedia';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import { CommunitySearch } from './CommunitySearch';
import { type MemoEntry, requestStyles as s } from './RequestReview';
import { cl } from '../lib/classical';
export function MemoHistory({
  visible,
  day,
  listHeader,
  renderDiscussion,
  initialLocalId,
  initialConversationId,
  embedded = false,
  searchQuery,
  sample = false,
  entries,
  onClose,
  onDismiss,
  onReview,
  onSync,
}: {
  visible: boolean;
  day?: Date;
  listHeader?: ReactNode;
  renderDiscussion?: (entry: MemoEntry) => ReactNode;
  initialLocalId?: string;
  initialConversationId?: string;
  embedded?: boolean;
  searchQuery?: string;
  sample?: boolean;
  entries: MemoEntry[];
  onClose: () => void;
  onDismiss?: () => void;
  onReview?: (entry: MemoEntry) => void;
  onSync?: (entry: MemoEntry) => Promise<void>;
}) {
  const [rows, setRows] = useState<ConversationSummary[]>([]);
  const [recording, setRecording] = useState<ConversationDetail | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [selected, setSelected] = useState<string | null>(initialConversationId ?? null);
  const [localId, setLocalId] = useState<string | null>(initialLocalId ?? null);
  const [ownQuery, setQuery] = useState('');
  const query = searchQuery ?? ownQuery;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [cursor, setCursor] = useState<JournalCursor | null>(null);
  const [nextPage, setNextPage] = useState<JournalCursor | null>(null);
  const dayKey = day?.toDateString();
  useEffect(() => {
    setCursor(null);
    setRows([]);
    setNextPage(null);
    back();
  }, [dayKey]);
  const local = entries.find((entry) => entry.id === localId);
  const detail = !!selected || !!local;
  const original = messages.find((m) => m.role === 'user');
  const messageAudio = messages.find((m) => m.role === 'user' && m.audio);
  let question = 'People & plans for this memo';
  const storedTurns = messages.flatMap((m, index) => {
    if (m.role === 'user') {
      if (index > 0) question = m.content;
      return [];
    }
    if (m.metadata?.capturedOutcomes) return [];
    return [{ question, answer: m.content, peopleIds: m.metadata?.peopleIds ?? [], saved: true }];
  });
  const back = () => {
    setSelected(null);
    setLocalId(null);
    setMessages([]);
    setRecording(null);
  };
  const close = () => {
    back();
    onClose();
  };
  useEffect(() => {
    if (!visible || sample || localId) return;
    let current = true;
    const controller = new AbortController();
    setBusy(true);
    setError('');
    setMessages([]);
    setRecording(null);
    void (async () => {
      try {
        if (selected) {
          const result = await getConversation(selected);
          if (!result.ok) throw new Error();
          if (current) {
            setMessages(result.data.messages);
            setRecording(result.data);
          }
        } else {
          const result = await listJournalHistory({
            day,
            cursor: cursor ?? undefined,
            signal: controller.signal,
          });
          if (!result.ok) throw new Error();
          if (current) {
            setRows((old) =>
              cursor
                ? [
                    ...old,
                    ...result.data.conversations.filter(
                      (row) => !old.some((prev) => prev.conversationId === row.conversationId),
                    ),
                  ]
                : result.data.conversations,
            );
            setNextPage(result.data.next);
          }
        }
      } catch {
        if (current) setError('Could not load recordings. Please try again.');
      } finally {
        if (current) setBusy(false);
      }
    })();
    return () => {
      current = false;
      controller.abort();
    };
  }, [visible, selected, sample, retry, localId, dayKey, day, cursor]);
  useEffect(() => {
    if (searchQuery === undefined) return;
    setSelected(null);
    setLocalId(null);
    setMessages([]);
    setRecording(null);
  }, [searchQuery]);
  const matches = (text: string) => text.toLowerCase().includes(query.trim().toLowerCase());
  const localRows = entries.filter(
    (entry) =>
      !!entry.media &&
      memoRecordedOn(entry.createdAt, day) &&
      matches(`${entry.text} ${entry.destination}`),
  );
  const remoteRows = rows.filter(
    (row) =>
      !entries.some((entry) => entry.cloud?.conversationId === row.conversationId) &&
      matches(`${row.title} ${row.preview || ''}`),
  );
  const content = (
    <View style={{ flex: 1, backgroundColor: cl.ground }}>
      {!embedded && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 24,
            minHeight: 60,
            paddingTop: 4,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Image source={require('../assets/amber-logo.png')} style={{ width: 37, height: 40 }} />
            <Text style={{ fontFamily: 'Newsreader_500Medium', fontSize: 29, color: cl.ink }}>
              amber
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close voice memo history"
            onPress={close}
            style={s.close}
          >
            <X color={cl.ink} />
          </Pressable>
        </View>
      )}
      {(!embedded || detail) && (
        <View style={{ paddingHorizontal: 24, paddingTop: 8, gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {detail && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to voice memories"
                onPress={back}
                style={s.close}
              >
                <ArrowLeft color={cl.ink} />
              </Pressable>
            )}
            <Text
              style={{
                flexShrink: 1,
                fontFamily: 'Newsreader_500Medium',
                fontSize: detail ? 27 : 32,
                lineHeight: detail ? 34 : 40,
                color: cl.ink,
              }}
            >
              {detail ? 'Inside this memo' : 'Voice memo history'}
            </Text>
          </View>
          {!detail && !embedded && (
            <CommunitySearch
              value={query}
              onChange={setQuery}
              placeholder="Search your voice memories"
            />
          )}
        </View>
      )}
      <ScrollView
        key={localId ?? selected ?? 'history'}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 8,
          paddingBottom: 24,
          gap: 20,
        }}
      >
        {!detail && (
          <>
            {listHeader}
            <Text style={s.hint}>
              {sample
                ? 'Your recordings on this device · tap to listen and explore'
                : 'Your saved recordings · tap to listen and explore'}
            </Text>
            {localRows.map((entry) => (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityLabel={`Open memo: ${entry.text || 'Untitled recording'}`}
                onPress={() => {
                  setLocalId(entry.id);
                  setError('');
                }}
                style={[
                  s.notice,
                  {
                    backgroundColor: cl.card,
                    padding: 18,
                    borderWidth: 1,
                    borderColor: cl.cardHairline,
                    borderRadius: 24,
                  },
                ]}
              >
                {entry.media ? (
                  <AudioLines color={cl.goldDeep} />
                ) : (
                  <FileText color={cl.goldDeep} />
                )}
                <View style={{ flex: 1, gap: 6 }}>
                  <Text numberOfLines={2} style={s.body}>
                    {entry.text || 'Untitled recording'}
                  </Text>
                  {entry.media && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View
                        accessible={false}
                        style={{
                          flexDirection: 'row',
                          height: 24,
                          gap: 2,
                          alignItems: 'center',
                          flex: 1,
                        }}
                      >
                        {entry.media.peaks
                          .filter(
                            (_, i) =>
                              i % Math.max(1, Math.ceil(entry.media!.peaks.length / 32)) === 0,
                          )
                          .slice(0, 32)
                          .map((peak, i) => (
                            <View
                              key={i}
                              style={{
                                width: 3,
                                borderRadius: 2,
                                height: Math.max(3, Math.min(1, Math.max(0, peak) / 100) * 24),
                                backgroundColor: cl.goldDeep,
                              }}
                            />
                          ))}
                      </View>
                      <Text style={s.hint}>
                        {Math.floor(entry.media.durationMs / 60000)}:
                        {String(Math.floor(entry.media.durationMs / 1000) % 60).padStart(2, '0')}
                      </Text>
                    </View>
                  )}
                  <Text style={s.hint}>{new Date(entry.createdAt).toLocaleString()}</Text>
                </View>
                <ChevronRight size={18} color={cl.ink62} />
              </Pressable>
            ))}
            {remoteRows.map((row) => (
              <Pressable
                key={row.conversationId}
                accessibilityRole="button"
                style={[
                  s.notice,
                  {
                    backgroundColor: cl.card,
                    padding: 18,
                    borderWidth: 1,
                    borderColor: cl.cardHairline,
                    borderRadius: 24,
                  },
                ]}
                onPress={() => setSelected(row.conversationId)}
              >
                <AudioLines color={cl.goldDeep} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={s.body}>{row.title || 'Voice memo'}</Text>
                  <Text numberOfLines={2} style={s.hint}>
                    {row.preview}
                  </Text>
                  <Text style={s.hint}>
                    {row.lastAt ? new Date(row.lastAt).toLocaleString() : 'Date unavailable'}
                  </Text>
                </View>
                <ChevronRight size={18} color={cl.ink62} />
              </Pressable>
            ))}
          </>
        )}
        {local && (
          <>
            <Text style={s.hint}>
              {new Date(local.createdAt).toLocaleString()} · {journalSyncLabel(local, sample)}
            </Text>
            {local.localStorageError && (
              <Text accessibilityRole="alert" style={s.hint}>
                {local.localStorageError} Your transcript is still available.
              </Text>
            )}
            {!sample &&
              local.cloud &&
              onSync &&
              (!!local.cloud.error ||
                local.text !== (local.cloud.syncedText ?? local.cloud.originalText) ||
                !local.cloud.transcriptSaved ||
                (local.media && !local.cloud.audioSaved)) && (
                <Pressable
                  accessibilityRole="button"
                  disabled={syncing}
                  style={s.notice}
                  onPress={() => {
                    setSyncing(true);
                    void onSync(local).finally(() => setSyncing(false));
                  }}
                >
                  <Text style={s.body}>{syncing ? 'Saving…' : 'Retry cloud save'}</Text>
                </Pressable>
              )}
            <View style={[s.notice, { flexDirection: 'column', alignItems: 'stretch' }]}>
              <Text style={s.label}>{local.media ? 'ORIGINAL AUDIO' : 'TYPED REHEARSAL'}</Text>
              {local.media ? (
                <VoiceNotePlayer
                  durationMs={local.media.durationMs}
                  peaks={local.media.peaks}
                  fetchAudio={async () => ({ playbackUrl: local.media!.uri })}
                />
              ) : (
                <Text style={s.hint}>This entry has no audio recording.</Text>
              )}
            </View>
            {renderDiscussion ? (
              renderDiscussion(local)
            ) : (
              <Text selectable style={s.body}>
                {local.text}
              </Text>
            )}
          </>
        )}
        {!!selected && !busy && recording && (
          <>
            <View style={{ gap: 8 }}>
              <Text style={s.label}>ORIGINAL AUDIO</Text>
              {recording.audio && recording.ownerId ? (
                <VoiceNotePlayer
                  ownerId={recording.ownerId}
                  noteId={selected}
                  durationMs={recording.audio.durationMs}
                  peaks={recording.audio.peaks}
                />
              ) : messageAudio?.audio ? (
                <VoiceNotePlayer
                  durationMs={messageAudio.audio.durationMs}
                  peaks={messageAudio.audio.peaks}
                  fetchAudio={async () => {
                    const result = await getMyMessageAudio(selected, messageAudio.id);
                    return result.ok ? result.data : null;
                  }}
                />
              ) : (
                <Text style={s.hint}>No original recording is available for this entry.</Text>
              )}
            </View>
            {renderDiscussion ? (
              renderDiscussion({
                id: selected,
                text: original?.content ?? '',
                createdAt: original?.createdAt ?? '',
                destination: 'Saved to Amber',
                query: { status: 'complete', turns: storedTurns },
                cloud: {
                  conversationId: selected,
                  originalText: original?.content ?? '',
                  transcriptSaved: true,
                },
              })
            ) : (
              <Text selectable style={s.body}>
                {original?.content}
              </Text>
            )}
          </>
        )}
        {busy && !local && <ActivityIndicator color={cl.goldDeep} />}
        {!detail && !busy && nextPage && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setCursor(nextPage)}
            style={s.notice}
          >
            <Text style={s.body}>Load earlier recordings</Text>
          </Pressable>
        )}
        {error && !local ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setRetry((value) => value + 1)}
            style={s.row}
          >
            <Text style={s.body}>{error}</Text>
          </Pressable>
        ) : !busy && !detail && !localRows.length && !remoteRows.length ? (
          <View style={{ paddingVertical: 12, gap: 8 }}>
            <Text
              style={{
                fontFamily: 'Newsreader_500Medium',
                fontSize: 25,
                lineHeight: 32,
                color: cl.ink,
              }}
            >
              {query
                ? 'No matching memories'
                : day
                  ? 'No recordings on this day'
                  : 'Your words, kept together.'}
            </Text>
            <Text style={s.hint}>
              {query
                ? 'Try another phrase or destination.'
                : 'Tap Amber in the bottom bar to record your first voice memo.'}
            </Text>
          </View>
        ) : null}
        {!sample && !detail && (
          <Text style={s.hint}>Original audio is available on recordings that include it.</Text>
        )}
      </ScrollView>
    </View>
  );
  if (embedded) return content;
  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={detail ? back : close}
    >
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: cl.ground }}>{content}</SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
