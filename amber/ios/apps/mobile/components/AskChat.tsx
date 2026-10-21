import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePendingResolutions, resolvePending, declinePending } from '../lib/pending';
import { PendingConfirmCard } from './PendingConfirmCard';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Check,
  ChevronRight,
  ExternalLink,
  Globe,
  Users,
  UserPlus,
  PenLine,
  Plus,
  Search as SearchIcon,
  Send,
  SquarePen,
} from 'lucide-react-native';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { VoiceNoteRecorder } from './VoiceNoteRecorder';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import { getMyMessageAudio } from '../lib/noteMedia';
import { useQueryClient } from '@tanstack/react-query';
import { captureContactNote } from '../lib/contactNotes';
import {
  publishAskBusy,
  registerAskStopper,
  registerAskSubmitter,
} from '../lib/askBridge';
import { PEOPLE_BAR_SIDE, PEOPLE_BAR_H, peopleBarBottom } from '../lib/peopleBar';
// The bar's words come from the one mode table now, not from a pair of loose
// constants next to its geometry.
import { useIdleReset } from '../lib/useIdleReset';
import { haptics } from './haptics';
import type { CapturedItem, ClarifyCandidate, Suggestion, WebPerson } from '../lib/chat';
import { LIGHT } from '../lib/theme';
import { elevation, fonts, radius, spacing } from '../lib/tokens';
import { useChat, type Turn } from '../lib/ChatContext';
import { useReducedMotion } from './useReducedMotion';
import {
  parseAndScheduleReminders,
  reminderConfirmationText,
  scheduleFailureText,
} from '../lib/reminders';
import { toast } from '../lib/toast';
import Svg, { Circle as SvgCircle } from 'react-native-svg';
import { ChordEmblem } from './ChordEmblem';
import { medhaIdErrorCopy } from '../lib/medhaId';
import {
  clearCirclesCache,
  createCircle,
  deleteCircle,
  leaveCircle,
  setCircleMembers,
  useCircles,
} from '../lib/circles';
import { NAMED_COLORS } from '../lib/circleColors';
import { resolveAnswerText } from '../lib/peoplerank';
import ReAnimated, { useAnimatedStyle } from 'react-native-reanimated';
import { useKeyboardLift } from '../lib/useKeyboardLift';
import { RichAnswer } from './RichAnswer';
import { PlaceCards } from './PlaceCard';
import { NoteSharingModal } from './NoteSharingModal';
import { SaveWebPersonModal } from './SaveWebPersonModal';

// A real, light-themed chat for the People "Ask" tab. It talks like Claude with
// access to your contacts: multi-turn, formatted answers, tappable contact
// cards, and a composer that lives at the bottom like a messages app. Tapping a
// card keeps the conversation going instead of leaving the thread.

function contactInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Minimal, readable markdown: paragraphs, "- " bullets, and **bold** inline.
type CardPerson = { id: string; name: string; company?: string; title?: string; phone?: string };

// Tapping the card is the primary action (open the profile for people rows, or
// resolve for a clarify candidate). The chevron is a visual affordance.
function ContactCard({ person, onPress }: { person: CardPerson; onPress: () => void }) {
  const subtitle =
    [person.company, person.title].filter(Boolean).join(' · ') ||
    person.phone ||
    'In your contacts';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={person.name}>
      {({ pressed }) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            padding: 13,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: LIGHT.hairline,
            backgroundColor: pressed ? LIGHT.surfaceSoft : LIGHT.surface,
          }}
        >
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              backgroundColor: LIGHT.chipBg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="captionSm" style={{ color: LIGHT.chipText }}>
              {contactInitials(person.name)}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="titleMd" numberOfLines={1} style={{ color: LIGHT.textPrimary }}>
              {person.name}
            </Text>
            <Text variant="captionSm" numberOfLines={1} style={{ color: LIGHT.textSecondary, marginTop: 2 }}>
              {subtitle}
            </Text>
          </View>
          <ChevronRight size={18} color={LIGHT.textMuted} strokeWidth={2} />
        </View>
      )}
    </Pressable>
  );
}

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

// Read a recorded clip into base64 for batch transcription.
// Away this long and coming back should feel like a fresh start rather than
// resuming a conversation you have forgotten having.
const IDLE_CLEAR_MS = 10 * 60_000;

// A people answer opens with three cards and reveals ten at a time. Three is
// enough to recognize the answer without burying the reply and the composer.
const PEOPLE_FIRST_PAGE = 3;
const PEOPLE_PAGE_STEP = 10;

function Chip({
  label,
  onPress,
  icon,
  emphasis = false,
}: {
  label: string;
  onPress: () => void;
  icon?: React.ReactNode;
  /** The chip that IS the answer's next step, rather than one option among several. */
  emphasis?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          paddingHorizontal: 15,
          paddingVertical: 10,
          borderRadius: radius.full,
          borderWidth: 1,
          borderColor: emphasis ? 'rgba(140,73,26,0.45)' : 'rgba(255,255,255,0.6)',
          backgroundColor: emphasis ? 'rgba(178,98,45,0.10)' : 'rgba(255,255,255,0.5)',
        }}
      >
        {icon}
        <Text variant="buttonSm" style={{ color: emphasis ? '#8C491A' : LIGHT.chipText }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

// The chips that are the answer's actual next move rather than one idea among
// several: getting out of a dead end, handing the answer to someone, acting on a
// name the answer just surfaced. They read differently because they ARE different.
const EMPHASIZED_CHIPS = new Set([
  'web_search',
  'share_note',
  'draft_outreach',
  'research_web',
  // Both of these MAKE something rather than asking something: a circle that
  // outlives the conversation, and a fact written onto a person. They should not
  // look like one more thing to tap and read.
  'create_circle',
  'add_note',
]);
const CHIP_ICON: Partial<Record<Suggestion['type'], React.ReactNode>> = {
  web_search: <Globe size={14} color="#8C491A" strokeWidth={2} />,
  share_note: <Send size={14} color="#8C491A" strokeWidth={2} />,
  draft_outreach: <PenLine size={14} color="#8C491A" strokeWidth={2} />,
  research_web: <SearchIcon size={14} color="#8C491A" strokeWidth={2} />,
  create_circle: <Users size={14} color="#8C491A" strokeWidth={2} />,
  add_note: <SquarePen size={14} color="#8C491A" strokeWidth={2} />,
};

// PEOPLE FOUND ON THE OPEN WEB, as cards you can actually open.
//
// This exists because "list out 5 VPs of finance in NYC" came back as prose with no
// names you could check — the model either hedged or would have had to invent them.
// Every field on these cards is parsed from the person's own LinkedIn profile page
// server-side, never summarized by a model, so a card cannot say something the page
// did not. Tapping one opens the profile, which is the whole point: the answer is
// verifiable or it is worthless.
//
// Deliberately NOT the same component as ContactCard. That one means "someone in your
// address book" and tapping it opens their Amber profile; these are strangers on the
// internet and tapping them leaves the app. Making them look identical would be lying
// about which is which.
/**
 * A PROFILE THAT IS ALREADY ONE OF HIS CONTACTS.
 *
 * "Since I already have that contact, it should just be shown to me as something
 *  I already have, and it should offer and be like: should I make a text to talk
 *  about your specific request?"
 *
 * So: no add button -- there is nothing to add, and offering it invites a
 * duplicate. Tapping the card opens the person he already has, and the one
 * action offered is the one that moves the thing forward, which is writing to
 * them about the thing he just asked about. The LinkedIn page is still one tap
 * away, because for this case it is a reference rather than the destination.
 */
function KnownWebPersonCard({
  person,
  onOpenPerson,
  onAsk,
}: {
  person: WebPerson;
  onOpenPerson: (id: string) => void;
  onAsk: (query: string) => void;
}) {
  const id = person.existingContactId as string;
  const name = person.existingContactName || person.name;
  const detail = [person.title, person.company].filter(Boolean).join(' · ');
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onPress={() => onOpenPerson(id)}
        accessibilityRole="button"
        accessibilityLabel={`${name}, already in your contacts. Opens their card.`}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            padding: 13,
            borderRadius: radius.lg,
            borderWidth: 1,
            // Solid rather than the dashed-stranger treatment: this is a card he
            // owns, and it should read like the rest of his people.
            borderColor: 'rgba(140,73,26,0.28)',
            backgroundColor: 'rgba(255,255,255,0.86)',
          }}
        >
          <Avatar name={name} size={40} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="titleMd" numberOfLines={1} style={{ color: LIGHT.textPrimary }}>
              {name}
            </Text>
            <Text
              variant="captionSm"
              numberOfLines={1}
              style={{ color: LIGHT.textSecondary, marginTop: 2 }}
            >
              {detail ? `In your contacts · ${detail}` : 'In your contacts'}
            </Text>
          </View>
          <ChevronRight size={18} color={LIGHT.textMuted} strokeWidth={2} />
        </View>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Chip
          label={`Draft a message to ${firstNameOf(name)}`}
          onPress={() =>
            onAsk(`Draft a short message to ${name} about what I just asked for.`)
          }
        />
        {/^https?:\/\//i.test(person.url) ? (
          <Chip
            label="Open LinkedIn"
            onPress={() => void Linking.openURL(person.url).catch(() => {})}
          />
        ) : null}
      </View>
    </View>
  );
}

