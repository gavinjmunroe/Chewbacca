---
name: video-script
description: Brainstorm short-form video ideas and write scripts that hold viewers, using the creator's own analytics. Use when deciding what to post next, choosing a hook or angle, writing or tightening a reel, TikTok or Short script before filming, planning talking-head retention, or turning a posted video's insights and retention curve into lessons. Not for cutting footage (video-edit), animation (animated-video), or the visual craft of a short (creative-video).
---

# Video script

A short video is mostly decided before filming, by three choices: the **stake** (who, beyond insiders, has a reason to care), the **first two sentences** (why keep watching), and the **proof** (what the viewer sees that makes the claim real). Make each choice from evidence: the creator's own past videos first, platform statements second, taste last.

## Set up

`SKILL_DIR` below means this skill's folder. Read `~/.video-script/profile.md` if it exists. It names the creator's video library, their findings file, platform notes, voice, pace and standing preferences. Before proposing anything, read the findings file (including any tests still running) and the library index, and cite the past videos an idea resembles.

With no profile, ask once for the platform, the audience, and two past videos with their numbers (one that did well, one that didn't). Then offer to create the profile and a library in the [library format](references/library.md).

Current user instructions override the profile. Where the findings file's evidence conflicts with this skill's defaults, the findings win, because they were measured on this audience.

**Goal** below means one of four things a video is built for: reach (views from non-followers), follows, saves or shares. Personal stories tend to earn follows, lists and tutorials saves, surprise and news shares and reach. The findings file refines this for the creator.

## Choose the task

- **Ideas**: what to make next. Go to section 1.
- **Script**: turn an idea, notes, a transcript or a rough draft into a filmable script. Go to section 2.
- **Review**: a posted video's insights or screenshots. Go to section 3.

A request that spans several runs them in that order. When the request doesn't name a goal, ask once, defaulting to reach. This skill ends at a script or a lesson. Filming belongs to the creator, editing to video-edit, animation to animated-video.

## 1. Ideas

1. Collect material:
   - Ask the creator what they built, learned or lived through recently. Without an answer, use their most recent project folders.
   - News in their field, from primary sources, with dates.
   - Viewer questions, if the creator shares comments.
   - The library's winners and losers.

   A premise you couldn't confirm at its source is marked unverified.
2. Write at least ten candidates, one line each: the idea, who has a stake beyond insiders, and the format. Spread them across at least three formats: news with a stake, personal story, before/after demo, contrarian claim, tutorial or list, skit.
3. Rank them, in this order:
   - Reach: the stake lands with people outside the niche.
   - Proof: showable with footage the creator has or can capture.
   - Hook potential: something surprising that's about the viewer or what's on screen.

   Tag each with its goal. A pattern that failed in the library comes back only as a deliberate test of a fix. An idea that would muddle a test still running waits until that test is read.
4. Develop the top three. For each give:
   - the hook, a first sentence that finishes within 3 seconds
   - the second sentence
   - the proof the viewer will see
   - the goal
   - the library videos it resembles
   - the finding or open hypothesis it relies on or tests

   When two versions of one idea differ mainly in the opening, present them as one [trial pair](references/insights.md#testing), not two ideas.

Save the ideas where the profile says, if it names a place, and read the latest saved backlog before writing new candidates.

Done when three ideas are fully developed and every other candidate stays in the one-line backlog.

## 2. Script

1. State the one idea in one sentence, and its goal. An idea that needs two sentences is two videos; ask which to make first.
2. Find the payoff and the strongest proof first. Write the hook last, by moving the most surprising true claim or proof to second 0.
3. Write the beats with times at the creator's pace (from the profile; default 3 spoken words per second):
   - Hook, 0-3 s. It can be a statement or a question.
   - Second sentence, 3-10 s. It answers the hook's question or raises the stakes.
   - Proof or demo, the body.
   - Background after 15 s, only if the story needs it. Background is anything the viewer needs only to follow a later detail: history, who someone is, how something works. The test: if moving a line to after 15 seconds loses nothing in the first 15, it's background.
   - Payoff: the hook's promise, shown on screen. This is the strongest content line, and the last one.
   - One call to action, in one short line after the payoff.
4. Give every beat its picture: what is on screen, and the capture it needs (screen recording, document, the real person or product). Frame 1 shows the subject the first sentence names. A new picture comes at least every 5 seconds.
5. Check the script against the checklist below, the findings file, and the platform notes the profile names (for example, what the platform declines to recommend). Revise until every item passes or has a stated reason.
6. Deliver:
   - a table of time, spoken line and on-screen picture
   - two alternative hooks, each with its own second sentence
   - headline options for frame 1, if the creator uses on-screen headlines
   - a draft post caption, carrying any caveats and links that don't fit the spoken script
   - the capture list
   - the claims to verify, with sources. A source you couldn't open is flagged for the creator to check before filming.
   - the estimated runtime

   Write the lines in the creator's voice, using the voice guide the profile names if it names one, and keep them easy to say aloud. Write full, connected sentences with the subject named and verbs that describe what happens. A line cut so short that it raises a question ("the full route" of what?) costs more than the seconds it saves. Save the script where the profile says, if it names a place.

Done when the checklist passes, every factual claim has a source or a verify flag, every promise in the hook has a beat that pays it off, and the runtime is in range.

### Checklist

- One idea. A list earns its place only when every item proves the same idea.
- The first sentence finishes within 3 seconds and is about the viewer's stake or what's on screen. Credentials come later, as the reason to believe.
- The second sentence answers the hook or raises the stakes. The seconds from 3 to 10 are where most avoidable losses happen, so they get background, a restated subject, a second credential, "let me explain" or "here are the top N" only as a deliberate test.
- The stake is framed by who it affects, in words a non-expert knows. Tool names and jargon come once the viewer has a reason to care.
- Every claim is shown. Voice, caption and screen give the same number.
- Every promise in the hook is paid off on screen before the end.
- Each line moves the story forward. Lines that restate or announce what's coming are cut.
- The video opens one question and answers it with a real answer.
- The payoff is the last content line, followed by one short call to action.
- Runtime is as short as the story allows: most single-idea videos 30 to 60 seconds, lists under about 40, skits under about 25.

## 3. Review a posted video

1. Collect every number: views, viewers, average watch time, follows, interaction counts, each rate with its label, views by source, and the retention curve with its duration. From a screenshot, read the curve with `python3 SKILL_DIR/scripts/retention_curve.py SHOT --duration SECONDS` and check its area-based average against the app's figure ([reading insights](references/insights.md)). Identify each screenshot's video from its thumbnail, graph dates and view count. Ask when that evidence can't decide.
2. Line the curve up with the final render's captions. For every **cliff** (a steep drop) and **plateau** (a flat stretch), record what was said and shown in the seconds before it.
3. Compare with the library: videos in the same format, and every video's 3→10 s drop, which is where the second sentence acts.
4. Write the video's library entry (analytics, cliffs, reflection) and its index row. Update the findings file. Add the evidence to each hypothesis it touches, and change a hypothesis's status only when two or more videos agree. Before saving, take every quoted line and time from the captions file, give a posting date only with its source, and check every ranking word (highest, lowest, only, best) against the index, scoped to the videos it covers.
5. Delete source screenshots only when the user asks, after every number is recorded and checked against them. Move them to the Trash, not a permanent delete.

Done when every number on every screenshot is either recorded or listed as skipped, every cliff has its passage, and the findings file reflects the new video.

## Related kit skills

- [creative-video](../creative-video/SKILL.md) and `library/crafts/short-form-video.md`: the craft rules for the first frame and the hook; this skill adds the evidence loop from the creator's own numbers.
- [video-edit](../video-edit/SKILL.md): turns the finished script and footage into the cut.
- [animated-video](../animated-video/SKILL.md): when the script will be animated instead of filmed.
- [demo](../demo/SKILL.md): scripting a product demo starts from the product's code, not an idea backlog.
## Credits

Adapted from cstack by Charles Zheng (MIT), https://github.com/goodnight000/cstack
