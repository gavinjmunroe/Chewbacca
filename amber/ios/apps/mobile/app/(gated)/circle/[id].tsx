import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Share, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  LogOut,
  Mic,
  Search,
  UserPlus,
  X,
} from 'lucide-react-native';
import { Avatar } from '../../../components/Avatar';
import { CircleFeedTab } from '../../../components/CircleFeedTab';
import { CircleVoiceCapture } from '../../../components/CircleVoiceCapture';
import { ChordEmblem } from '../../../components/ChordEmblem';
import { getCircleFeed } from '../../../lib/noteShares';
import { Text } from '../../../components/Text';
import {
  createCircle,
  deleteCircle,
  getCircleMembers,
  leaveCircle,
  listCircles,
  listInboundCircles,
  addCircleLocally,
  markCircleSeen,
  patchCircleLocally,
  removeCircleLocally,
  respondToCircleInvite,
  setCircleMembers,
  updateCircle,
  type CircleMember,
  type CirclePreview,
} from '../../../lib/circles';
import { NAMED_COLORS, ON_COLOR } from '../../../lib/circleColors';
import { useSharedWithMe } from '../../../lib/shares';
import { useContacts } from '../../../lib/useContacts';
import { type NetworkIdentity } from '../../../lib/network';
import { medhaIdErrorCopy } from '../../../lib/medhaId';
import { toast } from '../../../lib/toast';
import { elevation, fonts, radius, spacing, typography } from '../../../lib/tokens';
import { LIGHT } from '../../../lib/theme';
import { HAIRLINE, cl } from '../../../lib/classical';
import { CText } from '../../../components/classical';
import { FadeInUp } from '../../../lib/motion';
import { useVoiceDictation } from '../../../lib/useVoiceDictation';
import { RecordingWaveform } from '../../../components/RecordingWaveform';
import { filterPeople } from '../../../lib/peopleSearch';

const COLOR_KEYS = Object.keys(NAMED_COLORS);

/**
 * THE KINDS WE OFFER, AND WHY IT IS ONLY FOUR.
 *
 * A circle's kind used to be decided by a model from the circle's name and
 * description, out of a fixed four-word vocabulary: interest, experience,
 * affiliation, other. Those are the classifier's categories, not anybody's
 * life -- a circle for your family came back "other", a circle for your street
 * came back "affiliation" -- and it needed a description to run at all, which
 * is what made creating a circle refuse to proceed without one.
 *
 * These four cover most circles in one tap, and the fifth option is a text
 * field, because the point of the change is that the app stops telling people
 * what kinds of circle exist. Whatever gets typed is stored as typed.
 */
const KIND_TAGS = ['Work', 'Friends', 'Family', 'School'] as const;

/** The circle's own color at low alpha, for a selected chip's fill. */
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
const DEFAULT_COLOR_KEY = COLOR_KEYS[0]!;

// How many contacts the "Add people" list shows before the "Load all" link. The
// full list can run to hundreds of rows; capping the default render keeps the
// color picker, member list, Save, and Delete reachable without endless scroll.
const CONTACTS_PREVIEW = 5;

// The INFO tab renders as flat sections stacked down the page, each closed by a
// gold-tinted hairline (never as elevated cards) — the layout from
// `Circle Info Light.dc.html`. This is that section frame.
const SECTION = {
  paddingVertical: 20,
  borderBottomWidth: HAIRLINE,
  borderBottomColor: cl.gold18,
  gap: 16,
} as const;

// Circles persist their color as a named key (see createCircle). Map an
// existing circle's stored color back onto a swatch; fall back to the default
// when the backend ever hands us a raw hex or an unknown name.
function colorKeyFor(color: string | null | undefined): string {
  if (color && Object.prototype.hasOwnProperty.call(NAMED_COLORS, color)) return color;
  return DEFAULT_COLOR_KEY;
}