function WebPeopleCards({
  people,
  ask,
  onSave,
  onOpenPerson,
  onAsk,
}: {
  people: WebPerson[];
  /** The clause of the question this section answers, in the user's own words. */
  ask?: string;
  onSave: (p: WebPerson) => void;
  onOpenPerson: (id: string) => void;
  onAsk: (query: string) => void;
}) {
  // TWO KINDS OF PERSON, TWO HEADINGS, AND THE ONES HE HAS COME FIRST.
  //
  // "Here are the people you were looking for... One of your contacts actually
  //  fits this perfectly, so I will show you their contact card first. The other
  //  contacts that you don't have, I will show you in a way that you can
  //  actually add their contacts."
  //
  // The server marks and orders them (lib/web-people-known.js); this draws the
  // boundary so the two claims are never mixed in one list.
  const known = people.filter((p) => p.existingContactId);
  const strangers = people.filter((p) => !p.existingContactId);
  const heading = (text: string, sub?: string) => (
    <View style={{ gap: 2 }}>
      <Text variant="captionSm" style={{ color: LIGHT.textSecondary, letterSpacing: 1 }}>
        {text}
      </Text>
      {sub ? (
        <Text variant="captionSm" style={{ color: LIGHT.textMuted }} numberOfLines={2}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
  return (
    <View style={{ gap: 8 }}>
      {known.length > 0
        ? heading(
            `ALREADY IN YOUR CONTACTS · ${known.length}`,
            ask ? `For: ${ask}` : undefined,
          )
        : null}
      {known.map((p) => (
        <KnownWebPersonCard key={p.existingContactId} person={p} onOpenPerson={onOpenPerson} onAsk={onAsk} />
      ))}
      {strangers.length > 0
        ? heading(
            `FOUND ON LINKEDIN · ${strangers.length}`,
            known.length === 0 && ask ? `For: ${ask}` : undefined,
          )
        : null}
      {strangers.map((p, i) => {
        const detail = [p.title, p.company].filter(Boolean).join(' · ');
        return (
          <Pressable
            key={`${p.url}-${i}`}
            onPress={() => {
              if (!/^https?:\/\//i.test(p.url)) return;
              void Linking.openURL(p.url).catch(() => {});
            }}
            accessibilityRole="link"
            accessibilityLabel={`${p.name}${detail ? `, ${detail}` : ''}. Opens LinkedIn.`}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                padding: 13,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: 'rgba(32,30,29,0.12)',
                backgroundColor: 'rgba(255,255,255,0.62)',
              }}
            >
              {/* Initials rather than an avatar: LinkedIn's profile images are not
                  hotlinkable, and a broken image frame on every card looks worse than
                  no image at all. */}
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: 'rgba(140,73,26,0.35)',
                  backgroundColor: 'rgba(178,98,45,0.08)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text variant="captionSm" style={{ color: '#8C491A' }}>
                  {contactInitials(p.name)}
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="titleMd" numberOfLines={1} style={{ color: LIGHT.textPrimary }}>
                  {p.name}
                </Text>
                {detail ? (
                  <Text
                    variant="captionSm"
                    numberOfLines={1}
                    style={{ color: LIGHT.textSecondary, marginTop: 2 }}
                  >
                    {detail}
                  </Text>
                ) : p.snippet ? (
                  <Text
                    variant="captionSm"
                    numberOfLines={1}
                    style={{ color: LIGHT.textSecondary, marginTop: 2 }}
                  >
                    {p.snippet}
                  </Text>
                ) : null}
              </View>
              {/* SAVE, next to the open-profile affordance. Tapping the card opens
                  LinkedIn; this keeps them. Two separate targets rather than one
                  card that guesses, because "look at them" and "add them to my
                  address book" are not the same intent and both are common here. */}
              <Pressable
                onPress={() => onSave(p)}
                accessibilityRole="button"
                accessibilityLabel={`Save ${p.name} to your contacts`}
                hitSlop={10}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: 'rgba(140,73,26,0.35)',
                    backgroundColor: 'rgba(178,98,45,0.08)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <UserPlus size={15} color="#8C491A" strokeWidth={2.1} />
                </View>
              </Pressable>
              <ExternalLink size={16} color={LIGHT.textMuted} strokeWidth={2} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// The sources behind a web-grounded answer. Numbered to match the [1] / [2] marks
// in the text, host-only because a full URL wraps to three lines and tells the
// reader less than "nytimes.com" does. Tapping opens the real page — a citation
// you cannot check is decoration.
function SourceChips({ sources }: { sources: { title: string; url: string }[] }) {
  const host = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url.replace(/^https?:\/\//, '').split('/')[0];
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <Text variant="captionSm" style={{ color: LIGHT.textSecondary, letterSpacing: 1 }}>
        SOURCES
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {sources.map((src, i) => (
          <Pressable
            key={`${src.url}-${i}`}
            onPress={() => {
              // SCHEME CHECK BEFORE openURL. These URLs come from a third-party
              // search API, and openURL will happily hand a non-http scheme to
              // whatever app claims it — including this one, which would turn a
              // citation into a deep link into the user's own account. Only http(s)
              // is a source you can read.
              if (!/^https?:\/\//i.test(src.url)) return;
              void Linking.openURL(src.url).catch(() => {});
            }}
            accessibilityRole="link"
            accessibilityLabel={src.title || host(src.url)}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 11,
                paddingVertical: 7,
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: 'rgba(32,30,29,0.12)',
                backgroundColor: 'rgba(255,255,255,0.6)',
              }}
            >
              <Text
                variant="captionSm"
                style={{ color: '#8C491A', fontVariant: ['tabular-nums'] }}
              >
                {i + 1}
              </Text>
              <Text variant="captionSm" style={{ color: LIGHT.textSecondary }}>
                {host(src.url)}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// One person's card plus its quick actions, reused for the lead person and each
// of the others below the divider so they render identically.
function PersonBlock({
  person,
  onOpenPerson,
  onAsk,
  onAddNote,
}: {
  person: CardPerson;
  onOpenPerson: (id: string) => void;
  onAsk: (query: string) => void;
  onAddNote: (person: { id: string; name: string }) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <ContactCard person={person} onPress={() => onOpenPerson(person.id)} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingLeft: 2 }}>
        <Chip
          label={`Tell me about ${firstNameOf(person.name)}`}
          onPress={() => onAsk(`tell me about ${person.name}`)}
        />
        <Chip
          label="Add a note"
          onPress={() => onAddNote({ id: person.id, name: person.name })}
        />
      </View>
    </View>
  );
}

// A confirmation that Amber logged something to a person: their face, what was
// logged, and a checkmark. Each one gives a little haptic as it appears, so you
// feel it register. Tapping opens the person if it resolved to a real contact.
function CapturedCard({
  item,
  index,
  silent,
  onOpenPerson,
}: {
  item: CapturedItem;
  index: number;
  /** History. Show the card, do not buzz -- see below. */
  silent?: boolean;
  onOpenPerson: (id: string) => void;
}) {
  // ONE BUZZ PER NOTE. This used to fire per card, 140ms apart -- and one real
  // anecdote produces seven cards, so the phone buzzed seven times in a row
  // while they cascaded in. The confirmation is that the note was filed, which
  // happened once.
  //
  // AND ONLY WHEN IT IS ACTUALLY BEING FILED. A replayed turn is a note being
  // READ, and buzzing at the reader says something just happened when nothing
  // did. That mattered more than it sounds: the Home overlay re-polls the
  // conversation while it waits for a reply, and each poll used to rebuild the
  // transcript from scratch, so this fired again on every tick.
  useEffect(() => {
    if (index !== 0 || silent) return;
    const id = setTimeout(() => haptics.success(), 120);
    return () => clearTimeout(id);
  }, [index, silent]);

  const displayName =
    item.name ??
    (item.participantNames && item.participantNames.length > 0
      ? item.participantNames.join(', ')
      : 'Someone');

  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        padding: 14,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: LIGHT.hairline,
        backgroundColor: LIGHT.surface,
        ...elevation.sm,
      }}
    >
      <Avatar name={displayName} size={40} />
      <View style={{ flex: 1 }}>
        <Text variant="titleMd" numberOfLines={1} style={{ color: LIGHT.textPrimary }}>
          {displayName}
        </Text>
        {item.text ? (
          <Text variant="captionSm" numberOfLines={2} style={{ color: LIGHT.textSecondary, marginTop: 2 }}>
            {item.text}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: LIGHT.accentText,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Check color="#FFFFFF" size={15} strokeWidth={3} />
      </View>
    </View>
  );

  if (!item.contactId) return body;
  return (
    <Pressable
      onPress={() => onOpenPerson(item.contactId as string)}
      accessibilityRole="button"
      accessibilityLabel={displayName}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      {body}
    </Pressable>
  );
}

// Rotating status line shown while a reply is awaited / streaming. Cycles a
// small set of tasteful phrases with a subtle cross-fade (Claude-style) instead
// of a static "Thinking…". The moment the first token lands the caller swaps
// this out for the answer (AskTurn renders RichAnswer once `answer` exists),
// so this never competes with real text. Lightweight: one interval + one
// Animated opacity, both torn down on unmount. Honors Reduce Motion by staying
// on a single static phrase with no interval or fade.
const THINKING_PHRASES = [
  'Thinking…',
  'Pondering…',
  'Connecting the dots…',
  'Reading the room…',
  'Pulling the thread…',
];
const THINKING_INTERVAL_MS = 1800;
const THINKING_FADE_MS = 260;

/**
 * THE PROGRESS OF A MULTI-PART ANSWER.
 *
 * "It just keeps pondering and doing nothing... give me progress bars and show
 * what it's doing. When you run a command and use 8 tools and search this and
 * that, it should output stuff like that so the user knows what's going on."
 *
 * So: the steps the server named, each with a spinner or a tick, a thin bar
 * across the top of them, and the server's own line about the wait underneath.
 * Every value here comes off the wire -- nothing is invented client-side, so
 * the bar cannot claim progress that has not happened.
 *
 * It stays on screen after the answer arrives only until the answer is
 * finished, then collapses to a single settled line: while you are reading, a
 * list of completed steps is clutter.
 */
function PlanProgress({
  steps,
  stages,
  note,
  settled,
}: {
  steps: { key: string; label: string; ask?: string }[];
  stages?: Record<string, 'start' | 'done'>;
  note?: string;
  settled?: boolean;
}) {
  const done = steps.filter((s) => stages?.[s.key] === 'done').length;
  const frac = steps.length > 0 ? done / steps.length : 0;

  // ── SETTLED IS STILL THE SAME OBJECT, FINISHED ────────────────────────────
  //
  // "It showed them first, but it didn't execute and keep that there... it just
  //  kind of appeared once and then stopped working and then didn't appear
  //  anymore. It should consistently be an actual thing that is a way for you to
  //  see the progress of the answer."
  //
  // It was replaced by a bare sentence -- "3 parts · people on the web, the web,
  // places" -- which does not read as the progress row having completed. It
  // reads as the progress row being gone. So the finished state keeps the frame
  // and the bar, full, with a tick and the parts named: the same thing he
  // watched, in its done state, still on screen above the answer.
  if (settled) {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 9,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: LIGHT.hairline,
          backgroundColor: LIGHT.surfaceSoft,
        }}
      >
        <Check size={13} color={LIGHT.accentText} strokeWidth={2.6} />
        <Text
          variant="captionSm"
          numberOfLines={1}
          style={{ color: LIGHT.textSecondary, flex: 1 }}
        >
          {`${steps.length} parts · ${steps.map((s) => s.label.toLowerCase()).join(', ')}`}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        gap: 9,
        padding: 12,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: LIGHT.hairline,
        backgroundColor: LIGHT.surfaceSoft,
      }}
    >
      {/* HOW MANY OF HOW MANY, in words as well as in the bar. A bar alone does
          not say whether the missing part is one of two or one of five, and
          that is the question somebody watching it is actually asking. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="captionSm" style={{ color: LIGHT.textSecondary, letterSpacing: 1 }}>
          {`WORKING · ${done} OF ${steps.length}`}
        </Text>
      </View>

      {/* THE BAR. Fraction of steps finished, not a timer: a bar that moves on
          a clock is a lie about progress, and this one only moves when
          something has actually landed. */}
      <View
        style={{
          height: 3,
          borderRadius: 2,
          backgroundColor: LIGHT.hairlineStrong,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${Math.round(Math.max(0.04, frac) * 100)}%`,
            height: '100%',
            borderRadius: 2,
            backgroundColor: LIGHT.accentText,
          }}
        />
      </View>

      {steps.map((s) => {
        const state = stages?.[s.key];
        return (
          <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {state === 'done' ? (
              <Check size={13} color={LIGHT.accentText} strokeWidth={2.6} />
            ) : (
              <ActivityIndicator size="small" color={LIGHT.textSecondary} />
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                variant="bodySm"
                style={{
                  color: state === 'done' ? LIGHT.textPrimary : LIGHT.textSecondary,
                  fontSize: 13.5,
                }}
              >
                {s.label}
              </Text>
              {/* The clause this step is answering. On a three-part question the
                  category names alone ("People on the web", "Places") do not say
                  which part of what he asked is being worked on. */}
              {s.ask ? (
                <Text
                  variant="captionSm"
                  numberOfLines={1}
                  style={{ color: LIGHT.textMuted, fontSize: 11.5 }}
                >
                  {s.ask}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}

      {note ? (
        <Text variant="captionSm" style={{ color: LIGHT.textSecondary, opacity: 0.85 }}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

function ThinkingStatus() {
  const reduceMotion = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;
  // HOW LONG IT HAS BEEN, because a rotating phrase says "alive" and says
  // nothing about "how long is this going to take". A question that needs the
  // web, the user's own people AND a ranking pass genuinely takes twenty
  // seconds, and five cheerful words on a loop for twenty seconds reads as a
  // hang -- which is exactly what it was reported as.
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setWaited((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const longWait =
    waited >= 30
      ? 'Still going — you can leave this and come back to it.'
      : waited >= 12
        ? 'Still working. This one needs a few searches.'
        : null;

  useEffect(() => {
    if (reduceMotion) return;
    const interval = setInterval(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: THINKING_FADE_MS,
        useNativeDriver: true,
      }).start(() => {
        setIdx((i) => (i + 1) % THINKING_PHRASES.length);
        Animated.timing(opacity, {
          toValue: 1,
          duration: THINKING_FADE_MS,
          useNativeDriver: true,
        }).start();
      });
    }, THINKING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [opacity, reduceMotion]);

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <ActivityIndicator size="small" color={LIGHT.accentText} />
        <Animated.View style={{ opacity }}>
          <Text variant="bodySm" style={{ color: LIGHT.textSecondary }}>
            {reduceMotion ? THINKING_PHRASES[0] : THINKING_PHRASES[idx]}
          </Text>
        </Animated.View>
      </View>
      {longWait ? (
        <Text variant="bodySm" style={{ color: LIGHT.textSecondary, fontSize: 12.5, opacity: 0.8 }}>
          {longWait}
        </Text>
      ) : null}
    </View>
  );
}

function AskTurn({
  turn,
  isLast,
  onAsk,
  onAddNote,
  onOpenPerson,
  onSuggestion,
  onSaveWebPerson,
  onClarify,
  onSoftYes,
  onSoftNo,
  onRetry,
}: {
  turn: Turn;
  /** Only the newest turn may show a spinner for a reply that has not landed. */
  isLast: boolean;
  onAsk: (query: string) => void;
  onAddNote: (person: { id: string; name: string }) => void;
  onOpenPerson: (id: string) => void;
  onSuggestion: (s: Suggestion) => void;
  onSaveWebPerson: (p: WebPerson) => void;
  onClarify: (turnId: string, candidate: ClarifyCandidate, pendingId?: string) => void;
  onSoftYes: (turnId: string, contact: { id: string; name: string }, pendingId?: string) => void;
  onSoftNo: (turnId: string, pendingId?: string) => void;
  onRetry: (query: string) => void;
}) {
  // The thread this turn is in, for playing back a spoken follow-up's clip. Read
  // from the context rather than passed down: it is a ref read (see ChatContext),
  // stable across renders, and threading it through every AskTurn prop would
  // change this component's signature for one optional player.
  const { getConversationId } = useChat();
  // THE CLAUSE EACH SECTION ANSWERS, from the plan the server sent.
  //
  // "Both of the complex queries that I've given so far can clearly be separated
  //  into three sections... It should be clearly separated out so the user can
  //  say: okay, this is the answer to that question."
  //
  // A category heading ("Places") says what kind of thing a section holds, not
  // which part of a three-part question it answers. This is that missing half,
  // and it is the user's own words rather than a paraphrase.
  const askFor = useCallback(
    (key: string) => (turn.plan ?? []).find((s) => s.key === key)?.ask,
    [turn.plan],
  );
  // Read people/answer from the result as soon as they exist, not only once the
  // whole turn settles, so cards appear immediately and the answer streams in.
  // ONE ROW PER PERSON PER TURN. A contact confirmed in the LOGGED section does
  // not also need a suggestion card below saying they are "in your contacts" --
  // that is what showed Sagar twice for a single note. The LOGGED card is the
  // stronger statement (it says the note was filed to them), so it wins and the
  // duplicate drops out of the list.
  const capturedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of turn.captured ?? []) {
      if (c.contactId) ids.add(String(c.contactId));
      for (const id of c.participantIds ?? []) ids.add(String(id));
    }
    return ids;
  }, [turn.captured]);

  /**
   * ONE CARD PER PERSON, NOT ONE PER SIGNAL.
   *
   * The extractor splits a paragraph into as many signals as it finds -- one real
   * anecdote about four people produced SIX, and seven LOGGED cards, with Sagar
   * in four of them and Caleb in two. Each card fired its own haptic 140ms after
   * the last, so a single note buzzed seven times and filled the screen with
   * near-duplicates.
   *
   * The signals are right; the presentation was wrong. A person is the unit the
   * reader cares about, so the cards collapse per contact and the count rides
   * along ("3 things"). Facts about the owner are dropped entirely -- they are
   * stored, but a card telling you that you were mentioned in your own note is
   * noise.
   */
  const loggedPeople = useMemo(() => {
    const byId = new Map<string, { id: string | null; name: string; lines: string[] }>();
    for (const c of turn.captured ?? []) {
      if (c.isSelf) continue;
      const names = c.participantNames && c.participantNames.length > 0
        ? c.participantNames
        : c.name
          ? [c.name]
          : [];
      const ids = c.participantIds && c.participantIds.length > 0
        ? c.participantIds
        : c.contactId
          ? [c.contactId]
          : [];
      names.forEach((nm, i) => {
        const id = ids[i] ?? ids[0] ?? null;
        const key = id ?? nm;
        const entry = byId.get(key) ?? { id, name: nm, lines: [] };
        if (c.text && !entry.lines.includes(c.text)) entry.lines.push(c.text);
        byId.set(key, entry);
      });
    }
    return [...byId.values()];
  }, [turn.captured]);
  const allPeople = useMemo(
    () => (turn.result?.people ?? []).filter((p) => !capturedIds.has(String(p.id))),
    [turn.result?.people, capturedIds],
  );
  // THREE CARDS, THEN ASK. A 47-match answer used to render every card it was
  // sent, which buried the reply and the composer under a wall of contacts — and
  // when the server paged, it silently showed a page as if it were everything.
  // Start at three, reveal in tens, and say the real total so the number in the
  // list and the number in the sentence never disagree.
  const [shownCount, setShownCount] = useState(PEOPLE_FIRST_PAGE);
  const people = allPeople.slice(0, shownCount);
  // The sections replace the flat list when they exist. Computed once so the
  // two renderers below cannot disagree about which one is showing.
  const sections = turn.groups && turn.groups.length > 0 ? turn.groups : null;
  // What matched, which can exceed what was sent: the server pages at 60.
  const matchedTotal = Math.max(turn.peopleTotal ?? allPeople.length, allPeople.length);
  const hiddenLocally = allPeople.length - people.length;
  const beyondPage = matchedTotal - allPeople.length;
  const answer = turn.result ? resolveAnswerText(turn.result) : '';
  // Show a thinking state in the answer slot while the model is still producing
  // text, so the cards never sit above an empty gap.
  // CARDS WAIT FOR THE ANSWER TO FINISH.
  //
  // People cards and LOGGED confirmations used to mount while tokens were still
  // arriving, so every few hundred milliseconds the paragraph the reader was on
  // jumped down the screen. Nothing about a card depends on the answer, which is
  // exactly why it can wait for it: question first, then the answer, then the
  // cards, then the actions.
  const cardsReady =
    turn.status !== 'loading' && turn.result?.answerStatus !== 'streaming';

  // A SPINNER HAS TO BE ABLE TO STOP.
  //
  // `|| turn.replayed` used to be unconditional, which made it a spinner with no
  // terminal state: a stored turn whose answer did not come back showed
  // "Thinking…" for as long as the note stayed open, and a thread of five such
  // turns showed five of them at once, forever. That is not a loading state, it
  // is a stuck one, and it read as the app hanging.
  //
  // A replayed turn is finished by definition -- the only reason to wait on one
  // is the narrow case the overlay polls for: a note opened while its reply was
  // still being written. So the wait is bounded to the same window the poll runs
  // for (HomeAskOverlay: 20 tries, 1.5s apart), and only the newest turn can be
  // the one still generating. Every earlier turn shows what it has.
  const [replayWaitOver, setReplayWaitOver] = useState(false);
  useEffect(() => {
    // THE TIMER RUNS FOR EVERY REPLAYED TURN, not only the newest one.
    //
    // It was gated on `isLast`, and a turn that stopped being last while the
    // timer had not yet fired kept `replayWaitOver` false forever -- so the
    // condition that ends the wait could never become true and the spinner had
    // no terminal state. That is a spinner that spins for ten minutes, which is
    // what was reported. The gate belongs on what is DRAWN, not on the clock.
    if (!turn.replayed) return undefined;
    const id = setTimeout(() => setReplayWaitOver(true), 20000);
    return () => clearTimeout(id);
  }, [turn.replayed, turn.id]);

  const nothingElseToShow =
    !answer &&
    turn.status !== 'error' &&
    (!turn.captured || turn.captured.length === 0) &&
    (turn.clarify?.length ?? 0) === 0;
  const showThinking =
    nothingElseToShow &&
    (turn.status === 'loading' ||
      turn.result?.answerStatus === 'streaming' ||
      // A just-opened note whose reply hasn't landed yet: show the loader
      // instead of an empty gap under the transcript -- but only the newest
      // turn, and only while the overlay is still polling for it.
      (!!turn.replayed && isLast && !replayWaitOver));
  // ── AND WHEN THE WAIT IS OVER AND THERE IS STILL NOTHING ──────────────────
  //
  // A reopened turn with no answer is either still generating -- covered above,
  // and it lands within seconds -- or the answer is genuinely gone: the
  // assistant row failed to write and this device has no cached copy either
  // (see lib/turnCache.ts, which now fills that hole almost always).
  //
  // Before this, that state rendered NOTHING once the wait elapsed, and until
  // then a spinner. Neither is honest and neither can be acted on. One line and
  // a retry is: the question is still on screen, so asking again is one tap.
  const answerLost = nothingElseToShow && !!turn.replayed && !showThinking;

  return (
    <View style={{ gap: spacing.md }}>
      <View
        style={{
          alignSelf: 'flex-end',
          maxWidth: '84%',
          backgroundColor: LIGHT.accentText,
          borderRadius: 20,
          paddingHorizontal: 15,
          paddingVertical: 11,
        }}
      >
        {/* SPOKEN, AND THE RECORDING IS HERE.
            "It should save the voice note in there as well, but it should also
            transcribe it under." So: the player on top, the words underneath,
            in the user's own bubble -- the same pairing a voice message in a DM
            already uses, and the same component drawing it.
            The signed URL is fetched on first play, never held: it expires in
            minutes by design. Duration and waveform came back with the thread
            (or straight off the recorder on a live turn), so the bar draws at
            its real length before anything is fetched. */}
        {turn.audio ? (
          <View style={{ marginBottom: 8 }}>
            <VoiceNotePlayer
              fetchAudio={async () => {
                const cid = getConversationId();
                if (!cid || !turn.audio) return null;
                const res = await getMyMessageAudio(cid, turn.audio.messageId);
                return res.ok
                  ? {
                      playbackUrl: res.data.playbackUrl,
                      durationMs: res.data.durationMs,
                      peaks: res.data.peaks,
                    }
                  : null;
              }}
              durationMs={turn.audio.durationMs}
              peaks={turn.audio.peaks}
              // On the filled bubble, so all three colors are re-pitched
              // against it rather than against the page: white for the played
              // run and the button, translucent white for what is left, and a
              // legible timer. The defaults are tuned for terracotta on paper
              // and would be invisible here.
              accent="#FFFFFF"
              rest="rgba(255,255,255,0.42)"
              timerColor="rgba(255,255,255,0.78)"
            />
          </View>
        ) : null}
        <Text variant="bodyMd" style={{ color: '#FFFFFF' }}>
          {turn.query}
        </Text>
      </View>

      {answerLost ? (
        <View style={{ gap: 6 }}>
          <Text variant="bodyMd" style={{ color: LIGHT.textSecondary }}>
            That answer did not save. Ask it again and I will redo it.
          </Text>
          <Pressable onPress={() => onRetry(turn.query)} hitSlop={8}>
            <Text variant="buttonSm" style={{ color: LIGHT.accentText }}>
              Ask again
            </Text>
          </Pressable>
        </View>
      ) : null}

      {turn.status === 'error' ? (
        <View style={{ gap: 4 }}>
          <Text variant="bodyMd" style={{ color: LIGHT.textSecondary }}>
            {turn.errorMsg ?? 'Something went wrong.'}
          </Text>
          <Pressable onPress={() => onRetry(turn.query)} hitSlop={8}>
            <Text variant="buttonSm" style={{ color: LIGHT.accentText }}>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: spacing.md }}>
          {/* THE QUESTIONS ARE NOT RENDERED HERE ANY MORE.
              A turn used to draw its own clarify and soft-confirm rows from the
              stream, while the STILL TO CONFIRM strip above drew the same rows
              from the server's queue. Which one you got depended on whether you
              were looking at a live turn or a reopened note, so one question
              wore two different faces -- and when both were on screen it read as
              being asked twice. There is one queue and one component now; see
              the strip above and components/PendingConfirmCard. */}
          {/* WHAT IT IS DOING, WHILE IT IS DOING IT.
              Only on a question with more than one part, which is the only case
              that ever looked like a hang. It stays visible while the parts land
              so the user can watch three ticks appear instead of guessing, and
              disappears once everything is done and the answer is written. */}
          {turn.plan && turn.plan.length > 1 ? (
            <PlanProgress
              steps={turn.plan}
              stages={turn.stages}
              note={turn.stageNote ?? turn.planNote}
              settled={turn.status === 'done' && !!answer}
            />
          ) : null}

          {answer ? (
            // Tables, links, numbered lists and tappable [n] citations. Sources
            // are threaded in so a citation resolves to the page it came from.
            <RichAnswer text={answer} sources={turn.sources} />
          ) : showThinking && !(turn.plan && turn.plan.length > 1) ? (
            // The plan card above already says more than "Pondering…" can, and
            // two live status blocks in a row read as two things happening.
            <ThinkingStatus />
          ) : null}

          {/* LABELED SECTIONS, when the answer separates people by what they are
              for. Rendered before the flat list and in place of it — an answer
              that groups its people never also emits an ungrouped set. */}
          {cardsReady && loggedPeople.length > 0 ? (
            <View style={{ gap: 10 }}>
              <Text variant="captionSm" style={{ color: LIGHT.textSecondary, letterSpacing: 1 }}>
                LOGGED
              </Text>
              {loggedPeople.map((e, i) => (
                <CapturedCard
                  key={`logged-${e.id ?? e.name}`}
                  index={i}
                  silent={!!turn.replayed}
                  onOpenPerson={onOpenPerson}
                  item={{
                    contactId: e.id,
                    name: e.name,
                    text:
                      e.lines.length > 1
                        ? `${e.lines[0]}  ·  +${e.lines.length - 1} more`
                        : (e.lines[0] ?? null),
                    route: 'logged',
                    participantNames: null,
                    participantIds: [],
                    isSelf: false,
                  }}
                />
              ))}
            </View>
          ) : null}

          {cardsReady && sections
            ? sections.map((g, gi) => (
                <View key={`grp-${gi}`} style={{ gap: 10 }}>
                  <Text
                    variant="captionSm"
                    style={{ color: LIGHT.textSecondary, letterSpacing: 1 }}
                  >
                    {g.label.toUpperCase()}
                  </Text>
                  {g.note ? (
                    <Text variant="bodyMd" style={{ color: LIGHT.textPrimary }}>
                      {g.note}
                    </Text>
                  ) : null}
                  {g.people.map((p) => (
                    <PersonBlock
                      key={`${gi}-${p.id}`}
                      person={p}
                      onOpenPerson={onOpenPerson}
                      onAsk={onAsk}
                      onAddNote={onAddNote}
                    />
                  ))}
                  {/* Actions for THIS section. An answer with two halves has two
                      different next moves, and one chip row at the very bottom
                      makes the reader work out which half each belongs to. */}
                  {g.chips && g.chips.length > 0 ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {g.chips.map((c, ci) => (
                        <Chip
                          key={`${gi}-c-${ci}`}
                          label={c.label}
                          onPress={() => onSuggestion(c)}
                          emphasis={EMPHASIZED_CHIPS.has(c.type)}
                          icon={CHIP_ICON[c.type]}
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              ))
            : null}

          {/* IN PLACE OF, NOT IN ADDITION TO. The comment above claimed a grouped
              turn never also emits a flat list; it does — the server sends the
              ranked `people` first and the sections afterwards, because the
              sections are derived from the finished answer. Without this gate
              every person rendered twice, once under their heading and once in
              the list below it. */}
          {cardsReady && !sections && people.length > 0 ? (
            // Everyone the note involves, shown as equals — no lead/"others"
            // split. Each card carries its own quick actions.
            //
            // EXCEPT that "involves" covers two different things. People the
            // sentence NAMED and people the network RECALLED because of what the
            // sentence was about rendered as identical cards, so a contact who
            // happens to know the neighborhood you mentioned looked exactly like
            // someone you had just tagged — and read as the app inventing
            // people. They are still one list in one order; the heading just says
            // which is which, and only when both are present.
            <View style={{ gap: 12 }}>
              {/* WHICH QUESTION THESE PEOPLE ANSWER.
                  On a multi-part turn the ranked list is the answer to ONE of
                  the asks, and it used to arrive under "ALSO CONNECTED TO THIS"
                  -- a note-participant label -- with no way to tell it apart
                  from people the sentence merely mentioned. The heading only
                  appears when the plan actually named a people ask, so a single
                  question and a voice note are unchanged. */}
              {askFor('people') ? (
                <View style={{ gap: 2 }}>
                  <Text
                    variant="captionSm"
                    style={{ color: LIGHT.textSecondary, letterSpacing: 1 }}
                  >
                    PEOPLE YOU KNOW
                  </Text>
                  <Text variant="captionSm" style={{ color: LIGHT.textMuted }} numberOfLines={2}>
                    {`For: ${askFor('people')}`}
                  </Text>
                </View>
              ) : null}
              {people.map((p, i) => {
                const prev = i > 0 ? people[i - 1] : null;
                const showRecalledHeader =
                  p.kind === 'recalled' && (!prev || prev.kind !== 'recalled');
                const showMentionedHeader =
                  i === 0 && p.kind === 'mentioned' && people.some((x) => x.kind === 'recalled');
                return (
                  <View key={p.id} style={{ gap: 12 }}>
                    {showMentionedHeader ? (
                      <Text
                        variant="captionSm"
                        style={{ color: LIGHT.textSecondary, letterSpacing: 1 }}
                      >
                        IN THIS NOTE
                      </Text>
                    ) : null}
                    {showRecalledHeader ? (
                      <Text
                        variant="captionSm"
                        style={{ color: LIGHT.textSecondary, letterSpacing: 1 }}
                      >
                        ALSO CONNECTED TO THIS
                      </Text>
                    ) : null}
                    <PersonBlock
                      person={p}
                      onOpenPerson={onOpenPerson}
                      onAsk={onAsk}
                      onAddNote={onAddNote}
                    />
                  </View>
                );
              })}
              {hiddenLocally > 0 ? (
                <View style={{ alignSelf: 'flex-start' }}>
                  <Chip
                    label={`Load more · ${people.length} of ${matchedTotal}`}
                    onPress={() => setShownCount((n) => n + PEOPLE_PAGE_STEP)}
                  />
                </View>
              ) : beyondPage > 0 ? (
                // Everything we were SENT is on screen, but more matched than was
                // sent. Saying so is the honest end of the list; the alternative is
                // a screen that looks complete and is not.
                <Text variant="bodySm" style={{ color: LIGHT.textMuted }}>
                  {`Showing ${allPeople.length} of ${matchedTotal}. Ask me to narrow it down.`}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* THE ORDER OF THESE TWO IS THE SERVER'S, NOT THIS FILE'S.
              The owner's own people come first and always will -- local queries
              plus a ranker that streams its list before it writes anything, and
              the payload is cached per owner. What can change places is
              strangers on LinkedIn (ONE Exa call, parsed deterministically) and
              venues (a web search AND a model pass to turn pages into cards),
              and the server no longer decides that by reputation: every lane
              reports what it cost and the plan is ordered by the measurements.
              So the sections follow the plan when there is one, which keeps the
              screen filling top to bottom in the order the parts actually land
              instead of jumping around a fixed layout. */}
          {(() => {
            const webPeopleNode =
              turn.webPeople && turn.webPeople.length > 0 ? (
                <WebPeopleCards
                  key="web_people"
                  people={turn.webPeople}
                  ask={askFor('web_people')}
                  onSave={onSaveWebPerson}
                  onOpenPerson={onOpenPerson}
                  onAsk={onAsk}
                />
              ) : null;
            const placesNode =
              turn.places && turn.places.length > 0 ? (
                <View key="places" style={{ gap: 10 }}>
                  {turn.placesNote ? (
                    <Text variant="bodyMd" style={{ color: LIGHT.textPrimary }}>
                      {turn.placesNote}
                    </Text>
                  ) : null}
                  <PlaceCards places={turn.places} ask={askFor('places')} onAsk={onAsk} />
                </View>
              ) : null;
            const planOrder = (turn.plan ?? [])
              .map((s) => s.key)
              .filter((k) => k === 'web_people' || k === 'places');
            // No plan (a single-part answer, or a replayed turn from before
            // plans existed) means the long-standing order: LinkedIn, then
            // venues. Which is also what the measurements say by default.
            const order = planOrder.length === 2 ? planOrder : ['web_people', 'places'];
            return order.map((k) => (k === 'web_people' ? webPeopleNode : placesNode));
          })()}

          {turn.sources && turn.sources.length > 0 ? (
            <SourceChips sources={turn.sources} />
          ) : null}

          {turn.suggestions && turn.suggestions.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
              {turn.suggestions.map((s, si) => (
                <Chip
                  key={`${s.type}-${si}`}
                  label={s.label}
                  onPress={() => onSuggestion(s)}
                  // "Search the web" is the way out of a dead end and "Send this"
                  // hands the answer to someone. Neither is a follow-up idea, so
                  // neither gets to look like one.
                  emphasis={EMPHASIZED_CHIPS.has(s.type)}
                  icon={CHIP_ICON[s.type]}
                />
              ))}
            </View>
          ) : null}

        </View>
      )}
    </View>
  );
}

// A circle rendered as an actual circle you tap: member faces in a colored ring,
// the name and count beneath it. Laid out in a horizontal row of tiles.
function CircleTile({
  circle: c,
  onPress,
  onHold,
}: {
  circle: ReturnType<typeof useCircles>['items'][number];
  onPress: () => void;
  /** Press and hold: what this circle is, and the way out of it. */
  onHold: () => void;
}) {
  const color = (c.color && NAMED_COLORS[c.color]) || LIGHT.accent;
  // The emblem carries the members; the NAME sits under the tile, and the center
  // holds a single letter. That split is what the design does, and it is why the
  // tile stays legible at 110px where a full name would not.
  const members = (c.preview ?? []).map((m) => ({
    id: m.contactId,
    name: m.name ?? '?',
  }));
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onHold}
      delayLongPress={380}
      accessibilityRole="button"
      accessibilityLabel={c.name}
      accessibilityHint="Press and hold for details and to leave"
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1, width: 172, alignItems: 'center' })}
    >
      <ChordEmblem
        name={c.name}
        centerText={(c.name || '?').trim().charAt(0).toUpperCase()}
        memberCount={c.memberCount}
        members={members}
        accent={color}
        size={156}
        showLabels={false}
        showCount={false}
      />
      <Text
        variant="titleSm"
        numberOfLines={1}
        style={{ marginTop: 6, color: LIGHT.textPrimary, textAlign: 'center' }}
      >
        {c.name}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          marginTop: 2,
          fontFamily: fonts.body,
          fontSize: 10.5,
          lineHeight: 15,
          letterSpacing: 1.4,
          color: c.hasUnseen ? LIGHT.accentText : LIGHT.textMuted,
          textAlign: 'center',
        }}
      >
        {c.hasUnseen
          ? 'NEW NOTE'
          : `${c.memberCount} ${c.memberCount === 1 ? 'PERSON' : 'PEOPLE'}`}
      </Text>
    </Pressable>
  );
}

// The "New circle" tile: a dashed ring with a plus, matching the design's
// start-one affordance rather than a text button.
function NewCircleTile({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="New circle"
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1, width: 172, alignItems: 'center' })}
    >
      <View
        style={{
          width: 156,
          height: 156,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Svg width={156} height={156}>
          <SvgCircle
            cx={78}
            cy={78}
            r={61}
            fill="none"
            stroke="#B2622D"
            strokeOpacity={0.4}
            strokeWidth={1.2}
            strokeDasharray="5 5"
          />
        </Svg>
        <Text
          style={{
            position: 'absolute',
            fontFamily: fonts.body,
            fontSize: 22,
            lineHeight: 26,
            color: LIGHT.accentText,
          }}
        >
          +
        </Text>
      </View>
      <Text variant="titleSm" style={{ marginTop: 6, color: LIGHT.textMuted }}>
        New circle
      </Text>
      <Text
        style={{
          marginTop: 2,
          fontFamily: fonts.body,
          fontSize: 10.5,
          lineHeight: 15,
          letterSpacing: 1.4,
          color: LIGHT.textMuted,
        }}
      >
        START ONE
      </Text>
    </Pressable>
  );
}
/**
 * The circles grid: FOUR PER PAGE, in a 2x2 quadrant, paged horizontally.
 *
 * This replaced a single horizontal strip that just kept growing to the right. With
 * more than two circles the third was always half-cut at the screen edge, and there was
 * no sense of how many you had — you had to scroll to find out.
 *
 * The layout rules, which are the whole point:
 *   - Newest circle first. The one you just made is the one you want.
 *   - "New circle" takes the next OPEN slot, not a fixed position: with two circles it
 *     sits in slot three, with four it moves to the front of the next page. It is part
 *     of the sequence rather than a permanent tile competing for a quadrant.
 *   - Exactly four per page, always, so the grid never reflows into a ragged shape as
 *     circles are added.
 *
 * Page width is MEASURED rather than taken from the window, because this sits inside two
 * nested pagers and a padded column — the window width is not the width this actually
 * gets, and a paging ScrollView whose page width is wrong stops on half-pages.
 */
function CircleQuadrants({
  circles,
  onOpen,
  onNew,
}: {
  circles: ReturnType<typeof useCircles>['items'];
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const [width, setWidth] = useState(0);
  const qc = useQueryClient();

  // PRESS AND HOLD A CIRCLE: what it is, and the way out of it.
  //
  // The tile only opened. Nothing in the app said who was in a circle without
  // entering it, and nothing offered a way out at all — an inbound circle someone
  // else added you to had no exit from this screen.
  //
  // Deliberately an action sheet and not a drag: this grid is a horizontal paging
  // ScrollView nested inside the People pager, so a pan here competes with two
  // scrollables for the same gesture. Reordering also has nowhere to be stored —
  // circles have no position column, unlike favorites. Both are worth doing;
  // neither is worth guessing at underneath a screen that currently works.
  const onHoldCircle = useCallback(
    (c: ReturnType<typeof useCircles>['items'][number]) => {
      haptics.impact();
      const inbound = c.origin === 'inbound';
      const names = (c.preview ?? []).map((m) => m.name).filter(Boolean);
      const who = names.length
        ? names.slice(0, 6).join(', ') + (c.memberCount > names.length ? `, +${c.memberCount - names.length} more` : '')
        : 'No one in it yet';
      // An inbound circle is someone else's, so the exit is LEAVE. Your own circle
      // has no "leave" — deleting it is the only thing that word could mean, and
      // saying Delete is the honest label for something that ends for everyone.
      const exit = inbound ? 'Leave circle' : 'Delete circle';
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: c.name,
          message: `${c.memberCount} ${c.memberCount === 1 ? 'person' : 'people'}\n${who}${
            inbound && c.owner?.name ? `\n\nShared with you by ${c.owner.name}` : ''
          }`,
          options: ['Open circle', exit, 'Cancel'],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 2,
        },
        (i) => {
          if (i === 0) {
            onOpen(c.id);
            return;
          }
          if (i !== 1) return;
          Alert.alert(
            inbound ? 'Leave this circle?' : 'Delete this circle?',
            inbound
              ? `You will stop seeing what ${c.owner?.name ?? 'they'} shares with ${c.name}.`
              : `${c.name} will be removed for everyone in it. The people stay in your contacts.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: inbound ? 'Leave' : 'Delete',
                style: 'destructive',
                onPress: () => {
                  void (inbound ? leaveCircle(c.id) : deleteCircle(c.id)).then((res) => {
                    if (!res.ok) {
                      toast.error(inbound ? 'Could not leave that circle.' : 'Could not delete that circle.');
                      return;
                    }
                    toast.success(inbound ? `Left ${c.name}.` : `${c.name} deleted.`);
                    // The grid reads a module cache as well as react-query, so both
                    // have to be dropped or the tile stays on screen until a remount.
                    clearCirclesCache();
                    qc.invalidateQueries({ queryKey: ['circles'] });
                  });
                },
              },
            ],
          );
        },
      );
    },
    [onOpen, qc],
  );

  // Newest first, then the New tile as the next item in the sequence.
  const slots = useMemo(() => {
    // Newest first. createdAt is a real field on CirclePreview; the || 0 only covers a
    // malformed timestamp, in which case that circle sorts last rather than throwing
    // the whole order out.
    const ordered = [...circles].sort(
      (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
    );
    return [...ordered.map((c) => ({ kind: 'circle' as const, circle: c })), { kind: 'new' as const }];
  }, [circles]);

  // Chunk into pages of four.
  const pages = useMemo(() => {
    const out: (typeof slots)[] = [];
    for (let i = 0; i < slots.length; i += 4) out.push(slots.slice(i, i + 4));
    return out;
  }, [slots]);
  type Slot = (typeof slots)[number];

  return (
    <View onLayout={(e) => {
      const w = Math.round(e.nativeEvent.layout.width);
      setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    }}>
      {width > 0 ? (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          // Nested inside two pagers; without this the parent pager can steal the
          // horizontal gesture and the grid feels stuck.
          directionalLockEnabled
          decelerationRate="fast"
        >
          {pages.map((page: Slot[], pi: number) => (
            <View
              key={pi}
              style={{
                width,
                flexDirection: 'row',
                flexWrap: 'wrap',
                paddingVertical: 6,
              }}
            >
              {page.map((slot: Slot, si: number) =>
                slot.kind === 'circle' ? (
                  <View key={slot.circle.id} style={{ width: width / 2, alignItems: 'center', marginBottom: 14 }}>
                    <CircleTile
                      circle={slot.circle}
                      onPress={() => onOpen(slot.circle.id)}
                      onHold={() => onHoldCircle(slot.circle)}
                    />
                  </View>
                ) : (
                  <View key={`new-${pi}-${si}`} style={{ width: width / 2, alignItems: 'center', marginBottom: 14 }}>
                    <NewCircleTile onPress={onNew} />
                  </View>
                ),
              )}
            </View>
          ))}
        </ScrollView>
      ) : null}

      {/* Page dots, only once there is more than one page — otherwise there is nothing
          to indicate and a lone dot is noise. */}
      {pages.length > 1 ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 2 }}>
          {pages.map((_: Slot[], i: number) => (
            <View
              key={i}
              style={{
                width: 5,
                height: 5,
                borderRadius: 3,
                backgroundColor: 'rgba(32,30,29,0.18)',
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function AskEmpty() {
  const router = useRouter();
  const circles = useCircles();
  // Show cached circles immediately (useCircles keeps items across a focus
  // refetch), so returning to Ask never flashes the "Make a circle" empty state
  // before the real circles land. The create prompt only shows once we KNOW the
  // list is empty (status done, zero items).
  const list = circles.items;
  return (
    <View style={{ paddingTop: 8, gap: spacing.lg }}>
      <Text variant="displaySm" style={{ color: LIGHT.textPrimary }}>
        Ask about your people
      </Text>

      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="captionSm" style={{ color: LIGHT.textSecondary, letterSpacing: 1 }}>
            CIRCLES
          </Text>
          <Pressable
            onPress={() => router.push('/(gated)/circle/new')}
            accessibilityRole="button"
            accessibilityLabel="New circle"
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Plus size={15} color={LIGHT.accentText} strokeWidth={2.5} />
              <Text variant="buttonSm" style={{ color: LIGHT.accentText }}>
                New circle
              </Text>
            </View>
          </Pressable>
        </View>

        {list.length > 0 ? (
          <CircleQuadrants
            circles={list}
            onOpen={(id) => router.push(`/(gated)/circle/${id}`)}
            onNew={() => router.push('/(gated)/circle/new')}
          />
        ) : circles.status === 'done' ? (
          <Pressable
            onPress={() => router.push('/(gated)/circle/new')}
            accessibilityRole="button"
            accessibilityLabel="Make a circle"
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          >
            <View
              style={{
                padding: 14,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: LIGHT.hairline,
                backgroundColor: LIGHT.surface,
                gap: 3,
              }}
            >
              <Text variant="titleMd" style={{ color: LIGHT.textPrimary }}>
                Make a circle
              </Text>
              <Text variant="captionSm" style={{ color: LIGHT.textSecondary }}>
                Group people who belong together, then message them all at once.
              </Text>
            </View>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function AskChat({
  onOpenPerson,
  hideNewChat = false,
  topInset = 0,
  tabBarClear = true,
  hideEmpty = false,
  initialAsk,
}: {
  onOpenPerson: (id: string) => void;
  // The Home Ask overlay renders its own New chat control in the header, so it
  // hides this one to avoid two.
  hideNewChat?: boolean;
  // Extra top padding so the first line clears the overlay's title banner while
  // scrolled content still fades under it.
  topInset?: number;
  // In the People tab the composer must clear the floating tab bar; in the Home
  // overlay there is no tab bar, so it drops lower to the bottom edge.
  tabBarClear?: boolean;
  // The Home Ask overlay always opens a specific note, so it suppresses the
  // empty "Ask about your people" + Circles surface entirely — that picker
  // belongs only to the People-tab Ask, and rendering it here flashed a circle
  // screen before the note loaded.
  hideEmpty?: boolean;
  /**
   * FALSE ON THE CIRCLES PAGE, where the composer is not here any more.
   *
   * The bar the user types into is rendered once, above the pager, so it is
   * literally the same bar as the one on Contacts rather than a second one styled to
   * match — see PeopleSearchDock. This conversation still owns everything about
   * itself; it just publishes "here is how to send me a message" over lib/askBridge
   * and lets the bar call it. The Home Ask overlay keeps its own composer, because
   * there is no shared bar up there to type into.
   */
  /**
   * A question typed into the shared bar BEFORE this surface existed.
   *
   * The bar lives above the tabs and the Ask surface is opened by using it, so
   * there is a frame where the text has been sent and nothing is listening --
   * askBridge's submitter is registered by this component on mount. Rather than
   * race it with a timer, the screen hands the question over as a prop and this
   * runs it once, after the wire is up.
   */
  initialAsk?: string;
}) {
  const insets = useSafeAreaInsets();
  const {
    turns,
    runSearch,
    resetChat,
    onStop,
    onSuggestion,
    onClarify,
    onSoftConfirmYes,
    onSoftConfirmNo,
    // Needed to attach audio: the note's id does not exist until the capture
    // stream has resolved.
    getConversationId,
  } = useChat();
  // OUTSTANDING QUESTIONS BELONG ON BOTH SURFACES.
  //
  // The clarify and soft-confirm cards inside a turn are built from that turn's
  // live SSE. If the overlay was closed before capture finished -- or the note is
  // simply being revisited -- the pending rows exist server-side and this view
  // showed none of them. That is why "which Eli?" could appear on Home and
  // nowhere in the chat, and why answering in one place left the other looking
  // like it had been ignored.
  //
  // /v1/me/pending-resolutions is the same queue Home reads and the same rows
  // resolving clears, so the two surfaces cannot disagree. Questions already
  // asked live in a visible turn are excluded by pendingId rather than shown
  // twice.
  // THE STREAM IS THE TRIGGER; THE QUEUE IS THE SOURCE.
  //
  // A clarify or a capture arriving on the stream is the earliest possible
  // signal that the server has written a pending row -- earlier than any timer.
  // Keying the queue's reload on that count means the card appears the moment
  // there is one to show, without the transcript ever rendering the question
  // itself. Capture finishes ten to twenty seconds after the turn starts, well
  // past the fixed 3.5s/7s ladder, which is why a bare turn count was not enough.
  const pendingSignal = useMemo(
    () =>
      turns.reduce(
        (n, t) =>
          n + (t.clarify?.length ?? 0) + (t.softConfirm?.length ?? 0) + (t.captured?.length ?? 0),
        turns.length,
      ),
    [turns],
  );

  const {
    items: pendingItems,
    remove: removePending,
    restore: restorePending,
  } = usePendingResolutions(pendingSignal);

  // EVERY open question, not "the ones the turn isn't already showing". The turn
  // shows none now, so the exclusion that livePendingIds existed for is gone.
  const outstanding = pendingItems;

  const handleResolveOutstanding = useCallback(
    async (pendingId: number, contactId: string): Promise<boolean> => {
      const rawName = pendingItems.find((p) => p.pendingId === pendingId)?.rawName ?? '';
      removePending(pendingId);
      const res = await resolvePending(pendingId, contactId);
      // Restore on failure. A question that silently disappears is worse than one
      // asked twice -- the fact it captured stays attached to nobody.
      if (!res.ok) {
        restorePending(rawName);
        return false;
      }
      return true;
    },
    [pendingItems, removePending, restorePending],
  );

  // The note the sharing sheet is open for. Set by the "Send this to a circle"
  // chip, which is handled HERE rather than in ChatContext because it opens a sheet
  // rather than sending a message — everything else a suggestion can do is "ask
  // something", and that belongs to the context.
  const [shareNoteId, setShareNoteId] = useState<string | null>(null);
  // The web profile currently being saved as a contact. null closes the sheet.
  const [savePerson, setSavePerson] = useState<WebPerson | null>(null);
  const [noteFor, setNoteFor] = useState<{ id: string; name: string } | null>(null);
  const [makingCircle, setMakingCircle] = useState(false);
  const qc = useQueryClient();

  // CREATE THE CIRCLE AND PUT THE PEOPLE IN IT.
  //
  // Confirmed first, because it makes something the user will see in their Circles
  // tab forever — but confirmed with the name already chosen rather than a text
  // prompt, since the whole value of the chip is that it is one tap. Renaming lives
  // on the circle screen.
  //
  // Members go in with ONE request that sets the whole membership, rather than a
  // request per person. Per-person adds each triggered a reconcile of every
  // member fact in the circle, so a plan naming a dozen people spent minutes
  // redoing the same work a dozen times over.
  const makeCircleFor = useCallback(
    async (name: string, contactIds: string[]) => {
      if (makingCircle) return;
      const clean = name.trim() || 'New circle';
      Alert.alert(
        `Create "${clean}"?`,
        `${contactIds.length} people from this plan will be added.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Create',
            onPress: () => {
              setMakingCircle(true);
              void (async () => {
                const res = await createCircle(clean);
                if (!res.ok) {
                  setMakingCircle(false);
                  toast.error(medhaIdErrorCopy(res, 'Amber'));
                  return;
                }
                const circleId = String(res.data.circle.id);
                const memberRes = await setCircleMembers(circleId, contactIds);
                clearCirclesCache();
                void qc.invalidateQueries({ queryKey: ['circles'] });
                setMakingCircle(false);
                if (!memberRes.ok) {
                  // The circle exists; only its membership didn't land. Say so,
                  // because the user will find an empty circle either way.
                  toast.error(
                    `Created ${clean}`,
                    'Nobody was added — open the circle to add them.',
                  );
                  return;
                }
                const { added, unknown } = memberRes.data;
                toast.success(
                  `Created ${clean}`,
                  unknown > 0
                    ? `${added} added, ${unknown} skipped (no contact card)`
                    : `${added} added`,
                );
              })();
            },
          },
        ],
      );
    },
    [makingCircle, qc],
  );

  const handleSuggestion = useCallback(
    (s: Suggestion) => {
      if (s.type === 'share_note') {
        const id = getConversationId();
        if (!id) {
          // No conversation yet means nothing has been said to share. Should not be
          // reachable (the chip only exists after an answer), so it fails quietly
          // rather than opening an empty sheet.
          toast.error('Nothing to share yet.');
          return;
        }
        setShareNoteId(id);
        return;
      }
      // MAKE A CIRCLE FOR THIS PLAN. A dinner naming three friends had no route to
      // becoming a group — you had to leave, open Circles, create one and re-add
      // everybody by hand. This opens the create sheet already holding them.
      if (s.type === 'create_circle') {
        void makeCircleFor(s.name ?? 'New circle', s.contactIds);
        return;
      }
      // Record something ABOUT a person. The note sheet already exists for the
      // contact cards; this just points it at the person the chip names.
      if (s.type === 'add_note') {
        setNoteFor({ id: s.contactId, name: s.name ?? '' });
        return;
      }
      onSuggestion(s);
    },
    [getConversationId, makeCircleFor, onSuggestion],
  );

  // Is a reply in flight? Drives the send button flipping to a stop square.
  const lastTurn = turns[turns.length - 1];
  const busy = !!lastTurn && (lastTurn.status === 'loading' || lastTurn.result?.answerStatus === 'streaming');
  // NO DRAFT STATE HERE ANY MORE. The shared bar owns what you are typing (it is
  // the only field), and this file's copy was only ever written by the composer
  // that has been deleted -- so it was permanently '' and the empty-state test
  // below was reading a constant.
  // COME BACK LATER AND IT IS THE CIRCLES GRID AGAIN, not this morning's answer.
  // Measured on foregrounding only: a timer running while the app is open would wipe
  // a thread mid-read, and a timer running while backgrounded is suspended by iOS
  // anyway. Only enabled once there is something to clear, so an empty surface never
  // fires a pointless reset.
  const touchIdle = useIdleReset(resetChat, {
    afterMs: IDLE_CLEAR_MS,
    enabled: turns.length > 0,
  });
  const scrollRef = useRef<ScrollView>(null);

  // "Add a note" on a card writes the note DIRECTLY to that contact.
  //
  // It used to submit `${name}: ${transcript}` back through the chat endpoint and
  // rely on the extractor to work out who a note opened on ONE person's card was
  // about. When extraction found nothing, or resolved the name to a different
  // same-named contact, the note existed nowhere — which is why this read as a
  // dead end. The contact id is right here; there is nothing to infer.
  //
  // No audio clip on this path: note_media hangs off a conversation id and a
  // per-contact note is not a conversation. The words are what has to survive, and
  // now they do. The home recorder and record-into-a-circle still keep their audio.
  const saveContactNote = (contactId: string, name: string, transcript: string) => {
    const t = transcript.trim();
    if (!t) return;
    void captureContactNote(contactId, t).then((res) => {
      if (!res.ok) {
        toast.error(`Could not save that note about ${firstNameOf(name)}.`);
        return;
      }
      toast.success(`Saved to ${firstNameOf(name)}'s card.`);
      // The keys the PERSON PAGE actually uses. I first wrote ['contactNotes', id]
      // here, which no query anywhere is registered under, so the invalidation was
      // a silent no-op and the card kept showing stale content until it happened to
      // refetch on its own. An invalidation against a key that does not exist fails
      // quietly, which is the worst way for a cache bug to behave.
      qc.invalidateQueries({ queryKey: ['contactFacts', contactId] });
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
      qc.invalidateQueries({ queryKey: ['contactLive', contactId] });
      qc.invalidateQueries({ queryKey: ['person', contactId] });
      // Prefix match, so it reaches ['recentlyMentioned', MENTIONS_MAX].
      qc.invalidateQueries({ queryKey: ['recentlyMentioned'] });
    });
  };

  // Dictation ACCUMULATES into the composer instead of submitting on the first
  // pause: finished chunks append, the live partial shows as you speak, and you
  // THE RECORDER AND THE MIC BUTTON WERE DELETED WITH THE COMPOSER.
  //
  // Record-then-transcribe, a metering waveform, a mic that toggled it, and the
  // send/stop pair beside it -- all of it existed to fill the trailing slot of
  // the second bar this file used to render, and that bar was never on screen
  // (see the note further down: `showComposer` defaulted to true and the app's one
  // mount passed false). Holding a thought out loud is not gone: the shared bar
  // leads every mode with its own record button, which opens the recorder overlay
  // that Home and Circles already use.
  //
  // Removed rather than left with a comment. Dead UI plumbing kept "in case" is
  // what this whole file was, and a second implementation of the app's most
  // important control is exactly the thing that drifts.

  // KEEP THE NEWEST ANSWER ABOVE THE KEYBOARD.
  //
  // This effect lived in the middle of the composer's recorder block and went out
  // with it, which was a mistake: it has nothing to do with the composer. Opening
  // the keyboard shrinks the viewport, so without a scroll the last thing said
  // ends up underneath it.
  //
  // A plain JS listener on purpose. Scrolling is a JS-thread action either way,
  // so there is nothing here for a notification to be late for -- this is not
  // driving an animation, which is the mistake the keyboard lift kept making.
  // `keyboardWillShow` fires before the keyboard moves, so the scroll runs
  // alongside it rather than after it, and there is deliberately no second scroll
  // on `keyboardDidShow`: that one lands once everything else has come to rest,
  // which reads as an extra movement at the end of the gesture.
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    });
    return () => show.remove();
  }, []);

  // THE WIRE TO THE ONE BAR. Registered while mounted, cleared on unmount, and the
  // clear only fires if this instance still owns the wire — so a remount during a
  // page transition cannot leave the bar talking to a dead conversation.
  useEffect(() => {
    const offSubmit = registerAskSubmitter((t) => {
      touchIdle();
      void runSearch(t);
      // TYPED REMINDERS, WHICH HAD STOPPED HAPPENING.
      //
      // "remind me at 6pm to call mom" typed into the bar is supposed to schedule
      // a reminder as well as being asked. That side effect lived in this file's
      // own `submit()` -- the send button of the composer that has not rendered
      // since the bar went global -- so the shared bar's path never ran it and
      // typed reminders have quietly gone nowhere.
      //
      // Moved onto the path that actually runs. Fire-and-forget, exactly as it
      // was, so it can never block or alter the question above. This is the TYPED
      // path only: home voice notes schedule their own in HomeVoiceCapture, so
      // there is nothing here to double-fire with.
      //
      // AND A REFUSED WRITE SAYS SO. This swallowed every failure -- including,
      // for days, every single one, because migrations 049 and 050 had never
      // been applied and every INSERT threw on a missing column. No toast, and
      // chat happily narrated the reminder it had not created.
      void parseAndScheduleReminders(t)
        .then((outcome) => {
          if (outcome.failure) {
            toast.error('Reminder not saved', scheduleFailureText(outcome.failure));
            return;
          }
          const copy = reminderConfirmationText(outcome.scheduled);
          if (copy) toast.success(copy);
        })
        .catch(() => {
          toast.error('Reminder not saved', 'Amber could not save it. Try again.');
        });
    });
    const offStop = registerAskStopper(() => onStop());
    return () => {
      offSubmit();
      offStop();
    };
  }, [runSearch, onStop, touchIdle]);

  // THE QUESTION THAT ARRIVED BEFORE THIS SURFACE DID.
  //
  // Typing into the shared bar is what opens this, so the text exists a frame
  // earlier than the wire above. Run once, guarded by a ref rather than by the
  // effect's deps: `initialAsk` is a string, and a re-render that happens to pass
  // the same string again must not ask it twice.
  const askedInitial = useRef(false);
  useEffect(() => {
    const q = initialAsk?.trim();
    if (!q || askedInitial.current) return;
    askedInitial.current = true;
    touchIdle();
    void runSearch(q);
    // runSearch is intentionally not a dep: it changes identity as the draft
    // changes, and this must fire on the FIRST question only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAsk]);

  // So the bar can show stop instead of send while a reply streams.
  useEffect(() => {
    publishAskBusy(busy);
  }, [busy]);

  // HOW MUCH ROOM THE BAR NEEDS AT THE FOOT OF THE LIST.
  //
  // When this page does NOT own its composer -- the Ask surface, where the bar is
  // hoisted above the pager -- nothing else reserves space for it, so every
  // turn's tail ran underneath the bar and the tab pill: the follow-up chips, the
  // send button, and the user's own gold bubble showing through the glass.
  //
  // IT USED TO BE A 100-POINT STEP, and that step is the "flash up".
  //
  // It was `(kbVisible ? 12 : peopleBarBottom(insets.bottom)) + …`, a plain number
  // in contentContainerStyle driven by REACT STATE from a keyboardWillShow
  // listener. So at the instant the keyboard began to move, the content's bottom
  // padding jumped about a hundred points in a single frame -- and a
  // `scrollToEnd` fired off the same change. The bar's own lift was smooth; the
  // thing behind it lurched, and then the list scrolled. The old comment here
  // admitted it: "It is a step, and it is the one remaining discontinuity in this
  // gesture."
  //
  // Now the reserve is an animated SPACER at the end of the content, whose height
  // rides the keyboard on the UI thread. Same total space, no step, no
  // state-driven scroll. It is still a layout animation -- the room genuinely has
  // to shrink -- but it is one leaf view interpolating between two numbers rather
  // than the whole content container changing shape at once.
  const dockRestHeight = peopleBarBottom(insets.bottom) + PEOPLE_BAR_H + spacing.md;
  const dockLiftedHeight = 12 + PEOPLE_BAR_H + spacing.md;

  const keyboard = useKeyboardLift();
  // Reads the live keyboard height, so this padding is now the same motion as the
  // search bar's lift rather than a second animation that happens to last as long.
  const keyboardPad = useAnimatedStyle(() => ({ paddingBottom: keyboard.height.value }));
  // THE DOCK'S RESERVE, RIDING THE KEYBOARD instead of stepping when it appears.
  // Interpolated on the keyboard's own progress -- the same number the bar's lift
  // uses -- so the room under the last answer closes exactly as the bar rises
  // into it. `full` is assumed-then-learned; see lib/useKeyboardLift.
  const dockSpacer = useAnimatedStyle(() => {
    const to = Math.max(1, keyboard.full.value);
    const p = Math.min(1, Math.max(0, keyboard.height.value / to));
    return { height: dockRestHeight + (dockLiftedHeight - dockRestHeight) * p };
  });

  return (
    // KeyboardAvoidingView used to be here, with behavior="padding". It works, and it
    // is a beat behind the keyboard: it runs its OWN animation on its own curve, so on
    // Circles the composer visibly chased the keyboard up instead of riding it. Driving
    // the same padding from the keyboard's own duration and easing (the value comes from
    // `keyboardWillShow`, which fires before the keyboard moves) makes the two one
    // motion. It is still a layout animation — the scroll viewport genuinely has to
    // shrink — but it now starts and ends exactly when the keyboard does.
    <ReAnimated.View style={[{ flex: 1 }, keyboardPad]}>
      {turns.length > 0 && !hideNewChat ? (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.sm,
          }}
        >
          <Pressable
            onPress={() => resetChat()}
            accessibilityRole="button"
            accessibilityLabel="New chat"
            hitSlop={10}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.5)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.6)',
              }}
            >
              <SquarePen size={19} color={LIGHT.accentText} strokeWidth={2} />
            </View>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{
          // Same gutter as the bar below it, so the answer and the field it was
          // typed into share a left edge.
          paddingHorizontal: PEOPLE_BAR_SIDE,
          paddingTop: spacing.md + topInset,
          // The dock's own reserve is the animated spacer at the end of the
          // content, not padding here -- see dockRestHeight.
          paddingBottom: spacing.lg,
          gap: spacing.lg,
        }}
        // The indicator was running under the bar too, which made the list look
        // shorter than it is.
        // The indicator was running under the bar, which made the list look
        // shorter than it is. The resting value is right for the case that
        // matters (reading back with the keyboard down) and this is not worth
        // animating.
        scrollIndicatorInsets={{ bottom: dockRestHeight }}
        // directionalLockEnabled: this list lives inside a horizontal pager. Without the
        // lock, iOS lets this scroll view claim a slightly-diagonal drag, so the swipe
        // between People / Today / You worked sometimes and did nothing other times
        // depending on the exact angle of the finger. The lock makes a mostly-horizontal
        // drag stay unclaimed here so the pager gets it, every time.
        directionalLockEnabled
        keyboardShouldPersistTaps="handled"
        // "interactive" rather than "on-drag": the keyboard tracks the finger and
        // can be pulled back up mid-drag, which is what every native iOS list does.
        // on-drag dismisses the instant you move, so reading back over a long answer
        // snapped the keyboard away and jumped the layout.
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        {outstanding.length > 0 ? (
          <View style={{ gap: 12, marginBottom: spacing.lg }}>
            <Text variant="captionSm" style={{ color: LIGHT.textSecondary, letterSpacing: 1 }}>
              STILL TO CONFIRM
            </Text>
            {outstanding.map((p) => (
              <PendingConfirmCard
                key={p.pendingId}
                item={p}
                onResolve={handleResolveOutstanding}
                onDecline={(pendingId) => {
                  removePending(pendingId);
                  void declinePending(pendingId);
                }}
              />
            ))}
          </View>
        ) : null}

        {turns.length === 0 ? (
          hideEmpty ? null : <AskEmpty />
        ) : (
          turns.map((t, ti) => (
            <AskTurn
              key={t.id}
              turn={t}
              isLast={ti === turns.length - 1}
              onAsk={(q) => {
                touchIdle();
                void runSearch(q);
              }}
              onAddNote={(person) => setNoteFor(person)}
              onOpenPerson={onOpenPerson}
              onSuggestion={handleSuggestion}
              onSaveWebPerson={setSavePerson}
              onClarify={onClarify}
              onSoftYes={onSoftConfirmYes}
              onSoftNo={onSoftConfirmNo}
              onRetry={(q) => void runSearch(q)}
            />
          ))
        )}
        {/* The room the hoisted bar needs, as content rather than as padding, so
            it can shrink continuously while the keyboard rises. See
            dockRestHeight for what this replaced and why. */}
        {dockRestHeight > 0 ? <ReAnimated.View style={dockSpacer} /> : null}
      </ScrollView>

      {/* THE SECOND BAR USED TO BE HERE, AND IT WAS UNREACHABLE.
          ------------------------------------------------------
          "Search bars should be components based on their functionality, just
           like everything else in React and just like everything else in our
           app. Is that right? Is that what you're doing?"

          Yes -- with this exception, which is now gone. There is one SearchDock,
          rendered above the pager, whose behavior comes from a table
          (lib/searchModes) rather than from which screen it is on. But THIS file
          also carried a whole second composer: its own PeopleBottomBar, its own
          TextInput, its own placeholder read out of SEARCH_MODES.today, and its
          own bottom offset that jumped 100 points off a React keyboard listener.

          It was behind `showComposer`, which defaults to true -- and the only
          place AskChat is mounted anywhere in the app passes false. So it has
          been dead code: a second implementation of the app's most important
          control, kept in agreement with the real one by hand, rendering nowhere.
          That is exactly the drift the one-bar refactor was for, hiding inside
          the file that refactor was supposed to have emptied.

          Deleted, along with `showComposer` and the kbVisible-driven
          `composerBottom` that was its only remaining reason to watch the
          keyboard from JS. */}
      {/* Pick who this answer goes to. Same sheet the ⋯ menu on a voice-note card
          uses, so "share" means one thing in one place across the app. */}
      {/* Save a stranger from a profile card, with a tag and a note — the same
          capture the favorites sheet does, because the moment you find someone is
          the moment you still remember why they mattered. */}
      <SaveWebPersonModal person={savePerson} onClose={() => setSavePerson(null)} />

      <NoteSharingModal
        visible={!!shareNoteId}
        noteId={shareNoteId}
        heading="Send this"
        subheading="Choose a circle or a person to send this to."
        onClose={() => setShareNoteId(null)}
      />

      <VoiceNoteRecorder
        visible={!!noteFor}
        // A chip can carry an id whose name did not survive generation. Titling the
        // sheet "Note about " reads as a bug; "Add a note" reads as the feature.
        title={noteFor ? (noteFor.name ? `Note about ${noteFor.name}` : 'Add a note') : undefined}
        onCancel={() => setNoteFor(null)}
        onDone={(t) => {
          const target = noteFor;
          setNoteFor(null);
          if (target) saveContactNote(target.id, target.name, t);
        }}
      />
    </ReAnimated.View>
  );
}
