import { Linking, View } from 'react-native';
import {
  BedDouble,
  BookOpen,
  Briefcase,
  Coffee,
  Cross,
  Dumbbell,
  ExternalLink,
  GraduationCap,
  MapPin,
  Star,
  Ticket,
  Trees,
  Utensils,
  Wine,
} from 'lucide-react-native';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { LIGHT } from '../lib/theme';
import { radius } from '../lib/tokens';
import { cl } from '../lib/classical';
import type { Place } from '../lib/chat';

// A VENUE, AS A CARD YOU CAN ACT ON.
//
// "Planning dinner in Williamsburg, thinking Asian" used to come back as names inside
// a paragraph, which is the least useful shape for the one thing the user wants to do
// next: look at the place. This is the Yelp-shaped card — name, cuisine,
// neighborhood, address — and tapping it opens the restaurant's OWN site rather than
// an aggregator.
//
// STARS AND HOURS ARE RENDERED ONLY IF PRESENT, and today they never are. The server
// refuses to extract a rating from scraped page text, because star values on Yelp and
// Google are drawn by JavaScript and usually absent from the text a model is given —
// so "extract the rating" reliably produces a plausible invention, and a number is
// the one thing a user never thinks to doubt. Hours are worse: true only relative to
// a fetch date we do not have.
//
// Both fields exist in the type and are wired here, so enabling the Google Places API
// later lights them up with no change to this file.

function StarRow({ rating }: { rating: number }) {
  const rounded = Math.round(rating);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={13}
          color={n <= rounded ? '#C8622B' : 'rgba(32,30,29,0.20)'}
          fill={n <= rounded ? '#C8622B' : 'transparent'}
          strokeWidth={2}
        />
      ))}
    </View>
  );
}

// The url is re-checked HERE, not only where the event is parsed, because a card can
// also arrive from a stored turn's metadata — which is read back as Place[] without
// going through the stream normalizer. This is the one function that hands a string
// to Linking.openURL, so this is where http(s) is enforced.
function openableUrl(u: string | null | undefined): string | null {
  const s = typeof u === 'string' ? u.trim() : '';
  return /^https?:\/\//i.test(s) ? s : null;
}

// THE ICON FOLLOWS WHAT THE PLACE IS.
//
// A fork on a library card is a small lie that makes the whole card read as
// guessed. These cover the kinds of place the search actually returns; anything
// unrecognised gets the map pin, which is true of every place there is.
function iconFor(category: string | null | undefined) {
  const c = (category ?? '').toLowerCase();
  const size = 12;
  const color = cl.ink38;
  if (/librar|book|museum|galler|archive/.test(c)) return <BookOpen size={size} color={color} strokeWidth={2} />;
  if (/cowork|office|hq|headquarter|desk|workspace|meeting|conference/.test(c))
    return <Briefcase size={size} color={color} strokeWidth={2} />;
  if (/gym|climb|fitness|yoga|pool|sport/.test(c)) return <Dumbbell size={size} color={color} strokeWidth={2} />;
  if (/coffee|cafe|caf|bakery|tea/.test(c)) return <Coffee size={size} color={color} strokeWidth={2} />;
  if (/hotel|hostel|inn|stay/.test(c)) return <BedDouble size={size} color={color} strokeWidth={2} />;
  if (/park|garden|trail|outdoor/.test(c)) return <Trees size={size} color={color} strokeWidth={2} />;
  if (/theat|cinema|music|venue|club|arena|stadium/.test(c)) return <Ticket size={size} color={color} strokeWidth={2} />;
  if (/clinic|hospital|pharmac|dental|medic/.test(c)) return <Cross size={size} color={color} strokeWidth={2} />;
  if (/school|universit|college|campus|lab/.test(c)) return <GraduationCap size={size} color={color} strokeWidth={2} />;
  if (/bar|pub|cocktail|wine|brewer/.test(c)) return <Wine size={size} color={color} strokeWidth={2} />;
  if (/restaurant|thai|italian|korean|japanese|indian|chinese|mexican|pizza|sushi|ramen|food|dining|izakaya|bistro|grill|steak|seafood|vegan|brunch/.test(c))
    return <Utensils size={size} color={color} strokeWidth={2} />;
  return <MapPin size={size} color={color} strokeWidth={2} />;
}

