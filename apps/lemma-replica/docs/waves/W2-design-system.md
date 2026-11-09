# Wave 2: the design system

Closed 2026-09-28. Every number measured at 1440, on both pages, with
`tools/check_measure.py` passing clean before the score was read.

    axes matching   29%  ->  59%   (120 of 205)
    instrument      check exit 0

## Exit criteria

| criterion | target | result | |
|---|---|---|---|
| heading x on every feature block | 224, constant | **224 on all four** | met |
| lead size and gap on feature blocks | 18px / 8px | **18 / 8 on all four** | met |
| Figtree self-hosted | verified | cap 28.01 vs 28.0, x-height 20.00 vs 20.08 | met |
| third-party font requests | 0 | **0** | met |
| container 1040, grid 384+544 gap 64 | verified | applied | met |
| type tuples not present on theirs | 0 unexplained | 0 | met |

## The face

brittiSans is licensed and not distributable, so their `.otf` files are not in
this repo and never will be. Figtree was chosen by measurement: the same
string at 40px in seven free faces, per-letter advance widths, scaled to equal
total width so the comparison is of shape and not size.

    reference brittiSans   cap 28.0   x-height 20.08
    Figtree                cap 28.0   x-height 20.0    err 0.741px
    Inter                  cap 29.1   x-height 21.8    err 0.780px
    Hanken Grotesk         cap 27.9   x-height 19.7    err 0.884px
    DM Sans                cap 28.0   x-height 20.2    err 0.884px
    Manrope                cap 28.8   x-height 21.6    err 0.951px
    Plus Jakarta Sans      cap 29.8   x-height 21.4    err 1.011px
    Outfit                 cap 27.8   x-height 19.0    err 1.063px

Figtree matches their cap height and x-height exactly. Inter ran 4% and 9%
large on both, which is why our type read heavier at an identical point size,
and it mattered more than the letterforms did. Live after the switch: cap
28.01, x-height 20.00. `tools/fontmatch.py` reproduces the table.

All three faces are self-hosted, which is what theirs does, so the page makes
zero third-party font requests. 152KB, latin and latin-ext only, Google's own
unicode-ranges carried across. Licences beside the files.

## Two container widths, not one

Reading only the narrow band had me about to force everything into 880.

    880   narrow bands    fits into your stack, trust
    1280  wide            testimonials, the newsletter

The padding goes inside the container. Putting it on the band and centring an
inner box pads twice, which had our briefing heading at 128 against their 113.

    narrow bands   h_x 344, h_w 752, lead_x 384, lead_w 672, gap 8   exact
    testimonials   1280 container, heading block 768 centred          exact
    newsletter     1280 container, 32 inner padding                   within 1px

## Specificity, three times

`.sub-h`, `.tst-title` and `.news-left h2` all sat last in the file and still
measured wrong, because `section.band h2` is (0,1,2) and a bare class is
(0,1,0). Worth watching for: in this stylesheet, last does not mean winning.

## Six instrument bugs

Every one was found because a number moved while the page had not, and every
one would have sent me editing correct code. Two were introduced by fixing the
previous one.

    1  sampled 26 of 9133 elements and reported "no parallax"
    2  read each element's own transform, missing container-driven motion
    3  the lead finder climbed out of the heading's container
    4  the delta pairing was hardcoded indices and went stale
    5  the page walk unmounted the hero before it could be measured
    6  innerText, then textContent, and both corrupted the heading label

On 6, neither obvious reading works. `innerText` is layout-aware and returns
empty for an element the browser considers not rendered. `textContent` is not
layout-aware but swallows inline `<script>` text and drops the space a `<br>`
renders as. Both corrupt the pairing key.

`tools/check_measure.py` now asserts what a sound reading looks like. Run
against the broken output it caught all eight problems. The scores this build
produced during the afternoon (51, 56, 53, 39) were mostly the instrument
moving; 59% is the first one taken with the check passing.

## Left open, and why

    hero heading x / width      our copy is longer than theirs. A copy
                                question, not a layout one, and it belongs
                                with the Wave 4 copy pass
    testimonials lead           theirs has a 14px byline 69px under the
                                heading, ours has no lead at all. Not the
                                same kind of element; not comparable
    subscribe x / width  +-23   the 1.2fr / 1fr grid resolves slightly
                                differently against our column content
