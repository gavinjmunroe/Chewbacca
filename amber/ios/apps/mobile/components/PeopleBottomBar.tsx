import type { ReactNode } from 'react';
import { View } from 'react-native';
import { GlassSurface } from './LiquidGlass';
import { cl, HAIRLINE } from '../lib/classical';
import { hc, hShadow } from '../lib/homeSurface';
import { PEOPLE_BAR_H } from '../lib/peopleBar';

// THE SHELL THE ONE BOTTOM BAR IS MADE OF.
//
// Height, radius, material, padding and gap all live here and the caller cannot
// override them. What differs between tabs is only what goes INSIDE -- the
// record button leads every mode, a clear or a send trails -- plus the
// placeholder. That is the whole intended difference, and now it is the only
// possible one, because "make the two bars match" was attempted four times
// before "make it one bar" was.
//
// Positioning stays with the caller, which derives it from peopleBarBottom().
//
// ── THE MATERIAL, AND WHY IT IS BACK ────────────────────────────────────────
//
//   "Liquid glass on the search bar seems to be gone. Let's bring back an
//    opaque liquid glass search bar."
//
// It went when the palette went white: the glass had spent four rounds of
// tuning fighting a warm gradient showing through the placeholder, and on a
// white page a plain white pill answered every one of those complaints at once.
// It also threw away the thing that made the bar look like a physical object
// sitting above the page rather than a rectangle painted on it.
//
// OPAQUE AND GLASS IS NOT A CONTRADICTION, and it is the whole instruction. The
// old bar used `clear`, the THIN material, which refracts rather than frosts --
// beautiful at the rim and the reason a feed card scrolling underneath stayed
// legible right through the words. That is what four rounds of raising the tint
// were chasing, and past about 0.75 the tint painted over the refraction and the
// bar read as plastic. So the fix is not more tint on the thin material: it is
// the DENSE one.
//
// `regular` frosts what is behind it. Nothing scrolling under this bar is
// legible through it at any tint, which is the "opaque" half, and the material
// still catches light along its rim and picks up the warmth of whatever passes
// beneath -- which is the "glass" half, and is the part a flat white rectangle
// cannot do. The tint sits just under full white so the frost has a surface
// rather than a haze.
//
// ── AND A WHITE RIM ON A WHITE PAGE IS NOT AN EDGE ──────────────────────────
//
//   "The search bars in the voice chat look too see-through. I can barely see
//    the outline of it, and the search bar in the regular place is too opaque.
//    It should be liquid glass, but clear that it is the search bar and distinct
//    from the rest of the screen."
//
// Both halves of that are ONE mistake, and this file's own palette already had
// the answer written down. From lib/classical: "A CARD ON A WHITE PAGE NEEDS AN
// EDGE, and it did not before... On white paper that is a white rectangle on
// white and the card disappears." That is why `cardEdge` exists.
//
// The rim here was rgba(255,255,255,0.72) -- a near-white lens edge, correct
// when this bar floated over a warm gradient and invisible the moment the page
// went white. With no edge, the bar has only two ways to read: over empty space
// it is a white slab with no boundary (the "too opaque" one), and over scrolling
// text it is a faint cloud you have to hunt for (the "too see-through" one).
// Same component, same material, both complaints, one cause.
//
// So the rim is the page's own hairline, which is visible against white, and the
// material keeps doing the part a border cannot: frosting whatever passes
// underneath so nothing is ever legible through the field somebody is typing in.
// Glass for the character, an edge for the boundary, a shadow for the lift.

export function PeopleBottomBar({
  left,
  right,
  children,
  pointerEvents,
}: {
  /** Leading glyph. Absent on Circles, where the field starts at the edge. */
  left?: ReactNode;
  /** Trailing controls: mic, send, clear. */
  right?: ReactNode;
  /** The text field itself. */
  children: ReactNode;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
}) {
  return (
    <GlassSurface
      pointerEvents={pointerEvents}
      // The dense material. See the note above: `clear` is the one that lets a
      // scrolling card show through the placeholder, and no amount of tint fixes
      // that without turning the bar into plastic.
      glassStyle="regular"
      /**
       * NEAR SOLID, SO THE FILL DOES NOT MOVE WITH THE PAGE.
       *
       *   "The one on the home screen is fine now, but the one in the chat
       *    itself is still blending in too much with the background."
       *
       * One bar, two readings, and this is the half the rim could not fix. A
       * frosted surface takes its color from what is behind it: over the home
       * page's white space it stays white, and over a screen of dark chat text
       * it goes gray. So in the one place the bar most needs to stand out, its
       * fill drifts toward the page it is sitting on.
       *
       * At 0.90 there was enough material showing to let that happen. At 0.97
       * the fill is effectively constant and the glass shows in the rim and the
       * way light catches the edge, which is where it reads as glass anyway --
       * a frosted panel's body is not what anybody recognizes, its edge is.
       */
      tintColor="rgba(255,255,255,0.97)"
      // iOS < 26 and Android have no material to frost, so they get the honest
      // thing: the same opaque white pill that shipped before this, at the same
      // weight, so the two platforms do not drift apart in a way nobody is
      // looking at.
      fallbackStyle={{
        // Opaque already, so it never had the drift the glass path did. The
        // shadow above is on the shared style, so both platforms lift the same.
        backgroundColor: hc.bg,
      }}
      style={{
        flexDirection: 'row',
        // Center, not flex-end: the field grows upward as the text wraps, and
        // bottom-aligning made the leading glyph sit lower on a wrapped line.
        alignItems: 'center',
        gap: 10,
        minHeight: PEOPLE_BAR_H,
        borderRadius: PEOPLE_BAR_H / 2,
        paddingLeft: 18,
        paddingRight: 14,
        borderWidth: HAIRLINE,
        // The page's own hairline. Visible on white, which a white rim is not.
        borderColor: cl.cardEdge,
        /**
         * THE LIFT, AND IT IS DOING MORE WORK HERE THAN ANYWHERE ELSE.
         *
         * hShadow.float is tuned for this bar over the home page's white space,
         * where a 10% shadow at 16pt is plenty to separate white from white. In
         * Voice Chat the bar floats over a screen of text, and against that the
         * same shadow disappears into the noise -- which is the other half of
         * "it blends in too much with the background".
         *
         * Deepened HERE rather than in the token, because hShadow.float is also
         * the tab pill's and this is not a complaint about the tab pill.
         */
        shadowColor: hShadow.float.shadowColor,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.16,
        shadowRadius: 20,
        elevation: 12,
        // Clips the material to the pill. Without it the frost squares off at
        // the corners on the glass path.
        overflow: 'hidden',
      }}
    >
      {left ?? null}
      <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>{children}</View>
      {right ?? null}
    </GlassSurface>
  );
}
