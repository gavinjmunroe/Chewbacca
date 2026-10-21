import { Dimensions, Linking, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { LIGHT } from '../lib/theme';
import { radius } from '../lib/tokens';
import {
  SAFE_URL,
  parseAnswer,
  plainLength,
  tokenizeInline,
  type Block,
} from '../lib/answerMarkdown';

// THE ANSWER RENDERER.
//
// This replaces a 60-line "MarkdownLight" that understood paragraphs, "- " bullets
// and **bold**, and nothing else. That was fine while every answer was three
// sentences of prose. It is not fine now that Ask is meant to stand in for
// Perplexity: "list ten VPs of finance in New York" comes back as a markdown TABLE
// with a link in each name cell, and the old renderer printed that as a wall of pipe
// characters — the answer was correct and the screen was unreadable.
//
// What it handles, and why each one is here rather than "nice to have":
//   - TABLES. The only sane shape for rows of things with the same attributes.
//     Horizontally scrollable, because four columns of real content do not fit in
//     390pt and truncating a table is worse than scrolling one.
//   - LINKS. A recommendation you cannot open is a dead end.
//   - ORDERED LISTS. "top 5" answers are numbered, and renumbering them as bullets
//     throws away the ranking, which was the question.
//   - [1] CITATIONS. Tappable, resolved against the same source list the chips under
//     the answer use, so a claim can be checked where it is made.
//
// Deliberately NOT a markdown library: react-native-markdown-display and friends
// bring a parser plus their own styling system, and all of the above is a handful of
// regexes over line-oriented text the model is explicitly told to produce. The
// parsing lives in lib/answerMarkdown.ts (pure, and therefore testable); this file
// is only the drawing.

export type AnswerSource = { title: string; url: string };

function openLink(url: string) {
  // These URLs come out of a third-party search API and land in a string the model
  // rewrote. openURL will hand ANY scheme to whatever app claims it — including this
  // one, which would turn a citation into a deep link into the user's own account.
  // So the scheme is checked here, at the single place a link is opened.
  if (!SAFE_URL.test(url)) return;
  void Linking.openURL(url).catch(() => {});
}

function Inline({
  text,
  sources,
  keyPrefix,
}: {
  text: string;
  sources?: AnswerSource[];
  keyPrefix: string;
}) {
  return (
    <>
      {tokenizeInline(text).map((t, i) => {
        const key = `${keyPrefix}-${i}`;
        switch (t.kind) {
          case 'bold':
            return (
              <Text key={key} style={{ fontWeight: '700' }}>
                {t.text}
              </Text>
            );
          case 'italic':
            return (
              <Text key={key} style={{ fontStyle: 'italic' }}>
                {t.text}
              </Text>
            );
          case 'link':
            return (
              <Text
                key={key}
                onPress={() => openLink(t.url)}
                accessibilityRole="link"
                style={{ color: '#8C491A', textDecorationLine: 'underline' }}
              >
                {t.text}
              </Text>
            );
          case 'cite': {
            const src = sources?.[t.n - 1];
            // With no matching source the number stays plain text rather than
            // becoming a tappable thing that does nothing.
            if (!src) return <Text key={key}>{`[${t.n}]`}</Text>;
            return (
              <Text
                key={key}
                onPress={() => openLink(src.url)}
                accessibilityRole="link"
                accessibilityLabel={`Source ${t.n}: ${src.title}`}
                style={{ color: '#8C491A', fontVariant: ['tabular-nums'] }}
              >
                {`[${t.n}]`}
              </Text>
            );
          }
          default:
            return <Text key={key}>{t.text}</Text>;
        }
      })}
    </>
  );
}

const CELL_MIN = 96;
const CELL_MAX = 190;
// The width an answer actually gets: screen less the Ask surface's horizontal
// padding. Used to decide whether a table overflows, which is what tells the
// reader there is more to the right.
const CONTENT_W = Dimensions.get('window').width - 32;

function AnswerTable({
  head,
  rows,
  sources,
}: {
  head: string[];
  rows: string[][];
  sources?: AnswerSource[];
}) {
  // Width per column from the longest cell in it, clamped. Measuring text properly
  // would need onTextLayout per cell and a second render pass; character count is
  // wrong by a few points and right about which column needs the room.
  const natural = head.map((h, c) => {
    const longest = Math.max(
      plainLength(h),
      ...rows.map((r) => plainLength(r[c] ?? '')),
    );
    return Math.min(CELL_MAX, Math.max(CELL_MIN, longest * 7.2));
  });
  const naturalTotal = natural.reduce((a, b) => a + b, 0);

  // COLUMNS FILL THE TABLE THEY ARE DRAWN IN.
  //
  // The body below stretches to the answer's full width so a narrow table is not
  // a stub in the left half of the screen -- but the columns kept their natural
  // widths, so a two-column table left a dead strip on the right where the
  // header's background and the row rules simply stopped. It read as a phantom
  // third column with nothing in it.
  //
  // The slack is shared out in proportion, so the wider column stays the wider
  // one, and the last column absorbs the rounding so the edges line up exactly.
  const tableW = Math.max(naturalTotal, CONTENT_W - 2);
  const widths =
    naturalTotal > 0 && naturalTotal < tableW
      ? (() => {
          const scaled = natural.map((w) => Math.floor((w / naturalTotal) * tableW));
          const drift = tableW - scaled.reduce((a, b) => a + b, 0);
          scaled[scaled.length - 1] += drift;
          return scaled;
        })()
      : natural;
  // Does it overflow? Drives both the scroll indicator and the fade below — a
  // table wider than the screen used to give the reader no signal at all that
  // columns four and five existed.
  const overflows = naturalTotal > CONTENT_W;

  return (
    <ScrollView
      horizontal
      // Shown only when there is somewhere to scroll. Always-on is noise under a
      // two-column table; always-off is what hid the extra columns.
      showsHorizontalScrollIndicator={overflows}
      persistentScrollbar={overflows}
      // The table scrolls sideways inside a vertically scrolling answer inside a
      // horizontal pager. Without the lock, a diagonal drag here gets claimed by
      // something else and the table never moves.
      directionalLockEnabled
      style={{
        borderWidth: 1,
        borderColor: 'rgba(32,30,29,0.12)',
        borderRadius: radius.lg,
        backgroundColor: 'rgba(255,255,255,0.55)',
      }}
    >
      {/* minWidth so a narrow table fills the answer column instead of sitting as a
          192-point stub in the left half of the screen. */}
      <View style={{ width: tableW }}>
        <View
          style={{
            flexDirection: 'row',
            borderBottomWidth: 1,
            borderBottomColor: 'rgba(32,30,29,0.14)',
            backgroundColor: 'rgba(178,98,45,0.06)',
          }}
        >
          {head.map((h, c) => (
            <View
              key={`h${c}`}
              style={{ width: widths[c], paddingHorizontal: 10, paddingVertical: 9 }}
            >
              <Text variant="captionSm" style={{ color: '#8C491A', letterSpacing: 0.6 }}>
                {h.toUpperCase()}
              </Text>
            </View>
          ))}
        </View>
        {rows.map((r, ri) => (
          <View
            key={`r${ri}`}
            style={{
              flexDirection: 'row',
              borderBottomWidth: ri === rows.length - 1 ? 0 : 1,
              borderBottomColor: 'rgba(32,30,29,0.08)',
            }}
          >
            {r.map((cell, c) => (
              <View
                key={`c${c}`}
                style={{ width: widths[c], paddingHorizontal: 10, paddingVertical: 9 }}
              >
                <Text variant="bodySm" style={{ color: LIGHT.textPrimary, lineHeight: 19 }}>
                  <Inline text={cell} sources={sources} keyPrefix={`t${ri}-${c}`} />
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// SPACE BETWEEN BLOCKS IS WHAT MAKES AN ANSWER SCANNABLE, and there used to be one
// number for all of it: `gap: 12`, everywhere. A heading got 16 above and 12 below,
// which is barely more than the gap between two paragraphs — so sections did not
// read as sections and the whole answer came out as one gray slab.
//
// The rule is that a break BEFORE a new idea is bigger than the break inside one.
// A heading opens an idea, so it takes the most; a list belongs to the sentence
// that introduced it, so it takes the least.
function gapBefore(prev: Block | undefined, next: Block): number {
  if (!prev) return 0;
  if (next.type === 'h') return 22; // a new section
  if (next.type === 'hr') return 16;
  if (prev.type === 'h') return 8; // a heading and its first line belong together
  if (next.type === 'table') return 16;
  if (prev.type === 'table') return 16;
  // A list right after the paragraph that introduces it is one thought.
  if ((next.type === 'ul' || next.type === 'ol' || next.type === 'todo') && prev.type === 'p') {
    return 8;
  }
  return 13;
}

export function RichAnswer({ text, sources }: { text: string; sources?: AnswerSource[] }) {
  const blocks = parseAnswer(text);
  return (
    <View>
      {blocks.map((b, i) => {
        const mt = gapBefore(blocks[i - 1], b);
        if (b.type === 'p') {
          return (
            <Text
              key={i}
              variant="bodyMd"
              // 25, not 23. The bodyMd token is 16/26 and this was overriding it
              // tighter in three places, which is most of why paragraphs read as
              // dense next to the rest of the app.
              style={{ color: LIGHT.textPrimary, lineHeight: 25, marginTop: mt }}
            >
              <Inline text={b.text} sources={sources} keyPrefix={`p${i}`} />
            </Text>
          );
        }
        if (b.type === 'table') {
          return (
            <View key={i} style={{ marginTop: mt }}>
              <AnswerTable head={b.head} rows={b.rows} sources={sources} />
            </View>
          );
        }
        // A SECTION LABEL. Small, uppercase and gold at h2 so it reads as a divider
        // between groups rather than as another line of the answer — an answer that
        // is two or three short sections wants a label, not a bigger sentence.
        if (b.type === 'h') {
          return (
            <Text
              key={i}
              variant={b.level === 2 ? 'captionSm' : 'titleSm'}
              style={
                b.level === 2
                  ? {
                      color: '#8C491A',
                      textTransform: 'uppercase',
                      letterSpacing: 0.8,
                      marginTop: mt,
                    }
                  : { color: LIGHT.textPrimary, marginTop: mt }
              }
            >
              {b.text}
            </Text>
          );
        }
        if (b.type === 'hr') {
          return (
            <View
              key={i}
              style={{ height: 1, backgroundColor: 'rgba(32,30,29,0.10)', marginTop: mt }}
            />
          );
        }
        // A CHECKLIST. The to-do case is the whole reason this exists: reading back
        // "clean up bugs, prepare investor messages, set up experiments" as a
        // paragraph is the complaint, and as squares it is a glanceable list.
        if (b.type === 'todo') {
          return (
            <View key={i} style={{ gap: 10, marginTop: mt }}>
              {b.items.map((it, j) => (
                <View key={j} style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start' }}>
                  <View
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      borderWidth: 1.5,
                      marginTop: 3,
                      borderColor: it.done ? '#8C491A' : 'rgba(32,30,29,0.28)',
                      backgroundColor: it.done ? '#8C491A' : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {it.done ? (
                      <Text variant="captionSm" style={{ color: '#FFF8F0', fontSize: 10, lineHeight: 12 }}>
                        ✓
                      </Text>
                    ) : null}
                  </View>
                  <Text
                    variant="bodyMd"
                    style={{
                      color: it.done ? LIGHT.textSecondary : LIGHT.textPrimary,
                      flex: 1,
                      lineHeight: 25,
                    }}
                  >
                    <Inline text={it.text} sources={sources} keyPrefix={`t${i}-${j}`} />
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        const ordered = b.type === 'ol';
        return (
          <View key={i} style={{ gap: 9, marginTop: mt }}>
            {b.items.map((it, j) => (
              <View key={j} style={{ flexDirection: 'row', gap: 8 }}>
                <Text
                  variant="bodyMd"
                  style={{
                    color: ordered ? '#8C491A' : LIGHT.textSecondary,
                    minWidth: ordered ? 18 : undefined,
                    fontVariant: ordered ? ['tabular-nums'] : undefined,
                  }}
                >
                  {ordered ? `${(b.type === 'ol' ? b.start : 1) + j}.` : '•'}
                </Text>
                <Text variant="bodyMd" style={{ color: LIGHT.textPrimary, flex: 1, lineHeight: 25 }}>
                  <Inline text={it} sources={sources} keyPrefix={`l${i}-${j}`} />
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}
