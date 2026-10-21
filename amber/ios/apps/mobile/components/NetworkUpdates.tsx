import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { getContactFacts, type MedhaContactFull } from '../lib/contacts';
import { getNetworkFeed } from '../lib/noteShares';
import { networkFeed } from '../lib/connect';
import { askPeopleRank } from '../lib/peoplerank';
import { generateBrief, rankUpdates, type BriefRecord } from '../lib/networkBrief';
import { requestStyles as s } from './MemoStyles';
import { cl } from '../lib/classical';
const EMPTY_CONTACTS: MedhaContactFull[] = [];
export function NetworkUpdates({
  contacts = EMPTY_CONTACTS,
  sample = false,
  revision = 0,
  onOpen,
  activity,
}: {
  contacts?: MedhaContactFull[];
  sample?: boolean;
  revision?: number;
  onOpen?: (id: string) => void;
  activity?: string;
}) {
  const [records, setRecords] = useState<BriefRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [summarizing, setSummarizing] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setSummary('');
    setError('');
    setRecords([]);
    if (sample) {
      setRecords(
        contacts
          .slice(0, 4)
          .map((c, i) => ({
            id: c.id,
            contactId: c.id,
            name: c.name || 'Sample person',
            detail: c.notes || c.title || 'No activity recorded yet.',
            source: 'Sample contact',
            strength: 1 - i * 0.15,
          })),
      );
      return () => controller.abort();
    }
    setBusy(true);
    void (async () => {
      const [ranking, feed, notes] = await Promise.allSettled([
        askPeopleRank(activity || '', { limit: 12, signal: controller.signal }),
        networkFeed(),
        getNetworkFeed(),
      ]);
      if (controller.signal.aborted) return;
      const ranked =
        ranking.status === 'fulfilled' && ranking.value.ok ? ranking.value.data.people : [];
      const byId = new Map(
        ranked.map((p) => [p.id, Math.max(0, Math.min(1, p.score > 1 ? p.score / 100 : p.score))]),
      );
      const top = [...contacts]
        .sort((a, b) => (byId.get(b.id) ?? 0) - (byId.get(a.id) ?? 0))
        .slice(0, 12);
      const rows: BriefRecord[] = [];
      let partial =
        ranking.status !== 'fulfilled' ||
        !ranking.value.ok ||
        feed.status !== 'fulfilled' ||
        !feed.value.ok;
      // Bound source reads; preserve independent successes when one source fails.
      for (let i = 0; i < top.length; i += 4) {
        if (controller.signal.aborted) return;
        await Promise.all(
          top.slice(i, i + 4).map(async (c) => {
            const strength = byId.get(c.id) ?? 0;
            try {
              const facts = await getContactFacts(c.id);
              if (facts.ok)
                for (const f of facts.data.facts.slice(0, 5))
                  rows.push({
                    id: `fact:${c.id}:${f.id}`,
                    contactId: c.id,
                    name: c.name || 'Contact',
                    detail: f.factText,
                    createdAt: f.createdAt,
                    source: f.source || 'Saved note',
                    strength,
                  });
              else partial = true;
            } catch {
              partial = true;
            }
            const detail = [
              c.title || c.enrichment?.title,
              c.company || c.enrichment?.company,
              c.city,
            ]
              .filter(Boolean)
              .join(' · ');
            if (detail)
              rows.push({
                id: `profile:${c.id}`,
                contactId: c.id,
                name: c.name || 'Contact',
                detail,
                source: `${c.source || 'Saved contact'} · profile context`,
                strength,
              });
          }),
        );
      }
      if (feed.status === 'fulfilled' && feed.value.ok)
        for (const post of feed.value.data.posts) {
          const contact = contacts.find((c) => c.linkedAmberId === post.author.amberId);
          rows.push({
            id: `post:${post.postId}`,
            contactId: contact?.id,
            name: post.author.fullName || 'Amber connection',
            detail: post.text,
            createdAt: post.createdAt,
            source: 'Shared on Amber',
            strength: contact ? (byId.get(contact.id) ?? 0) : 0,
          });
        }
      if (notes.status === 'fulfilled' && notes.value.ok)
        for (const note of notes.value.data.items) {
          const contact = contacts.find((c) => c.linkedAmberId === note.sharedBy.amberId);
          rows.push({
            id: `shared:${note.noteId}`,
            contactId: contact?.id,
            name: note.sharedBy.name,
            detail: note.transcript,
            createdAt: note.sharedAt,
            source: 'Shared voice memo',
            strength: contact ? (byId.get(contact.id) ?? 0) : 0,
          });
        }
      else partial = true;
      if (!controller.signal.aborted) {
        setRecords(rankUpdates(rows, Date.now()).slice(0, 20));
        setError(partial ? 'Some sources could not refresh. Showing the records available.' : '');
      }
    })()
      .catch(() => {
        if (!controller.signal.aborted) setError('Could not load network updates. Please retry.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [contacts, sample, revision, refresh, activity]);
  useEffect(() => {
    if (sample || busy || !records.length) return;
    const controller = new AbortController();
    setSummarizing(true);
    void generateBrief(
      `Give a short briefing on what these people are doing and why it matters to me. My latest personal activity: ${activity || 'None recorded'}. Preserve dates and distinguish profile context from updates.`,
      records,
      controller.signal,
    )
      .then((answer) => {
        if (!controller.signal.aborted) setSummary(answer.summary);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setSummary('AI summary is unavailable. You can still read the source updates below.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setSummarizing(false);
      });
    return () => controller.abort();
  }, [records, sample, busy, activity]);
  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Sparkles color={cl.goldDeep} size={20} />
        <Text style={[s.title, { fontSize: 26 }]}>Around your people</Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => setRefresh((v) => v + 1)}
          style={s.close}
        >
          <Text style={s.hint}>Refresh</Text>
        </Pressable>
      </View>
      <Text style={s.hint}>
        {sample
          ? 'Sample feed · illustrative profile context'
          : 'Ranked by relationship strength and recency · up to 12 ranked contacts, plus shared updates'}
      </Text>
      {(busy || summarizing) && (
        <ActivityIndicator
          color={cl.goldDeep}
          accessibilityLabel={busy ? 'Loading network sources' : 'Writing your briefing'}
        />
      )}
      {!!summary && <Text style={[s.body, { fontSize: 18, lineHeight: 27 }]}>{summary}</Text>}
      {!!activity && (
        <View style={s.notice}>
          <Text style={s.body}>Your latest update: {activity}</Text>
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={s.hint}>
          {error}
        </Text>
      )}
      {!busy && !records.length && (
        <Text style={s.body}>
          Your network’s updates will appear here as you add notes and connect sources.
        </Text>
      )}
      {records.map((record) => (
        <Pressable
          key={record.id}
          accessibilityRole={record.contactId && onOpen ? 'button' : 'text'}
          disabled={!record.contactId || !onOpen}
          onPress={() => record.contactId && onOpen?.(record.contactId)}
          style={{
            padding: 20,
            gap: 10,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: cl.cardHairline,
            backgroundColor: cl.card,
          }}
        >
          <Text style={[s.hint, { color: cl.goldDeep }]}>
            {record.source}
            {record.createdAt
              ? ` · Recorded ${new Date(record.createdAt).toLocaleDateString()}`
              : ''}
          </Text>
          <Text
            style={{
              fontFamily: 'Newsreader_500Medium',
              fontSize: 25,
              lineHeight: 32,
              color: cl.ink,
            }}
          >
            {record.name}
          </Text>
          <Text style={s.body}>{record.detail}</Text>
          {!!record.strength && (
            <Text style={s.hint}>Prioritized by your relationship ranking</Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}
