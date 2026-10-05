# Short-form video (Reels, Shorts, TikTok) and the YouTube creative

Researched 2026-09-27. The main source is a full interview with Jenny Hoyos
(Creator Science, October 2023, transcript kept in the brain at
`research/creative-video/sources/`). She scraped and analysed the transcripts
of thousands of Shorts, including every MrBeast and Ryan Trahan Short, and
averaged 10 million views a Short. The other sources are YouTube's own Shorts
deep dive (2025-01-28), Paddy Galloway's study of 5,400 Shorts (April 2023),
the leaked MrBeast production document (September 2024), Adam Mosseri's
statements on Instagram ranking, and the two platforms' disclosure policies.
Rules only. Where a number is somebody's own channel, it says so.

## The hook

**One second.** "I really do think you have one second to hook someone,
especially on Shorts" (Hoyos, YouTube blog, 2025). Galloway's study says the
same thing from the data side: treat the first second like a thumbnail.

**The hook is the first frame, and it has to work with the sound off.** Hoyos's
test: "if it could be used as a title in thumbnail on a long form and like it
will still get clicks then it'll work for a short... you need to understand it
without even listening to it." She sketches the first frame before she writes
a word. Her dollar-menu series always frames the restaurant's sign, the food
and "$1 Burger" in the same place, because more people know the restaurant
than know her.

**Say it at a fifth-grade level or under.** She runs every script through a
readability formula (readabilityformulas.com). One word moves the grade: she
says what profit means instead of saying "profit", and avoids "business" and
"finance".

## The structure she uses every time

**Hook, then foreshadow, in two lines, three seconds or less.** The foreshadow
sets what the viewer will see at the end: "I'm going to the beach, and I'm
going to surprise someone with $100 at the end of the video."

**Write the last line before filming.** Leave the blank where the reaction
goes: "then I surprised my mom and ___".

**Do not break pace to transition.** She cut "let's get started" and wrote "so
I cooked illegally" instead. Two crucial details have just landed; a third
piece of information makes the viewer drop the first two.

**Tell it with but and therefore, never and then.** "I went on a walk, but it
started raining, therefore I ran home" beats "I went on a walk, then it
rained, then I went home." A story needs change.

**Give it a mechanism the viewer can watch progress.** MrBeast's shrinking
circle. The easiest one: "there are three things we need to do", shown as a
list, so the viewer always knows how close the end is.

**Follow the expectation, then twist it.** The $5 Mother's Day gift arrives as
promised, then her mom drops it and it breaks.

**End right after the payoff.** "Whatever you say you're going to do, you end
it right after you do it." Her retention graph showed a 25-point drop in the
last second of one Short; she trimmed that second, retention went from 83% to
88%, and "the video went flying".

## Retention, length and rewatch

**A viral Short gets rewatched.** Her average swipe-through is 85% (the
platform average she quotes is about 70%) and her average retention is 95%,
which is only possible because people watch twice. She treats 90% as the floor.

**No universal length, so measure your own.** Her channel: under 30 seconds
needed over 100% retention to take off, so she makes them 34 seconds. Galloway
(2023, when Shorts stopped at 60 s): the 50 to 60 second Shorts averaged the
most views, 1.7 million, with outliers at every length. Both are ceilings of
2023 data. Shorts and Reels now run to three minutes (YouTube 2024-10-15;
Mosseri on Threads, January 2025, for Reels in Explore and the Reels tab).

**Retention is not the whole score.** Her own hunch, stated as a hunch: friends
with higher retention than hers get fewer views, and one Short at 70% retention
on its first 100k views still reached 10 million on returning viewers. Shares
she believes in and has not proven: one Short with a 20% share-to-view ratio
had 92% swipe-through.

## The platforms want different cuts

From Hoyos, 2023, when she was big on TikTok first and then on YouTube:
the same video did a million on one and a thousand on the other.

- **YouTube Shorts:** slower, more story, a more mature audience.
- **TikTok:** 10 to 20 seconds, dense, few jokes, made to be scrolled.
- **Reels:** visual, with subtitles on screen every second because people
  watch muted, and built to be sent to someone.

**Instagram ranks on watch time, sends per reach and likes per reach**
(Mosseri, as summarised across 2025 and 2026 coverage). Sends in a DM are the
signal for reaching people who do not follow you. The oft-quoted "three to five
times a like" weighting has no primary source; do not repeat it.

**Instagram does not recommend reposts.** From 2026-04-30 the rule covers every
format: accounts that mostly share content they did not make or meaningfully
change are not recommended to non-followers (Tubefilter, PetaPixel). A
watermark from another app is read as a repost. Export clean masters, never a
TikTok download.

## Long-form YouTube: the MrBeast document

For a creative longer than a Short. The team is judged on three numbers:
click-through rate, average view duration, average view percentage.

- **The idea is the title.** "I Spent 50 Hours In My Front Yard" is lame. "I
  Spent 50 Hours In Ketchup" gets clicked.
- **The first minute proves the thumbnail's promise.** Losing 21 million
  viewers in the first minute of 60 million clicks is a good result.
- **Minutes 1 to 3 go from hype to execution** with a "crazy progression", and
  there is a re-engagement near minute three.
- **Show the wow early.** The crane in "100 Days in the Circle" arrives at 30
  seconds.

## Frame and sound

**1080x1920, 9:16.** Keep text and the subject out of the parts the app draws
over: roughly the top 250 px, the bottom 480 px, and a 140 px rail on the
right above the caption. These are the widest of the published templates, not
a device measurement. `reel-check --sheet` shades them.

**Burn the captions in.** Two to four words on screen at a time, synced to the
voice, big, white, with a dark stroke.

**It has to have sound**, normalised near -14 LUFS with peaks under -1 dBTP.

## Disclosure

**YouTube:** toggle "altered or synthetic content" for anything realistic a
viewer could mistake for real: a real person's likeness, a cloned voice,
altered footage of real places or events. Clearly animated or unrealistic
content, and AI used only for scripts or captions, is exempt
(blog.youtube, 2024-03).

**Instagram and Facebook:** label photorealistic video or realistic audio that
was made or altered by AI, or Meta may penalise it (Meta Transparency Center).
Meta also reads C2PA credentials from the file and labels on its own.

**When in doubt, label it.** A CGI scene of physical objects can pass for
footage; that is the case the rule is written for.

## Production, from the Opus 5.5 video corpus

From athemeroy/awesome-opus-5-5-videos (September 2026: 1,401 distinct videos
people made with Opus 5.5, 168 cases reviewed) and its production guide:

- **Say what done means for the effect first.** "Liquid metal" might be a
  shader or real surface tension; "shattering" might be a graphic wipe or a
  rigid-body solve. The renderer follows from the answer.
- **Three acceptance stages.** Approve a keyframe sheet; render the hardest two
  to four seconds and read 12 to 24 adjacent frames; then watch and listen to
  the whole thing. Nine sampled frames are screening, not acceptance.
- **Motion graphics are now the most common Opus-made style** (350 of 1,119),
  ahead of 3D (324). A crowded style needs a better idea, not better polish.
- **Count the real cost of one accepted video**: model calls, generation
  credits, render time, and human revision time, separately.

## When the brief contradicts these

Say which rule it breaks, in one line. Build the version that follows the
rules. Offer the literal version separately if it is still wanted.