export default function CircleEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isEditing = id !== 'new';
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  // The emblem fills the content column on any device: full width minus both
  // gutters, capped so it does not become absurd on an iPad. 334 was tuned for a
  // 390pt iPhone and clipped on anything narrower.
  const emblemSize = Math.min(360, Math.max(220, screenW - spacing.lg * 2));
  const contacts = useContacts();
  const sharedWithMe = useSharedWithMe();
  // Recording INTO this circle. `feedKey` is bumped once a note has been shared so
  // the feed refetches and the note the user just recorded is actually there.
  const [recOpen, setRecOpen] = useState(false);
  const [feedKey, setFeedKey] = useState(0);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [colorKey, setColorKey] = useState(DEFAULT_COLOR_KEY);
  const [kindTag, setKindTag] = useState('');
  // Whether the free-text field is open. Separate from `kindTag` having a
  // custom value, so tapping Other opens an empty field rather than requiring
  // a value to exist before it can be typed into.
  const [kindOther, setKindOther] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [membersLoading, setMembersLoading] = useState(isEditing);
  const [searchQuery, setSearchQuery] = useState('');
  // Whether the "Add people" list is expanded past its first-5 preview. Only
  // consulted when not searching; a search always shows every match.
  const [showAllContacts, setShowAllContacts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Inbound = a circle someone else added you to. Detected on load; when set, the
  // screen renders read-only (members + leave), never the owner editor.
  const [inbound, setInbound] = useState<CirclePreview | null>(null);
  const [inboundMembers, setInboundMembers] = useState<CircleMember[]>([]);
  const [leaving, setLeaving] = useState(false);
  // In flight while accepting or declining an invitation, so the two buttons
  // cannot both be pressed and the same answer cannot be sent twice.
  const [responding, setResponding] = useState(false);

  // Which tab is showing. 'feed' is the shared-note feed (the default, per the
  // target design); 'info' is the circle detail — members + name + description +
  // color for owned circles, a read-only member list for inbound ones. Only
  // meaningful in edit mode ('new' circles have no feed yet). Opening 'feed'
  // loads the circle feed, which the backend treats as marking those notes seen.
  const [tab, setTab] = useState<'feed' | 'info'>('feed');

  // The owned circle preview (from listCircles), kept so the detail header can
  // show its unseen count. Null for inbound / new circles.
  const [ownedPreview, setOwnedPreview] = useState<CirclePreview | null>(null);

  // There's no getCircle endpoint, so name/color come from listCircles() (the
  // same list the grid already renders from), found by id; members load from
  // their own endpoint, exactly as the old modal editor did. Create mode
  // ('new') skips this entirely — blank form, nothing selected.
  useEffect(() => {
    if (!isEditing) return undefined;
    let cancelled = false;
    setMembersLoading(true);
    void Promise.all([listCircles(), listInboundCircles(), getCircleMembers(id)]).then(
      ([listRes, inboundRes, membersRes]) => {
        if (cancelled) return;
        const owned = listRes.ok ? listRes.data.circles.find((c) => c.id === id) : null;
        const fromInbound =
          !owned && inboundRes.ok ? inboundRes.data.circles.find((c) => c.id === id) : null;

        if (owned) {
          setOwnedPreview(owned);
          setName(owned.name);
          setDescription(owned.description ?? '');
          setColorKey(colorKeyFor(owned.color));
          const tag = owned.kindTag ?? '';
          setKindTag(tag);
          // A tag that is not one of the four opens the field showing itself,
          // so editing a circle tagged "Climbing" does not look untagged.
          setKindOther(tag.length > 0 && !KIND_TAGS.some((t) => t === tag));
        } else if (fromInbound) {
          // Read-only inbound circle: capture it, clear its "new" state, and hold
          // its members for the member list. No editor state is set.
          setInbound(fromInbound);
          setName(fromInbound.name);
          setColorKey(colorKeyFor(fromInbound.color));
          // Not while the invitation is unanswered. Marking it seen is what
          // clears the "you were added" state, and clearing that on a circle
          // they have not accepted yet would quietly file the question as
          // handled. Accepting marks it seen (server-side, in the same request).
          if (fromInbound.seen === false && fromInbound.invite !== 'pending') {
            void markCircleSeen(id);
          }
        } else if (listRes.ok && inboundRes.ok) {
          toast.error('Could not find this circle.');
        } else {
          const errRes = !listRes.ok ? listRes : !inboundRes.ok ? inboundRes : null;
          toast.error(
            'Could not load this circle.',
            errRes ? medhaIdErrorCopy(errRes, 'Amber') : undefined,
          );
        }

        if (membersRes.ok) {
          const members = membersRes.data.members;
          if (fromInbound) {
            setInboundMembers(members);
          } else {
            setSelectedIds(new Set(members.map((m) => m.contactId)));
          }
        } else if (!fromInbound) {
          toast.error('Could not load circle members.', medhaIdErrorCopy(membersRes, 'Amber'));
        }
        setMembersLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [isEditing, id]);

  const handleLeave = () => {
    Alert.alert(
      'Leave this circle?',
      `You'll be removed from "${inbound?.name ?? 'this circle'}". The owner keeps the circle.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setLeaving(true);
              const res = await leaveCircle(id);
              setLeaving(false);
              if (!res.ok) {
                toast.error('Could not leave the circle.', medhaIdErrorCopy(res, 'Amber'));
                return;
              }
              // Gone from every surface on the way out, rather than lingering
              // on the profile web until a refetch notices.
              removeCircleLocally(id);
              toast.success('You left the circle.');
              router.back();
            })();
          },
        },
      ],
    );
  };

  // ANSWERING THE INVITATION.
  //
  // "They should be notified that they are in the circle and be asked to accept
  //  if they want to join the circle."
  //
  // Accept is one tap and stays on the screen -- they said yes to this circle,
  // so the circle is where they should be. Decline asks first, because it also
  // removes them from the circle and the owner is not told; it is not a thing to
  // do by mis-tap.
  //
  // The banner clears optimistically on accept. The alternative is refetching
  // the whole inbound list to learn something we already know, with the prompt
  // sitting there through the round trip.
  const respondToInvite = (accept: boolean) => {
    if (responding) return;
    const go = () => {
      void (async () => {
        setResponding(true);
        const res = await respondToCircleInvite(id, accept);
        setResponding(false);
        if (!res.ok) {
          toast.error(
            accept ? 'Could not join the circle.' : 'Could not decline.',
            medhaIdErrorCopy(res, 'Amber'),
          );
          return;
        }
        if (accept) {
          setInbound((prev) => (prev ? { ...prev, invite: 'accepted', seen: true } : prev));
          toast.success(`You joined ${inbound?.name ?? 'the circle'}.`);
        } else {
          toast.success('Declined.');
          router.back();
        }
      })();
    };
    if (accept) return go();
    Alert.alert(
      'Decline this circle?',
      `You'll be removed from "${inbound?.name ?? 'this circle'}" and it won't be offered again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Decline', style: 'destructive', onPress: go },
      ],
    );
  };

  // ONE MATCHER FOR EVERY PEOPLE LIST -- see lib/peopleSearch.ts. This filter was
  // written out four times across the app and had already drifted; it also could
  // not find "Sirin" for "Şirin", or "odell marcus" for "Marcus O'Dell".
  const filteredContacts = useMemo(
    () => filterPeople(contacts.items, searchQuery) as typeof contacts.items,
    [contacts, searchQuery],
  );

  const isSearching = searchQuery.trim().length > 0;

  // What the "Add people" list actually renders: every match while searching (so
  // a search is never truncated), the full list once the owner taps "Load all",
  // otherwise just the first few. Purely a render cap over the already-loaded,
  // real contacts — selection/toggle state is unchanged.
  const visibleContacts = useMemo(
    () =>
      isSearching || showAllContacts
        ? filteredContacts
        : filteredContacts.slice(0, CONTACTS_PREVIEW),
    [filteredContacts, isSearching, showAllContacts],
  );

  // The selected contacts, resolved to full objects, for the "in this circle"
  // strip. Filtered from the loaded list so it stays in step with the cards.
  const selectedPeople = useMemo(
    () => contacts.items.filter((p) => selectedIds.has(p.id)),
    [contacts.items, selectedIds],
  );

  const toggleMember = (contactId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  };

  // Block save until members have loaded in edit mode, so we never diff
  // against an empty initial set and accidentally strip everyone out.
  /**
   * A NEW CIRCLE NEEDS A DESCRIPTION. An existing one does not.
   *
   * The description is not decoration: medha-id's circle classifier reads name +
   * description and decides the circle's KIND (interest / experience /
   * affiliation), which is what arranges the web on the profile and what makes
   * every member of the circle findable by the topic. A circle called "Tuesday"
   * with nothing else to go on classifies as "other", and "other" is the sector
   * where things go to be forgotten.
   *
   * Required only on CREATE, deliberately: circles made before this rule existed
   * have no description, and refusing to let their owner rename one until they
   * write a paragraph would be punishing them for our own timing.
   */
  // A DESCRIPTION IS NO LONGER REQUIRED TO CREATE A CIRCLE.
  //
  // It was required for exactly one reason: medha-id's classifier read name +
  // description and decided the circle's KIND, which arranged the profile web.
  // The kind is a tag the user picks now, so the model has nothing to read and
  // the description has nothing to gate. A circle called "USC Growth Team" with
  // two people in it was refused, with the only explanation sitting below the
  // fold, which read as the button being broken.
  const canSave = name.trim().length > 0 && !saving && !membersLoading;

  // The circle's color tints ACCENTS ONLY — the active-tab underline, the "N new"
  // highlight, the unseen dot, and selected states (member checkbox). It never
  // touches backgrounds, cards, or body text, which stay the standard warm theme.
  // Follows the live color picker so the underline updates as the owner edits;
  // falls back to the app's amber gold when the circle has no mapped color.
  const accent = NAMED_COLORS[colorKey] ?? LIGHT.accent;

  // SPEAK IT INSTEAD OF TYPING IT. The whole app is built on people saying more
  // than they type, and a description is exactly the kind of thing nobody types:
  // "these are the people I sailed with in Croatia" is a sentence you say. The
  // transcript is APPENDED rather than replacing, so a second thought adds to the
  // first instead of erasing it.
  const dictation = useVoiceDictation({
    onUtterance: (t) => {
      setDescription((d) => (d.trim() ? `${d.trim()} ${t}` : t));
    },
  });

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);

    // Resolve the target circle id: the existing one when editing, or a freshly
    // created one otherwise.
    let circleId: string;
    if (isEditing) {
      const res = await updateCircle(id, {
        name: name.trim(),
        color: colorKey,
        description: description.trim(),
        // Sent even when empty: '' is how a circle goes back to untagged, and
        // omitting the key would leave the old tag in place instead.
        kindTag: kindTag.trim(),
      });
      if (!res.ok) {
        setSaving(false);
        toast.error('Could not save circle.', medhaIdErrorCopy(res, 'Amber'));
        return;
      }
      // PAINT IT NOW. The server just echoed the circle it saved, so the web on
      // the profile, the grid and the pinned tiles have no reason to wait for a
      // refetch to learn a name he typed thirty seconds ago.
      patchCircleLocally(id, res.data.circle);
      circleId = id;
    } else {
      const res = await createCircle(
        name.trim(),
        colorKey,
        description.trim(),
        kindTag.trim(),
      );
      if (!res.ok) {
        setSaving(false);
        toast.error('Could not create circle.', medhaIdErrorCopy(res, 'Amber'));
        return;
      }
      addCircleLocally(res.data.circle);
      circleId = res.data.circle.id;
    }

    // Send the membership the circle should HAVE, in one request, and let the
    // server diff it. This used to be one request per added and per removed
    // member, run one after another, and each of those requests awaited a
    // reconcile of every member fact in the whole circle plus a push. A dozen
    // members was a dozen serial round trips each doing the whole circle's work
    // again -- which is why saving a circle took minutes.
    //
    // A no-op save (nothing selected changed) still goes through: the server
    // computes an empty diff cheaply, and skipping it here would mean tracking
    // set equality in two places.
    const desiredIds = [...selectedIds];
    const memberRes = await setCircleMembers(circleId, desiredIds);

    // AND PAINT THE MEMBERSHIP, from the contacts already loaded on this screen.
    // The web card plots one dot per member and labels it with a name, and both
    // of those are in `contacts.items` -- there is nothing to fetch. `preview` is
    // capped at 30 to match what the server sends.
    if (memberRes.ok) {
      const byId = new Map(contacts.items.map((c) => [c.id, c]));
      const members = desiredIds
        .map((cid) => byId.get(cid))
        .filter((c): c is NetworkIdentity => Boolean(c))
        .slice(0, 30)
        .map((c) => ({
          contactId: c.id,
          name: c.name,
          avatarUrl: c.avatarUrl ?? null,
          connected: Boolean(c.amberId),
          amberId: c.amberId ?? null,
          username: c.username ?? null,
        }));
      patchCircleLocally(circleId, {
        memberCount: memberRes.data.memberCount,
        connectedCount: members.filter((m) => m.connected).length,
        preview: members,
      });
    }

    setSaving(false);
    const verb = isEditing ? 'saved' : 'created';
    if (!memberRes.ok) {
      toast.error(
        `Circle ${verb}.`,
        `Members didn't save — reopen the circle to retry.`,
      );
    } else if (memberRes.data.unknown > 0) {
      // Not a sync failure. These ids aren't contacts of yours (deleted from the
      // address book mid-edit, most often), so they were never addable. Say
      // skipped, not failed.
      const n = memberRes.data.unknown;
      toast.success(
        `Circle ${verb}.`,
        `${n} ${n === 1 ? 'person was' : 'people were'} skipped — no contact card for them anymore.`,
      );
    } else {
      toast.success(`Circle ${verb}.`);
    }
    router.back();
  };

  // Export every shared note in this circle as plain text via the system share
  // sheet. Reads the same member-scoped feed the Feed tab renders, so it can
  // never export a note the viewer isn't entitled to see. `limit` is raised well
  // past the feed's default 30 because an export that silently truncated would be
  // worse than no export at all.
  const handleExport = async () => {
    if (!isEditing || exporting) return;
    setExporting(true);
    const res = await getCircleFeed(id, { limit: 500 });
    setExporting(false);
    if (!res.ok) {
      toast.error('Could not export transcripts.', medhaIdErrorCopy(res, 'Amber'));
      return;
    }
    const items = res.data.items;
    if (items.length === 0) {
      toast.error('Nothing to export yet.', 'No notes have been shared with this circle.');
      return;
    }
    const header = `${name || 'Circle'} — ${selectedIds.size} ${
      selectedIds.size === 1 ? 'person' : 'people'
    }\nExported ${new Date().toLocaleDateString()}\n`;
    const body = items
      .map((it) => {
        const who = it.sharedBy.name || it.sharedBy.username || 'Amber user';
        const when = it.sharedAt ? new Date(it.sharedAt).toLocaleString() : '';
        return `${who}${when ? ` · ${when}` : ''}\n${it.transcript}`;
      })
      .join('\n\n———\n\n');
    try {
      await Share.share({ message: `${header}\n${body}`, title: `${name} transcripts` });
    } catch {
      // User dismissed the share sheet, or the platform refused it. Not an error
      // worth a toast — nothing was lost.
    }
  };

  const handleDelete = () => {
    if (!isEditing) return;
    Alert.alert(
      'Delete circle?',
      `"${name}" will be removed. Your contacts are not deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setSaving(true);
              const res = await deleteCircle(id);
              setSaving(false);
              if (!res.ok) {
                toast.error('Could not delete circle.', medhaIdErrorCopy(res, 'Amber'));
                return;
              }
              removeCircleLocally(id);
              toast.success('Circle deleted.');
              router.back();
            })();
          },
        },
      ],
    );
  };

  // ── Inbound (read-only) circle ────────────────────────────────────────────
  // A circle someone else added you to: you can see who's in it and leave, but
  // only the owner edits it.
  if (inbound) {
    return (
      <View style={{ flex: 1, backgroundColor: LIGHT.canvas }}>
        <CircleHeader
          title={inbound.name}
          memberCount={inbound.memberCount}
          newCount={inbound.unseenCount ?? 0}
          avatars={inboundMembers.map((m) => ({ name: m.name, url: m.avatarUrl }))}
          accent={accent}
          onBack={() => router.back()}
          onSearch={() =>
            router.push(`/(gated)/circle/search/${id}?accent=${encodeURIComponent(accent)}`)
          }
        />

        <CircleTabSwitch tab={tab} onChange={setTab} accent={accent} />

        {tab === 'feed' ? (
          <View style={{ flex: 1 }}>
            <CircleFeedTab circleId={id} accent={accent} refreshKey={feedKey} bottomClearance={CIRCLE_RECORD_BAR_H} />
            <RecordIntoCircleButton onPress={() => setRecOpen(true)} />
            <CircleVoiceCapture
              visible={recOpen}
              circleId={id}
              circleName={inbound.name}
              onClose={() => {
                setRecOpen(false);
                // The note is created, uploaded and shared asynchronously, so give
                // that chain a beat before refetching rather than racing it.
                setTimeout(() => setFeedKey((k) => k + 1), 2500);
              }}
            />
          </View>
        ) : (
        <FlatList
          data={inboundMembers}
          keyExtractor={(m) => m.contactId}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
          ListHeaderComponent={
            <View style={{ gap: spacing.lg, paddingBottom: spacing.md }}>
              {/* Circle emblem — same identity graphic as the owned view, read-only. */}
              <View style={{ paddingTop: 8, paddingBottom: 4, alignItems: 'center' }}>
                <ChordEmblem
                  name={inbound.name}
                  memberCount={inbound.memberCount}
                  members={inboundMembers.map((m) => ({ id: m.contactId, name: m.name }))}
                  accent={accent}
                  size={emblemSize}
                />
              </View>

              {/* THE INVITATION, AND THE ANSWER TO IT.
                  A circle somebody else made, containing people you may not
                  know, used to simply appear here with a note saying it had. Now
                  an unanswered one asks. Once answered (or for anyone who was
                  already in a circle before invitations existed) this falls back
                  to the note it always was. */}
              {inbound.invite === 'pending' ? (
                <View
                  style={{
                    gap: spacing.sm,
                    padding: spacing.md,
                    borderRadius: radius.lg,
                    backgroundColor: LIGHT.chipBg,
                    borderWidth: 1,
                    borderColor: LIGHT.hairline,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <UserPlus color={LIGHT.accentText} size={18} strokeWidth={2.25} />
                    <Text variant="bodySm" style={{ flex: 1, color: LIGHT.textPrimary }}>
                      {inbound.owner?.name
                        ? `${inbound.owner.name} added you to this circle.`
                        : 'You have been added to this circle.'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Pressable
                      onPress={() => respondToInvite(true)}
                      disabled={responding}
                      accessibilityRole="button"
                      accessibilityLabel="Join this circle"
                      style={({ pressed }) => ({
                        flex: 1,
                        paddingVertical: 11,
                        borderRadius: radius.md,
                        alignItems: 'center',
                        backgroundColor: accent,
                        opacity: responding ? 0.5 : pressed ? 0.85 : 1,
                      })}
                    >
                      <Text variant="bodySm" style={{ color: ON_COLOR, fontWeight: '600' }}>
                        Join
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => respondToInvite(false)}
                      disabled={responding}
                      accessibilityRole="button"
                      accessibilityLabel="Decline this circle"
                      style={({ pressed }) => ({
                        flex: 1,
                        paddingVertical: 11,
                        borderRadius: radius.md,
                        alignItems: 'center',
                        borderWidth: 1,
                        borderColor: LIGHT.hairline,
                        backgroundColor: LIGHT.surface,
                        opacity: responding ? 0.5 : pressed ? 0.85 : 1,
                      })}
                    >
                      <Text variant="bodySm" style={{ color: LIGHT.textSecondary }}>
                        No thanks
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : inbound.seen === false ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                    padding: spacing.md,
                    borderRadius: radius.lg,
                    backgroundColor: LIGHT.chipBg,
                    borderWidth: 1,
                    borderColor: LIGHT.hairline,
                  }}
                >
                  <UserPlus color={LIGHT.accentText} size={18} strokeWidth={2.25} />
                  <Text variant="bodySm" style={{ flex: 1, color: LIGHT.textPrimary }}>
                    {inbound.owner?.name
                      ? `${inbound.owner.name} added you to this circle.`
                      : 'You have been added to this circle.'}
                  </Text>
                </View>
              ) : null}

              {inbound.description ? (
                <View style={{ gap: 7 }}>
                  <SectionLabel>About</SectionLabel>
                  <Text
                    style={{
                      fontFamily: fonts.body,
                      fontSize: 14.5,
                      lineHeight: 23,
                      color: LIGHT.textSecondary,
                    }}
                  >
                    {inbound.description}
                  </Text>
                </View>
              ) : null}

              {(() => {
                const sharedHere =
                  sharedWithMe.status === 'done'
                    ? sharedWithMe.items.filter(
                        (it) => it.scopeType === 'circle' && it.scopeRef === id,
                      )
                    : [];
                if (sharedHere.length === 0) return null;
                return (
                  <View style={{ gap: spacing.sm }}>
                    <SectionLabel>Shared with this circle</SectionLabel>
                    {sharedHere.map((it) => (
                      <View
                        key={it.shareId}
                        style={{
                          padding: spacing.md,
                          borderRadius: radius.lg,
                          borderWidth: 1,
                          borderColor: LIGHT.hairline,
                          backgroundColor: LIGHT.surface,
                          ...elevation.sm,
                        }}
                      >
                        <Text variant="bodyMd" style={{ color: LIGHT.textPrimary }}>
                          {it.content?.text ?? 'Shared item'}
                        </Text>
                        {it.owner.name ? (
                          <Text variant="captionSm" style={{ color: LIGHT.textMuted, marginTop: 2 }}>
                            {`From ${it.owner.name}`}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                );
              })()}

              <View style={{ gap: spacing.xs }}>
                <SectionLabel right={`${inbound.memberCount}`}>In this circle</SectionLabel>
              </View>
            </View>
          }
          ListEmptyComponent={
            membersLoading ? (
              <View style={{ paddingTop: spacing.xl, alignItems: 'center' }}>
                <ActivityIndicator color={LIGHT.textMuted} />
              </View>
            ) : (
              <View style={{ paddingTop: spacing.xl, alignItems: 'center' }}>
                <Text variant="bodyMd" style={{ color: LIGHT.textMuted }}>
                  No one else here yet.
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <View
              style={{
                paddingVertical: 11,
                borderBottomWidth: HAIRLINE,
                borderBottomColor: cl.gold12,
              }}
            >
              <MemberRow
                name={item.name}
                avatarUrl={item.avatarUrl}
                username={item.username}
                amberId={item.amberId}
                onOpen={(amberId) => router.push(`/(gated)/u/${amberId}`)}
              />
            </View>
          )}
        />
        )}

        <View
          style={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.sm,
            paddingBottom: insets.bottom + spacing.base,
          }}
        >
          <Pressable
            onPress={handleLeave}
            disabled={leaving}
            accessibilityRole="button"
            accessibilityLabel="Leave circle"
            style={({ pressed }) => ({ opacity: leaving ? 0.4 : pressed ? 0.6 : 1 })}
          >
            <View
              style={{
                height: 48,
                borderRadius: radius.full,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.xs,
                backgroundColor: 'transparent',
                borderWidth: 1,
                borderColor: 'rgba(192,57,43,0.4)',
              }}
            >
              <LogOut color={LIGHT.danger} size={16} strokeWidth={2.25} />
              <Text variant="buttonSm" style={{ color: LIGHT.danger }}>
                {leaving ? 'Leaving…' : 'Leave circle'}
              </Text>
            </View>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: LIGHT.canvas }}>
      {isEditing ? (
        <CircleHeader
          title={name || 'Circle'}
          memberCount={membersLoading ? (ownedPreview?.memberCount ?? 0) : selectedIds.size}
          newCount={ownedPreview?.unseenCount ?? 0}
          avatars={selectedPeople.map((p) => ({ name: p.name, url: p.avatarUrl }))}
          accent={accent}
          onBack={() => router.back()}
          onSearch={() =>
            router.push(`/(gated)/circle/search/${id}?accent=${encodeURIComponent(accent)}`)
          }
        />
      ) : (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: spacing.lg,
            paddingTop: insets.top + spacing.base,
            paddingBottom: spacing.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={10}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: radius.full,
                  backgroundColor: LIGHT.surface,
                  borderWidth: 1,
                  borderColor: LIGHT.hairline,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ArrowLeft color={LIGHT.textPrimary} size={20} />
              </View>
            </Pressable>
            <Text variant="titleMd" style={{ color: LIGHT.textPrimary }}>
              New circle
            </Text>
          </View>
        </View>
      )}

      {isEditing ? <CircleTabSwitch tab={tab} onChange={setTab} accent={accent} /> : null}

      {isEditing && tab === 'feed' ? (
        <View style={{ flex: 1 }}>
          <CircleFeedTab circleId={id} accent={accent} refreshKey={feedKey} bottomClearance={CIRCLE_RECORD_BAR_H} />
          <RecordIntoCircleButton onPress={() => setRecOpen(true)} />
          <CircleVoiceCapture
            visible={recOpen}
            circleId={id}
            circleName={name || 'this circle'}
            onClose={() => {
              setRecOpen(false);
              setTimeout(() => setFeedKey((k) => k + 1), 2500);
            }}
          />
        </View>
      ) : (
      <>
      {contacts.status === 'loading' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
          <ActivityIndicator color={LIGHT.textMuted} />
          <Text variant="bodySm" style={{ color: LIGHT.textMuted }}>
            Loading your contacts…
          </Text>
        </View>
      ) : contacts.status === 'error' ? (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl }}
        >
          <Text variant="bodyMd" centered style={{ color: LIGHT.textSecondary }}>
            {contacts.errorMsg ?? "Couldn't load your contacts."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visibleContacts}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="interactive"
          initialNumToRender={14}
          maxToRenderPerBatch={16}
          windowSize={11}
          removeClippedSubviews
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
          ListHeaderComponent={
            <FadeInUp index={0} style={{ paddingBottom: spacing.md }}>
              {/* Circle emblem — the identity graphic from the design (Circle.dc.html
                  / "Circles" tile): an accent ring holding the member monogram
                  cluster, with the name and count beneath. The accent paints only
                  the ring stroke; the faces and ground stay the warm theme. Shown
                  for existing circles; the blank "new" form skips it. */}
              {isEditing ? (
                <View
                  style={{
                    paddingTop: 8,
                    paddingBottom: 20,
                    alignItems: 'center',
                    borderBottomWidth: HAIRLINE,
                    borderBottomColor: cl.gold18,
                  }}
                >
                  <ChordEmblem
                    name={name}
                    memberCount={selectedIds.size}
                    members={selectedPeople.map((p) => ({ id: p.id, name: p.name }))}
                    accent={accent}
                    size={emblemSize}
                  />
                </View>
              ) : null}

              {/* Name + About — the circle's identity, editable in place. In the
                  design these read as a large serif name and a muted line of copy,
                  each sitting on its own gold underline. */}
              <View style={[SECTION, { paddingTop: 22 }]}>
                <View style={{ gap: 7 }}>
                  <SectionLabel>Name</SectionLabel>
                  <View
                    style={{ borderBottomWidth: HAIRLINE, borderBottomColor: cl.gold35, paddingBottom: 8 }}
                  >
                    <TextInput
                      value={name}
                      onChangeText={setName}
                      placeholder="Close Friends, Work, School…"
                      placeholderTextColor={LIGHT.textMuted}
                      style={{
                        fontFamily: fonts.serif,
                        fontSize: 24,
                        lineHeight: 28,
                        letterSpacing: 0.24,
                        color: LIGHT.textPrimary,
                        padding: 0,
                      }}
                    />
                  </View>
                </View>
                <View style={{ gap: 7 }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <SectionLabel>{isEditing ? 'About' : 'About — required'}</SectionLabel>
                    {/* Tap to talk. Stops and transcribes on the second tap; the
                        bars are the live mic level, so it is obvious the thing is
                        listening. */}
                    <Pressable
                      onPress={() => (dictation.active ? dictation.stop() : dictation.start())}
                      accessibilityRole="button"
                      accessibilityLabel={
                        dictation.active ? 'Stop and transcribe' : 'Describe this circle out loud'
                      }
                      hitSlop={10}
                      disabled={dictation.transcribing}
                      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 7,
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                          borderRadius: 999,
                          backgroundColor: dictation.active ? cl.tint100 : 'transparent',
                          borderWidth: HAIRLINE,
                          borderColor: dictation.active ? cl.gold55 : cl.gold35,
                        }}
                      >
                        {dictation.active ? (
                          <RecordingWaveform
                            getMetering={dictation.getMetering}
                            active
                            color={cl.goldDeep}
                            bars={3}
                            barWidth={2}
                            gap={2}
                            height={12}
                          />
                        ) : (
                          <Mic size={13} color={cl.goldDeep} strokeWidth={2.2} />
                        )}
                        <Text variant="buttonSm" style={{ color: cl.goldDeep }}>
                          {dictation.transcribing
                            ? 'Writing…'
                            : dictation.active
                              ? 'Stop'
                              : 'Speak'}
                        </Text>
                      </View>
                    </Pressable>
                  </View>
                  <View
                    style={{ borderBottomWidth: HAIRLINE, borderBottomColor: cl.gold22, paddingBottom: 8 }}
                  >
                    <TextInput
                      value={description}
                      onChangeText={setDescription}
                      placeholder="What is this circle about? Optional."
                      placeholderTextColor={LIGHT.textMuted}
                      multiline
                      style={{
                        fontFamily: fonts.body,
                        fontSize: 14.5,
                        lineHeight: 23,
                        color: LIGHT.textSecondary,
                        padding: 0,
                        textAlignVertical: 'top',
                        minHeight: 44,
                      }}
                    />
                  </View>
                  {/* No blocking hint any more: nothing about the description
                      stops the save, so there is nothing to explain. */}
                </View>
              </View>

              {/* WHAT KIND OF CIRCLE THIS IS, and the user says so.
                  This replaces a model call. See KIND_TAGS for the argument.
                  Untagged is a legitimate state -- tapping the selected chip
                  again clears it -- because a circle that does not fit any of
                  these should not be forced into one, and the profile web draws
                  an "Untagged" sector rather than pretending. */}
              <View style={[SECTION, { gap: 12 }]}>
                <SectionLabel>Kind</SectionLabel>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {KIND_TAGS.map((tag) => {
                    const selected = !kindOther && kindTag === tag;
                    return (
                      <Pressable
                        key={tag}
                        onPress={() => {
                          setKindOther(false);
                          // Tapping the chosen one clears it. A required field
                          // with no way back is how a mis-tap becomes permanent.
                          setKindTag((cur) => (cur === tag ? '' : tag));
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={tag}
                        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                      >
                        <View
                          style={{
                            paddingHorizontal: 14,
                            paddingVertical: 8,
                            borderRadius: radius.full,
                            backgroundColor: selected ? withAlpha(accent, 0.16) : 'transparent',
                            borderWidth: 1,
                            borderColor: selected ? accent : cl.gold22,
                          }}
                        >
                          <Text
                            variant="bodySm"
                            style={{ color: selected ? cl.goldDeep : LIGHT.textSecondary }}
                          >
                            {tag}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                  <Pressable
                    onPress={() => {
                      setKindOther((v) => {
                        const next = !v;
                        // Leaving Other drops whatever was typed; entering it
                        // starts empty rather than inheriting "Work".
                        setKindTag(next ? '' : '');
                        return next;
                      });
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: kindOther }}
                    accessibilityLabel="Another kind"
                    style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                  >
                    <View
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: radius.full,
                        backgroundColor: kindOther ? withAlpha(accent, 0.16) : 'transparent',
                        borderWidth: 1,
                        borderColor: kindOther ? accent : cl.gold22,
                      }}
                    >
                      <Text
                        variant="bodySm"
                        style={{ color: kindOther ? cl.goldDeep : LIGHT.textSecondary }}
                      >
                        Other…
                      </Text>
                    </View>
                  </Pressable>
                </View>
                {kindOther ? (
                  <View
                    style={{
                      borderBottomWidth: HAIRLINE,
                      borderBottomColor: cl.gold22,
                      paddingBottom: 6,
                    }}
                  >
                    <TextInput
                      value={kindTag}
                      onChangeText={(t) => setKindTag(t.slice(0, 24))}
                      placeholder="Neighbors, Climbing, Book club…"
                      placeholderTextColor={LIGHT.textMuted}
                      autoCapitalize="words"
                      style={{
                        fontFamily: fonts.body,
                        fontSize: 15,
                        lineHeight: 22,
                        color: LIGHT.textSecondary,
                        padding: 0,
                      }}
                    />
                  </View>
                ) : null}
              </View>

              {/* Circle color — the accent swatch grid. Selection is a gold ring
                  with a canvas gap + a check, exactly the design's treatment. This
                  is the only place the picked color paints anything. */}
              <View style={[SECTION, { gap: 13 }]}>
                <SectionLabel>Circle color</SectionLabel>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                  {COLOR_KEYS.map((key) => {
                    const selected = key === colorKey;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => setColorKey(key)}
                        accessibilityRole="button"
                        accessibilityLabel={key}
                        accessibilityState={{ selected }}
                        style={{
                          padding: 3,
                          borderRadius: radius.full,
                          borderWidth: selected ? 2 : 0,
                          borderColor: accent,
                        }}
                      >
                        <View
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: radius.full,
                            backgroundColor: NAMED_COLORS[key],
                            borderWidth: selected ? 1.5 : 0,
                            borderColor: LIGHT.canvas,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {selected ? <Check color="#FFFFFF" size={14} strokeWidth={3} /> : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* In this circle — the current members as a flat list, each row
                  removable in place (owner edit). */}
              <View style={[SECTION, { gap: 14 }]}>
                <SectionLabel right={`${selectedPeople.length}`}>In this circle</SectionLabel>
                {selectedPeople.length === 0 ? (
                  <Text variant="bodySm" style={{ color: LIGHT.textMuted }}>
                    No one added yet.
                  </Text>
                ) : (
                  <View style={{ gap: 12 }}>
                    {selectedPeople.map((p) => (
                      <MemberRow
                        key={p.id}
                        name={p.name}
                        avatarUrl={p.avatarUrl}
                        subtitle={subtitleOf(p)}
                        username={p.username}
                        amberId={p.amberId}
                        onRemove={() => toggleMember(p.id)}
                      />
                    ))}
                  </View>
                )}
              </View>

              {/* Add people — the search field; the tappable contact list is the
                  FlatList body directly below. */}
              <View style={{ paddingTop: 20, gap: 14 }}>
                <SectionLabel right={`${selectedIds.size} selected`} rightAccent>
                  Add people
                </SectionLabel>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    borderWidth: HAIRLINE,
                    borderColor: cl.gold32,
                    borderRadius: radius.full,
                    paddingHorizontal: 16,
                    height: 42,
                  }}
                >
                  <Search color={LIGHT.textMuted} size={16} strokeWidth={2.25} />
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search contacts"
                    placeholderTextColor={LIGHT.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    style={{
                      flex: 1,
                      color: LIGHT.textPrimary,
                      fontFamily: typography.bodyMd.fontFamily,
                      fontSize: 14,
                      padding: 0,
                      height: 42,
                    }}
                  />
                  {searchQuery ? (
                    <Pressable
                      onPress={() => setSearchQuery('')}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Clear search"
                    >
                      <X color={LIGHT.textMuted} size={16} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </FadeInUp>
          }
          ListEmptyComponent={
            <View style={{ paddingTop: spacing.xl, alignItems: 'center' }}>
              <Text variant="bodyMd" style={{ color: LIGHT.textMuted }}>
                {searchQuery ? 'No contacts match.' : 'No contacts yet.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <ContactRow
              person={item}
              selected={selectedIds.has(item.id)}
              accent={accent}
              onToggle={() => toggleMember(item.id)}
            />
          )}
          ListFooterComponent={
            <>
              {!isSearching &&
              !showAllContacts &&
              filteredContacts.length > CONTACTS_PREVIEW ? (
                <Pressable
                  onPress={() => setShowAllContacts(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Load all contacts"
                  hitSlop={8}
                  style={({ pressed }) => ({
                    paddingTop: 14,
                    alignSelf: 'flex-start',
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text
                    variant="bodySm"
                    style={{ color: cl.goldDeep, fontFamily: fonts.bold }}
                  >
                    {`Load all contacts (${filteredContacts.length})`}
                  </Text>
                </Pressable>
              ) : null}

              {isEditing ? (
                <View style={{ paddingTop: 20, gap: 14 }}>
                  <SectionLabel>Circle keeping</SectionLabel>
                  <Pressable
                    onPress={() => void handleExport()}
                    disabled={exporting}
                    accessibilityRole="button"
                    accessibilityLabel="Export transcripts"
                    hitSlop={8}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 3,
                      opacity: exporting ? 0.4 : pressed ? 0.6 : 1,
                    })}
                  >
                    <Text variant="bodyMd" style={{ color: LIGHT.textPrimary }}>
                      {exporting ? 'Preparing…' : 'Export transcripts'}
                    </Text>
                    <Text variant="bodySm" style={{ color: LIGHT.textMuted }}>
                      ›
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleDelete}
                    disabled={saving}
                    accessibilityRole="button"
                    accessibilityLabel="Delete circle"
                    hitSlop={8}
                    style={({ pressed }) => ({
                      alignSelf: 'flex-start',
                      opacity: saving ? 0.4 : pressed ? 0.6 : 1,
                    })}
                  >
                    <Text variant="bodySm" style={{ color: LIGHT.danger }}>
                      Delete circle
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          }
        />
      )}

      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: insets.bottom + spacing.base,
          gap: spacing.md,
        }}
      >
        <Pressable
          onPress={() => void handleSave()}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel={isEditing ? 'Save changes' : 'Create circle'}
          style={({ pressed }) => ({ opacity: !canSave ? 0.5 : pressed ? 0.85 : 1 })}
        >
          <View
            style={{
              height: 52,
              borderRadius: radius.full,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: accent,
              ...elevation.md,
            }}
          >
            <Text
              variant="titleSm"
              style={{ color: ON_COLOR, letterSpacing: 0.725, textAlign: 'center' }}
            >
              {isEditing
                ? saving
                  ? 'Saving…'
                  : 'Save changes'
                : saving
                  ? 'Creating…'
                  : 'Create circle'}
            </Text>
          </View>
        </Pressable>
      </View>
      </>
      )}
    </View>
  );
}

// A section kicker from the design: a small, wide-tracked, neutral (NOT gold)
// uppercase label, with an optional right-aligned note. The note is gold only
// when it marks a live count the user is acting on ("N selected").
function SectionLabel({
  children,
  right,
  rightAccent,
}: {
  children: string;
  right?: string;
  rightAccent?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <Text
        style={{
          fontFamily: fonts.body,
          fontSize: 10.5,
          lineHeight: 14,
          letterSpacing: 1.9,
          textTransform: 'uppercase',
          color: cl.ink42,
        }}
      >
        {children}
      </Text>
      {right != null ? (
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: 11.5,
            lineHeight: 14,
            color: rightAccent ? LIGHT.accentText : LIGHT.textMuted,
          }}
        >
          {right}
        </Text>
      ) : null}
    </View>
  );
}

// A member row in the "In this circle" list: a small avatar, the name over an
// optional subtitle, and (for owned circles) an × that removes them. Read-only
// when `onRemove` is omitted, which is how inbound circles render it.
/**
 * A MEMBER ROW, AND WHETHER IT IS A PERSON OR A CARD.
 *
 * Both, depending on what the server could resolve. A member whose contact card
 * has been linked to an Amber account gets their account name, their avatar,
 * their @username, a marker saying this is a real account, and a tap that opens
 * their profile. A member who is only an address-book entry looks exactly as it
 * did -- name, whatever contact detail is to hand, not tappable, because there
 * is nothing on the other end to open.
 *
 * The marker earns its space. "Sagar Tiwari / @sagar" already implies an
 * account to anyone who knows the convention, but this list mixes the two kinds
 * of member in one column, and the difference between them is the entire point
 * of the screen: one of these people can see the circle and gets notified about
 * it, the other cannot and does not.
 *
 * BOTH amberId AND the tap handler are required before anything routes. A
 * username with no id, or an id with no way to navigate, would render as
 * something that looks tappable and does nothing -- which is worse than a plain
 * row, because it teaches the user the row is broken.
 */
function MemberRow({
  name,
  avatarUrl,
  subtitle,
  username,
  amberId,
  onOpen,
  onRemove,
}: {
  name?: string | null;
  avatarUrl?: string | null;
  subtitle?: string | null;
  username?: string | null;
  amberId?: string | null;
  onOpen?: (amberId: string) => void;
  onRemove?: () => void;
}) {
  const linked = !!amberId;
  const tappable = linked && !!onOpen;
  const detail = linked && username ? `@${username}` : (subtitle ?? null);

  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Avatar name={name ?? undefined} url={avatarUrl ?? undefined} size={34} />
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="bodySm" numberOfLines={1} style={{ color: LIGHT.textPrimary }}>
            {name ?? 'Unknown'}
          </Text>
          {linked ? (
            <CText t="kicker" color={cl.goldKicker} style={{ fontSize: 7.5, letterSpacing: 0.9 }}>
              ON AMBER
            </CText>
          ) : null}
        </View>
        {detail ? (
          <Text
            variant="captionSm"
            numberOfLines={1}
            style={{ color: linked ? cl.goldDeep : LIGHT.textMuted }}
          >
            {detail}
          </Text>
        ) : null}
      </View>
      {tappable && !onRemove ? (
        <ChevronRight color={cl.ink32} size={16} strokeWidth={2} />
      ) : null}
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name ?? 'member'}`}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
        >
          <X color={LIGHT.textMuted} size={18} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );

  if (!tappable) return body;
  return (
    <Pressable
      onPress={() => onOpen!(amberId!)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${name ?? 'this member'}'s profile`}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {body}
    </Pressable>
  );
}

// The Feed/Info switch shown at the top of an existing circle. FEED is the
// shared-note feed (the default); INFO is the circle detail — members + name +
// description + color for owned circles, a read-only view for inbound ones. The
// active tab carries an accent-colored underline (the circle's color when set,
// amber gold otherwise) — the only place this switch applies the accent.
function CircleTabSwitch({
  tab,
  onChange,
  accent,
}: {
  tab: 'feed' | 'info';
  onChange: (t: 'feed' | 'info') => void;
  accent: string;
}) {
  const options: { key: 'feed' | 'info'; label: string }[] = [
    { key: 'feed', label: 'FEED' },
    { key: 'info', label: 'INFO' },
  ];
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: spacing.lg,
        marginHorizontal: spacing.lg,
        marginBottom: spacing.sm,
        borderBottomWidth: HAIRLINE,
        borderBottomColor: LIGHT.hairline,
      }}
    >
      {options.map((opt) => {
        const active = tab === opt.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            accessibilityRole="button"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected: active }}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            {/* The underline hugs the LABEL, not the container — 1px, in the
                circle's accent, sitting over the container hairline. */}
            <View
              style={{
                paddingHorizontal: 1,
                paddingBottom: 11,
                borderBottomWidth: 1,
                borderBottomColor: active ? accent : 'transparent',
                marginBottom: -HAIRLINE,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.body,
                  fontSize: 11.5,
                  lineHeight: 17.8,
                  letterSpacing: 1.84,
                  color: active ? cl.goldDeep : 'rgba(32,30,29,0.42)',
                }}
              >
                {opt.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// CircleEmblem USED TO BE DEFINED HERE and nothing rendered it: the emblem on
// this screen is ChordEmblem, which replaced it. Dead UI kept in the file is
// what eslint had been reporting on every run that never actually ran -- and
// what let a second search bar live invisibly in AskChat. git has it.

// The circle detail header: the circle name as a large serif title, a
// "N people · M new" subtitle (the "new" count preceded by an accent dot — the
// unseen marker), and a small overlapping cluster of member avatars top-right.
// Used by both the owned and inbound detail paths.
function CircleHeader({
  title,
  memberCount,
  newCount,
  avatars,
  accent,
  onBack,
  onSearch,
}: {
  title: string;
  memberCount: number;
  newCount: number;
  avatars: { name?: string | null; url?: string | null }[];
  accent: string;
  onBack: () => void;
  onSearch?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const cluster = avatars.slice(0, 4);
  const peopleLabel = `${memberCount} ${memberCount === 1 ? 'person' : 'people'}`;
  return (
    <View
      style={{
        paddingHorizontal: spacing.lg,
        paddingTop: insets.top + spacing.base,
        paddingBottom: spacing.md,
      }}
    >
      <View
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: radius.full,
              backgroundColor: LIGHT.surface,
              borderWidth: 1,
              borderColor: LIGHT.hairline,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ArrowLeft color={LIGHT.textPrimary} size={20} />
          </View>
        </Pressable>

        {onSearch ? (
          <Pressable
            onPress={onSearch}
            accessibilityRole="button"
            accessibilityLabel="Search transcripts"
            hitSlop={10}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.full,
                backgroundColor: LIGHT.surface,
                borderWidth: 1,
                borderColor: LIGHT.hairline,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Search color={LIGHT.textPrimary} size={20} />
            </View>
          </Pressable>
        ) : null}
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: spacing.md,
          marginTop: spacing.md,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="displayLg" numberOfLines={2} style={{ color: LIGHT.textPrimary }}>
            {title}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.xs,
              marginTop: spacing.xxs,
            }}
          >
            <Text variant="captionSm" style={{ color: LIGHT.textSecondary }}>
              {peopleLabel}
            </Text>
            {newCount > 0 ? (
              <>
                <View
                  style={{ width: 5, height: 5, borderRadius: radius.full, backgroundColor: accent }}
                />
                <Text variant="captionSm" style={{ color: LIGHT.textSecondary }}>
                  {`${newCount} new`}
                </Text>
              </>
            ) : null}
          </View>
        </View>

        {cluster.length > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {cluster.map((p, i) => (
              <View
                key={i}
                style={{
                  marginLeft: i === 0 ? 0 : -12,
                  borderRadius: radius.full,
                  borderWidth: 2,
                  borderColor: LIGHT.canvas,
                }}
              >
                <Avatar name={p.name ?? undefined} url={p.url ?? undefined} size={32} />
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

// The line under a contact's name on a member card. Prefer a handle or email;
// fall back to a capitalized platform label ("Contacts", "iMessage"). Null when
// there's nothing worth showing, so the name sits centered on its own.
function subtitleOf(person: NetworkIdentity): string | null {
  if (person.handle) return person.handle;
  if (person.email) return person.email;
  if (person.platform) return person.platform.charAt(0).toUpperCase() + person.platform.slice(1);
  return null;
}

// A contact row in the "Add people" list. The design draws these as light,
// hairline-separated rows (not cards): a small avatar, the name, and a round
// checkbox that fills with the accent when the contact is in the circle.
function ContactRow({
  person,
  selected,
  accent,
  onToggle,
}: {
  person: NetworkIdentity;
  selected: boolean;
  accent: string;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={person.name}
      accessibilityState={{ selected }}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 11,
          borderBottomWidth: HAIRLINE,
          borderBottomColor: cl.gold12,
        }}
      >
        <Avatar name={person.name} url={person.avatarUrl} size={32} />
        <Text
          variant="bodySm"
          numberOfLines={1}
          style={{ flex: 1, color: selected ? LIGHT.textPrimary : LIGHT.textSecondary }}
        >
          {person.name}
        </Text>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: radius.full,
            borderWidth: selected ? 0 : 1,
            borderColor: LIGHT.hairlineStrong,
            backgroundColor: selected ? accent : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? <Check color="#FFFFFF" size={13} strokeWidth={3} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

// The record button on a circle's feed. A round mic over the list rather than a row
// in it: the feed is a scroll of other people's notes, and an affordance that
// scrolls away with them is one you stop noticing.
// THE RECORD BAR AT THE BOTTOM OF A CIRCLE FEED.
//
// It was a mic FAB pinned to the bottom-right corner: sitting in the page margin, half
// off the edge of where anyone looks, and easy to miss entirely. The thing you do on a
// circle is talk to it, so the control for that belongs across the bottom, under the
// feed, on its own footing.
//
// A hairline above it does the separating. The feed's contentContainer carries matching
// bottom padding, so posts scroll UP PAST this bar and the last one is never hidden
// underneath it — the bar is a floor, not an overlay.
//
// The glyph is a ring with a filled dot, not a microphone. A mic means "input"; a ring
// with a dot means RECORD, which is what actually happens, and it is the same mark used
// on the note surfaces elsewhere in the app. Deep amber, so it reads as the one warm
// thing on a page of cards.
const RECORD_RING = 62;
const RECORD_DOT = 22;
/** Deeper than the circle's own accent on purpose: this is the page's primary action. */
const RECORD_AMBER = '#A8571F';

export const CIRCLE_RECORD_BAR_H = 92;

function RecordIntoCircleButton({ onPress }: { onPress: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      // pointerEvents box-none so the hairline and the padding never eat a tap that
      // was meant for the last post above them.
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingTop: 14,
        paddingBottom: insets.bottom + 14,
        alignItems: 'center',
        borderTopWidth: HAIRLINE,
        borderTopColor: 'rgba(178,98,45,0.18)',
        // Opaque, because the feed scrolls beneath it and transcripts sliding under a
        // translucent bar is unreadable.
        backgroundColor: LIGHT.canvas,
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Record a note for this circle"
        hitSlop={10}
        style={({ pressed }) => ({
          opacity: pressed ? 0.9 : 1,
          transform: [{ scale: pressed ? 0.95 : 1 }],
        })}
      >
        <View
          style={{
            width: RECORD_RING,
            height: RECORD_RING,
            borderRadius: RECORD_RING / 2,
            borderWidth: 2,
            borderColor: RECORD_AMBER,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: RECORD_DOT,
              height: RECORD_DOT,
              borderRadius: RECORD_DOT / 2,
              backgroundColor: RECORD_AMBER,
            }}
          />
        </View>
      </Pressable>
    </View>
  );
}
