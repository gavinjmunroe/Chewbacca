# The video corpus

Ninety-five YouTube transcripts, pulled 2026-09-22, on UI craft and on how
taste is acquired. Caleb sent two videos and asked for a lot more like them.

**How it was built.** Forty-two search queries through `yt-dlp`, 573 unique
videos, filtered to 380 topically relevant, then selected into four tiers and
transcribed with `yt-transcript`. The selection and the searches are in the
session scratchpad; `data/videos.json` carries what survived, with view counts,
durations and channels.

| Tier | What it holds |
| --- | --- |
| `taste` | How taste is acquired. Linear's CTO, Anthropic's design lead, Dive Club interviews, art-critique teaching |
| `think` | How to decide, rather than what to draw. Amateur versus pro teardowns, Apple's WWDC principles, the UX laws |
| `craft` | Typography, spacing, colour, motion, grids, design systems. This is where the numbers live |
| `ai` | Why generated interfaces read as generated, and what people are doing about it |

**Search it, do not read it.** `ux-video "spacing"` returns the quote and a
`youtu.be` link that jumps to the timestamp. Reading 233,615 words costs more
than inventing an answer, which is the exact failure that puts a violet
gradient on every generated page.

**These are auto-generated captions.** They are lossy in a way that matters for
search: the 8pt grid video says "eight point grid" in its captions and never
"8pt", so a numeric search misses it. Search the words people say, not the
notation they would have typed.

**A video is a claim, not evidence.** Nothing in here was measured by the person
saying it. `COVERAGE.md` sets the bar: reading source and counting things beat
reading articles, every time. What this corpus is good for is finding what
practitioners agree on, where they contradict each other, and which claims are
worth going and measuring.
