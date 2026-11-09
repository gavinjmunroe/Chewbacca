# Craft floor

The floor holds the mechanics. It never picks the direction: the mode, stance
and theme in SKILL.md do that. Run Verify on the built result in the same
capture round as step 6, not as separate screenshot trips.

_Verify and Refuse from pbakaus/impeccable `skill/reference/craft-floor.md`,
Apache-2.0, at `e103efe`, trimmed. Countable checks from Leonxlnx/taste-skill
`skills/taste-skill/SKILL.md` §4 and §14, MIT, at `ce26fc2`._

## Verify

- **Contrast:** body and placeholder text at least 4.5:1, large text 3:1. On colored surfaces, tint secondary text from that hue or the foreground, never gray.
- **Depth:** shadows carry an offset and a soft blur. A zero-offset colored halo is decoration.
- **Spacing:** tight groups, generous separation, more space above a heading than below it. Read the computed values.
- **Type:** body measure 65 to 75ch, display max 6rem, tracking floor -0.04em, obvious scale and weight steps. Run the real copy at every breakpoint and fix what overflows.
- **Motion:** one authored moment, not scattered effects and not one identical entrance on every section. Exponential ease-out from an already-visible default.
- **States:** hover, disabled, loading, error, empty, plus real content, working controls and keyboard focus.
- **Browser surfaces:** text selection, the caret, scrollbars, focus rings, underline offset and tabular numerals ship with browser defaults. Theme them from the palette. Impeccable calls this the cheapest signal "that a page was built rather than assembled, and the one models skip most reliably."
- **Copy:** the product's own language. Controls name their action; errors name the problem and the recovery.
- **Coverage:** every brief requirement present and findable within seconds.

## Refuse

These are the category's defaults, and the brief's own words can earn one
back. The eyebrow is the exception. Reaching for any of them when nothing asked
for it means nobody decided.

- Same-size cards of icon plus heading plus text as the page structure. Nested cards are always wrong.
- The hero-metric template on a Persuade page: big number, small label, supporting stats, accent. A dashboard's stat tile is a named organism in the taxonomy, not this.
- **A kicker or eyebrow above a heading, always.** No brief earns it back. The Amber Circles failure in SKILL.md had one over every heading.
- Section numbers (01 / 02 / 03) unless the sequence itself carries information.
- A modal for a task that needs neither interruption nor protected focus.
- Gradient text. Emphasis comes from weight or size.
- Glass and blur as decoration rather than as a specific effect.
- A colored `border-left` or `border-right` above 1px on cards, list items, callouts or alerts.
- Hard offset shadows (`box-shadow: 4px 4px 0`) outside a world that is actually neobrutalist.
- Sparklines, progress rings and soft-shadowed rectangles standing in for content instead of carrying data.
- Monospace as a costume for "technical" rather than for code, data or measurement.
- Unicode glyphs or emoji standing in for an icon system.
- Light or dark picked by category. Pick it from the use scene: who, where, under what light.

## Countable checks

A script can fail these, so count them instead of judging:

- **Eyebrows:** the target is zero, per the ban above. A count above `ceil(sections / 3)` fails the page outright.
- **Layout families:** no family used twice, and at least 4 families across 8 sections.

Left out: Impeccable's motion line also says to "reach past transform and
opacity" to blur, clip-path, mask and shadow. [library/crafts/web-ux.md](../../../library/crafts/web-ux.md)
says animate `transform` and `opacity`, nothing else, and that rule stands.
