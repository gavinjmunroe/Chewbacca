# Sections

Phase 0.1. Generated 2026-09-28 from `m2_REF.json` and
`m2_OURS.json`, both measured at 1440 with the viewport placed AT each section
rather than from one pass after walking the page. The first attempt did walk
first, and read the reference's hero as unmounted and our heading at x=296
against its true 531, so every number here comes from the corrected pass.

    reference   17852px, 11 sections
    ours        19323px, 12 sections

## Pairing

By position and role, written by hand. Heading text cannot do this: our copy is
deliberately not theirs, so a text match lands on 5 of 11 and pairs the rest
silently wrong.

| # | theirs | ours | role |
|---|---|---|---|
| hero | `Stop guessing why your agents fail` y342 h10834 | `Your agent failed and nothing thre` y340 h978 | |
| trace scene (inside their hero block, its own section on ours) | **none** | `Your agents fail silently.` y1318 h9258 | |
| surface failures | `Surface failures you didn't know t` y11176 h928 | `Surface failures you didn't know t` y10576 h3443 | |
| notifications | `Get notified on what matters.` y12104 h908 | `Hear about it in the channel you a` y15634 h615 | |
| fix where you work / MCP | `Fix it where you work.` y13012 h886 | `Two lines of config, then ask in p` y16249 h917 | |
| read the spans / ship with confidence | `Ship with confidence.` y13898 h662 | `Read every span, not just the ones` y15064 h570 | |
| fits into your stack | `Fits into your existing stack.` y14560 h697 | `Fits into your existing stack.` y17166 h518 | |
| trust | `Trust is non-negotiable.` y15257 h588 | `Trust is non-negotiable.` y17684 h482 | |
| testimonials (ours renders but carries no h2) | `What people are saying.` y15845 h643 | **none** | |
| subscribe (folded into our briefing section) | `Subscribe` y16488 h31 | **none** | |
| friday briefing | `The Friday briefing on AI agent ob` y16519 h639 | `The Friday briefing on AI agent ob` y18166 h577 | |
| closing CTA | `Start improving your agents today` y17158 h694 | `Start improving your agents today` y18743 h580 | |
| failure wall  OURS ONLY | **none** | `Your agents fail without raising a` y14019 h781 | |
| counter  OURS ONLY | **none** | `Your agents left 4 5 6 7 8 9 0 1 2` y14800 h264 | |

## Their sections, measured

| # | heading | y | height | h2 | align | x | lines | lead | gap | shapes | controls | largest block |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Stop guessing why your agents fail | 342 | 10834 | 40px | center | 550 | 2 | 15px | 8 | 2260 | 15 | 560x231 (19 kids) |
| 1 | Surface failures you didn't know t | 11176 | 928 | 36px | left | 224 | 2 | 18px | 8 | 165 | 15 | 1040x3600 (508 kids) |
| 2 | Get notified on what matters. | 12104 | 908 | 36px | left | 224 | 2 | 18px | 8 | 29 | 15 | 1040x3600 (528 kids) |
| 3 | Fix it where you work. | 13012 | 886 | 36px | left | 224 | 1 | 18px | 8 | 29 | 15 | 1040x3600 (549 kids) |
| 4 | Ship with confidence. | 13898 | 662 | 36px | left | 224 | 1 | 18px | 8 | 29 | 15 | 1040x3600 (482 kids) |
| 5 | Fits into your existing stack. | 14560 | 697 | 36px | center | 344 | 1 | 18px | 8 | 7 | 26 | 1040x3600 (508 kids) |
| 6 | Trust is non-negotiable. | 15257 | 588 | 36px | center | 344 | 1 | 18px | 8 | 5 | 14 | 1280x705 (187 kids) |
| 7 | What people are saying. | 15845 | 643 | 36px | center | 336 | 1 | 14px | 69 | 18 | 38 | 1280x705 (187 kids) |
| 8 | Subscribe | 16488 | 31 | 18px | start | 837 | 1 | 14px | 12 | 5 | 40 | 1280x705 (187 kids) |
| 9 | The Friday briefing on AI agent ob | 16519 | 639 | 36px | start | 113 | 2 | 10px | 57 | 5 | 40 | 1280x705 (187 kids) |
| 10 | Start improving your agents today | 17158 | 694 | 36px | center | 466 | 1 | - | - | 7 | 23 | 1280x527 (28 kids) |

## Our sections, measured

