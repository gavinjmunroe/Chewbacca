# Reading video insights

How to turn a platform's analytics screens into numbers you can compare across videos. Written against Instagram Reel insights (2026); check labels and definitions in the app's ⓘ panels, because they change.

## What to capture

Instagram's Reel insights has three regions. Capture all of them:

- **Summary:** views, viewers, average watch time, follows, and the like, comment, repost, share and save counts. Viewers are unique accounts. Views include repeat plays.
- **What impacts your views:** skip, share, like, save, repost and comment rates, each labelled Higher, Lower or Typical. Instagram lists them "in order of importance to reach". The label compares against a group the app doesn't show. Recent videos can all read Higher on skip rate, so compare your own videos' numbers with each other rather than trusting the label.
- **How long people watched your reel:** the retention curve, from 0 to the duration label. **Top sources of views:** Reels tab, Feed, Explore, Profile, Stories, Search.

Record the snapshot's date and time. Views keep growing, so every number needs its age.

## Derived numbers worth keeping

- Average watch as a share of runtime. Shorter videos score higher here by construction, so also keep the seconds.
- Interactions per 1,000 viewers (shares, saves, follows). Counts alone favour the videos that already reached more people.
- Non-follower surfaces: Reels tab plus Explore. Feed and Profile mostly reach existing followers. A video that stays mostly in Feed didn't get picked up for non-followers.

## The retention curve

- Read it at 1, 3, 5, 7, 10, 15, 20, 30, 45 and 60 s, and at the end. `scripts/retention_curve.py SHOT --duration SECONDS` does this by pixel and prints the average watch time implied by the curve's area. If that average differs from the app's by more than a few seconds, the reading is off. Crop to the chart, or read it by eye and say so.
- Skip rate and the curve's 3-second value measure different things. The curve at 3 s has been found up to 10 points above 100 minus skip rate. Compare curve with curve and skip with skip.
- A smooth curve can't point to an exact frame. Name the passage (what was said and shown in the few seconds before a drop), not the frame.
- Useful shapes:
  - **Cliff:** a steep drop.
  - **Plateau:** a flat stretch. A committed audience is watching.
  - **Bleed:** a steady slope. Each new beat loses more people.

  The 3→10 s drop measures the second sentence.

## Testing

To compare openings or treatments, use the platform's test format when it has one. Instagram's Trial Reels go to non-followers first.

- Keep automatic sharing to followers off during the comparison.
- Use the same caption and posting window.
- Change one thing where practical.
- Record at fixed ages, such as 24 and 72 hours.

Trial formats aren't randomized A/B tests. Audiences, timing and distribution differ between posts. Treat one win as a lead, and repeat the pattern on another video before calling it a rule.