export function PlaceCard({
  place,
  /** True when this card cannot say WHICH branch it is — see PlaceCards. */
  ambiguous = false,
  /** Ask Amber to narrow it down. Absent on a replayed turn. */
  onAsk,
}: {
  place: Place;
  ambiguous?: boolean;
  onAsk?: (question: string) => void;
}) {
  const href = openableUrl(place.url);
  const canOpen = !!href;
  const kind = place.category ?? place.cuisine ?? null;
  const meta = [kind, place.neighborhood].filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={() => {
        if (!href) return;
        // openURL, not a WebView: the user asked about a restaurant, and the
        // restaurant's own site in their own browser is where they can actually book.
        void Linking.openURL(href).catch(() => {});
      }}
      disabled={!canOpen}
      accessibilityRole={canOpen ? 'link' : undefined}
      accessibilityLabel={
        canOpen ? `${place.name}${meta ? `, ${meta}` : ''}. Opens in your browser.` : place.name
      }
      style={({ pressed }) => ({ opacity: pressed && canOpen ? 0.7 : 1 })}
    >
      <View
        style={{
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: 'rgba(32,30,29,0.10)',
          backgroundColor: '#FFFDFA',
          paddingHorizontal: 14,
          paddingVertical: 12,
          gap: 6,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text
            variant="titleSm"
            numberOfLines={1}
            style={{ color: LIGHT.textPrimary, flex: 1, letterSpacing: -0.2 }}
          >
            {place.name}
          </Text>
          {canOpen ? <ExternalLink size={14} color={cl.ink38} strokeWidth={2} /> : null}
        </View>

        {/* Only when a real source supplied it. See the note at the top. */}
        {typeof place.rating === 'number' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <StarRow rating={place.rating} />
            <Text variant="captionSm" style={{ color: LIGHT.textSecondary }}>
              {place.rating.toFixed(1)}
              {place.reviewCount ? ` (${place.reviewCount})` : ''}
            </Text>
          </View>
        ) : null}

        {meta ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {iconFor(kind)}
            <Text variant="captionSm" numberOfLines={1} style={{ color: LIGHT.textSecondary, flex: 1 }}>
              {meta}
            </Text>
          </View>
        ) : null}

        {place.address ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <MapPin size={12} color={cl.ink38} strokeWidth={2} />
            <Text variant="captionSm" numberOfLines={1} style={{ color: LIGHT.textSecondary, flex: 1 }}>
              {place.address}
            </Text>
          </View>
        ) : null}

        {place.hours ? (
          <Text variant="captionSm" style={{ color: LIGHT.textSecondary }}>
            {place.hours}
          </Text>
        ) : null}

        {/* THE BLURB IS GONE, and it earned its removal.
            "Prospect Park — park with a museum and walking paths." "Equinox —
            gym where the person plans to work out." A sentence that restates
            the category is worse than silence: it takes two lines, adds
            nothing, and makes the whole card read as generated. What a venue
            card owes you is WHICH one and WHERE, which is the two lines above.
            The field stays on the type -- a genuinely useful line (a chef, a
            closure) may earn it back -- and nothing renders it today. */}

        {/* WHICH ONE, when the card cannot say. A chain with no street address
            is the one case where the honest thing is a question rather than a
            guess -- "Equinox" is fourteen gyms in Manhattan. One tap asks it in
            the thread instead of making the user retype the whole request. */}
        {ambiguous && onAsk ? (
          <Pressable
            onPress={() =>
              onAsk(
                `Which ${place.name}${place.neighborhood ? ` near ${place.neighborhood}` : ''}? Give me the address and hours for the closest one.`,
              )
            }
            accessibilityRole="button"
            accessibilityLabel={`Ask which ${place.name}`}
            hitSlop={6}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignSelf: 'flex-start' })}
          >
            <View
              style={{
                paddingHorizontal: 9,
                paddingVertical: 3,
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: cl.gold40,
              }}
            >
              <Text variant="captionSm" style={{ color: cl.goldDeep, fontSize: 11 }}>
                Which one?
              </Text>
            </View>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

export function PlaceCards({
  places,
  ask,
  onAsk,
}: {
  places: Place[];
  /**
   * The clause of the question this section answers, in the user's own words.
   *
   * Present only on a multi-part turn, where three sections on screen need to
   * say which part of the question each of them belongs to.
   */
  ask?: string;
  onAsk?: (question: string) => void;
}) {
  if (!places || places.length === 0) return null;

  // WHICH CARDS CANNOT SAY WHICH BRANCH THEY ARE.
  //
  // Two cases, and they are the same question to the reader: no street address
  // at all, or a name that appears twice in this very list. Computed here
  // rather than in the card because the duplicate test needs the whole set.
  const nameCount = new Map<string, number>();
  for (const p of places) {
    const k = (p.name ?? '').trim().toLowerCase();
    if (k) nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
  }
  const isAmbiguous = (p: Place) => {
    const hasAddress = typeof p.address === 'string' && p.address.trim().length > 0;
    const dupe = (nameCount.get((p.name ?? '').trim().toLowerCase()) ?? 0) > 1;
    return dupe || !hasAddress;
  };

  // TWO UP, WRAPPING. One full-width card per venue meant three places filled
  // the screen and the answer under them was off it. These are reference cards
  // -- a name, what it is, where -- and that fits in half a width, so twice as
  // many are visible before anybody scrolls. A single place still gets the full
  // width, because a lone half-width card next to nothing reads as a loading
  // state.
  const half = places.length > 1;

  return (
    <View style={{ gap: 9 }}>
      {/* Not "SPOTS FOR THIS PLAN" any more. These cards are no longer only
          restaurants for a dinner — a library, a coworking floor and a company's
          office all come through here, and a heading about a plan is wrong for
          every one of them. The turn's own note above this says what they are. */}
      <View style={{ gap: 2 }}>
        <Text variant="captionSm" style={{ color: LIGHT.textSecondary, letterSpacing: 1 }}>
          PLACES
        </Text>
        {ask ? (
          <Text variant="captionSm" style={{ color: LIGHT.textMuted }} numberOfLines={2}>
            {`For: ${ask}`}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        {places.map((p, i) => (
          <View
            key={`${p.name}-${i}`}
            // flexBasis rather than width: the gap is inside the row, so a
            // hard 50% would overflow by exactly one gap on every second card.
            style={half ? { flexGrow: 1, flexBasis: '47%', minWidth: 150 } : { width: '100%' }}
          >
            <PlaceCard place={p} ambiguous={isAmbiguous(p)} onAsk={onAsk} />
          </View>
        ))}
      </View>
    </View>
  );
}