| # | heading | y | height | h2 | align | x | lines | lead | gap | shapes | controls | largest block |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Your agent failed and nothing thre | 340 | 978 | 40px | center | 296 | 2 | 15px | 8 | 2231 | 12 | 1200x496 (144 kids) |
| 1 | Your agents fail silently. | 1318 | 9258 | 36px | center | 16 | 1 | - | - | 1918 | 10 | 1200x496 (144 kids) |
| 2 | Surface failures you didn't know t | 10576 | 3443 | 36px | start | 296 | 3 | 18px | 14 | 474 | 10 | 880x460 (99 kids) |
| 3 | Your agents fail without raising a | 14019 | 781 | 36px | start | 136 | 2 | 18px | 16 | 3 | 10 | 1200x793 (275 kids) |
| 4 | Your agents left 4 5 6 7 8 9 0 1 2 | 14800 | 264 | 32px | start | 296 | 2 | 16px | 20 | 13 | 12 | 1200x793 (275 kids) |
| 5 | Read every span, not just the ones | 15064 | 570 | 36px | start | 136 | 2 | 16px | 18 | 17 | 12 | 1200x486 (173 kids) |
| 6 | Hear about it in the channel you a | 15634 | 615 | 36px | start | 136 | 2 | 18px | 14 | 9 | 11 | 1200x486 (173 kids) |
| 7 | Two lines of config, then ask in p | 16249 | 917 | 36px | center | 447 | 2 | 15px | 12 | 21 | 12 | 1200x425 (46 kids) |
| 8 | Fits into your existing stack. | 17166 | 518 | 36px | start | 280 | 1 | 18px | 14 | 27 | 24 | 880x517 (21 kids) |
| 9 | Trust is non-negotiable. | 17684 | 482 | 36px | start | 280 | 1 | 18px | 14 | 3 | 13 | 880x517 (21 kids) |
| 10 | The Friday briefing on AI agent ob | 18166 | 577 | 36px | start | 296 | 3 | 16px | 106 | 3 | 15 | 880x481 (15 kids) |
| 11 | Start improving your agents today | 18743 | 580 | 36px | center | 280 | 1 | - | - | 3 | 25 | 880x398 (21 kids) |

## What the two tables say on their own

**Their feature sections are a strict template and ours are not.** Sections 1 to
5 on theirs all run h2 36px, left, at x=224, with an 18px lead 8px beneath it,
every time. Ours put the heading at 296, 136, 296, 136, 136, 447, 280, 280, 296
and 280, with leads between 15 and 18px and gaps between 12 and 106px.

**Their four middle sections each hold a 1040x3600 block with roughly 500
children.** That is a tall pinned container carrying the product UI panels. Our
counterparts hold 880x460 to 1200x793 with 15 to 275 children. This is the
content gap, and it is the largest single item on the page.

**We have two sections they do not** (failure wall, counter) and **they have one
we render without a heading** (testimonials). Their Subscribe and Friday briefing
are two sections; ours is one.

**Our trace scene is its own 9258px section**; on theirs it lives inside the
10834px hero block. Whether that difference matters depends on how the hero
pinning is structured, which is Phase 0.3.


## The feature-section template, recovered 2026-09-28

Walking the DOM from their "Surface failures" h2 up to the page container
gives the whole thing, and it is not four sections with four panels:

    SECTION                              full width, page background
      DIV   max-width 1040, centred, padding 0 24px      content 992
        DIV grid, columns 384px + 544px, gap 64          384+64+544 = 992
          DIV  text column, 384 wide
            DIV  h-svh, flex column, justify-center      one viewport tall,
              h2 + lead                                  vertically centred
          DIV  media column, 544 wide, 3600 TALL
            DIV  position:sticky, top:0, h-svh           544x900, 504 kids

**The media column is 3600px tall and holds one sticky 900px panel.** 3600 is
four viewport heights. So their four "sections" are four text blocks scrolling
past a SINGLE PINNED PANEL whose content changes as each one passes. That is
why sections 1 through 4 all measured the same `1040x3600` block: it is the
same element, measured four times.

Their four heights are 928, 908, 886 and 662, summing to 3384 against the
3600 of the media column.

Ours is four separate sections, each with its own small panel, which is why
the heading x drifts (296, 136, 296, 136) and why our panels are 880x460 to
1200x793 where theirs is one 544x900 pinned surface.

This is the single largest structural difference left on the page, and it
explains both the heading-position drift and the content gap at once.

## Correction: our pinned demo already matches theirs

Measured directly rather than through the section walk, because the walk is
wrong about pinned elements: `rect.top + scrollY` is not a stable page
position for something that sticks, so one pinned h2 showing four different
titles reads as four separate sections.

    #run2          y10272   3600px   the pinned demo    <- matches theirs exactly
    #waterfall     y13872    486px   own h2
    #chat-mock     y14358    601px   own h2
    #integrations  y14959    698px   own h2
    #testimonials  y15685    218px   no h2

`#run2` is 3600px, which is their media column's height to the pixel, and its
DEMO array already carries their four titles in order: Traces, Live alerts,
Sift MCP, Metrics. So the hard structural part of the feature template was
already built and is already right.

What is wrong is that `#waterfall`, `#chat-mock` and `#integrations` sit
AFTER it as three more standalone sections, 1785px of content with no
counterpart on theirs, covering ground the pinned demo already covers.

Their panel content is exactly what the pinned demo's four panels need, so
the move is to fold those three renders into the DEMO array and cut the
standalone sections. That closes the duplicate sections and most of the
content gap in one change, and it means Phase 4 is substantially already
built and merely mounted in the wrong place.
