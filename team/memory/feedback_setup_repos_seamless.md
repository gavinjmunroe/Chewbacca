---
name: feedback_setup_repos_seamless
description: Any repo we hand people to set up (chip-in-setup, the USC Claude + Brightspace one) must be seamless from a single paste; the Chip In onboarding is the checklist
metadata:
  type: feedback
---

A setup repo we make for other people (team setups like `calebnewtonusc/chip-in-setup`, and the public USC Claude + Brightspace repo) has to get a non-coder from nothing to working with no help. Caleb, 2026-10-27, after walking Angie through chip-in-setup live on a call: "Moving forward any repo we make for ppl should be absolutely seamless for their setup especially the usc one we're cooking".

**Why:** Angie hit five walls in one call, and every one was ours:
1. She was in the claude.ai Chat tab, which can't touch her Mac. It sent her to Settings, Connectors, GitHub, which isn't needed at all.
2. She never accepted the chip-in-setup invite. setup.sh already accepts invites through `gh api`, but the README told her to do it by hand in the browser first.
3. The built-in browser wasn't signed into GitHub, so the invitations link went to GitHub's homepage.
4. The GitHub sign-in opened in a separate window hidden behind Claude.
5. The docs still described the old server.js + Google Sheet site after kyber-landing moved to Next.js, so her Claude flagged the guide as wrong mid-setup.

**How to apply:** before a setup repo goes to anyone:
- The first thing in the README says which app and tab to open (Claude desktop, the `</>` Code tab) and why, and it gives ONE paste prompt that runs the whole thing.
- Nothing needs a browser that the CLI can do: `gh auth login` by device code, then accept invites with `gh api -X PATCH user/repository_invitations/<id>`.
- Warn ahead of time about every popup or separate window ("look for a GitHub sign-in window behind Claude").
- A smoke test fails when the docs describe a layout the target repo no longer has (chip-in-setup a6eb2e7 greps for server.js, data-copy, phone.css).
- The first person through gets their Claude to write a PDF of every snag, and each snag gets fixed in the repo before the next person starts.
- When Caleb is helping someone live, give him one paste prompt for their Claude. See [[reference_sharing_a_claude_setup]].

Moving or archiving a repo a setup repo points at sends every teammate a NEW
invite, and an archived repo goes read only, so they can still preview but
every push fails. On 2026-11-02 the Kyber landing page had moved to
calebnewtonusc/kyber on 10/30 with nobody told; Angie and Luke sat on pending
invites for three days and Caleb asked "it ws on her this whole time?" When a
repo moves, text each teammate the new invites link
(github.com/<owner>/<repo>/invitations) the same day, and check
`gh api repos/<owner>/<repo>/invitations` until it's empty.
