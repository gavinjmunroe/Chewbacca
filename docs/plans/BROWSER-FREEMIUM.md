# The extension as the front door, and the freemium line

Caleb, 2026-10-13: "The entire onboarding ux could be downloaded through that
extension making it easy asf" and "Freemium type shi". The work-ledger task
`later-usc-builder-loop` sets the spirit: free is mind-blowing, paid is for
MORE. This file is the line between the two and what each side costs us per
person. The extension and its boundary are in
[../reference/BROWSER-CHEWB.md](../reference/BROWSER-CHEWB.md).

## Why the browser is the door

About 98% of people don't pay for an AI model (Caleb, 8:43am; team memory
`reference_who_pays_for_ai_2026` has the sources: Menlo's 2% paying is a
2025 global estimate, and in the US about 55% of AI users pay). Free ChatGPT in
a tab is where they already are, and a Chrome extension is the one install a
student has done before. So the first win needs nothing but the extension:
the chat model they already use does the thinking, and the extension carries
text between their tabs. Only after that win does it ask for the Terminal.

## Free forever

Everything below runs on the person's own browser or Mac and their own chat
account. None of it touches a server of ours, which is why it can stay free.

- **In the browser, nothing installed.** Summarize any tab into the chat.
  Pull the next two weeks of what's due from a signed-in Brightspace tab.
  Draft a reply to selected text from the right-click menu.
- **The Mac half.** Every tool in the browser host's table: what's due, today,
  the calendar, people, jobs, the ledger, skills, the shared folder, reminders
  and ledger adds behind the native press, texts behind the press.
- **The whole local kit.** `chewbacca usc lockin`, the coursework ledger, the
  HUD, everything `setup.sh` installs. It was free before the extension and it
  stays free.
- **The boundary itself.** The press, the log and the refusals are never a
  paid feature. Safety that costs money is safety most people don't get.

## What paid adds: MORE, not unlocks

Paid never takes a free feature away or puts it behind a wall. It adds the
things that cost us money to run, because those are the only honest reasons
to charge.

| Paid adds                                            | Why people want it                                                       | What it costs us per person a month                                                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A model included, for people with no AI subscription | Free ChatGPT has message caps; this keeps going after them               | About $5.40 on Claude Haiku 4.5 ($1 in, $5 out per million tokens) at 30 messages a day of 3,000 tokens in and 600 out. The usage is a guess, never measured; the prices are Anthropic's list.    |
| Jobs that run while the laptop is closed             | "Pull what's due every morning and text me" without the Mac awake        | [NEED: a hosted runner's price. It needs a server holding the person's Brightspace session, which is the hosted-VM-holding-SSO pattern CHW-152 ruled out for students. Probably stays a Mac job.] |
| Shared memory for a team or club                     | A study group or a club like TTS sharing one ledger and one people store | Storage is cents; the real cost is sync and support. [NEED: measure on one pilot team.]                                                                                                           |
| More of the hard tools                               | Jev typed decisions, Clay-style lookups, longer runs                     | [NEED: Jev's per-call price before this row gets a number.]                                                                                                                                       |

The fixed cost on the free side is $5 once, Google's Chrome Web Store
developer registration. Per person it's $0: no server sees a free user.

## What compounds per user (the moat)

The free tier is generous because the value builds up locally and nobody else
can copy it: a person's coursework ledger, their people store, their task
ledger and their verdict log grow every week they use it. A competitor can
copy the extension in an afternoon. They can't copy a semester of someone's
due dates and contacts. That is also the honest upgrade path, since a person
with a semester of their own data is the one who wants MORE runs on it.

## Publishing to the Chrome Web Store (Caleb's call, not done)

Nothing here was published, and publishing takes six things:

1. A Chrome Web Store developer account ($5 once, Google sign-in, Caleb's).
2. A privacy policy page, required because the extension reads tabs and uses
   native messaging. It has to say nothing leaves the person's machine except
   what they paste into their own chat.
3. Store assets: a 128 px icon, at least one 1280x800 screenshot, a short and
   a long description.
4. An upload with `key` removed from `manifest.json`. The store assigns its
   own id, so `chewbacca browser install --extension-id <store id>` has to run
   on each Mac, or the store id gets pinned in `bin/lib/browser_host.py`.
5. Review, which takes days, and is stricter for `nativeMessaging` and broad
   host permissions. The shipped manifest asks only for chatgpt.com and
   claude.ai up front and every other site at the moment of use, which is
   the shape reviewers pass.
6. The install line in step 1 of setup points at a PRIVATE repo
   (`gh` says so, 2026-10-13), so a stranger's install fails today. The
   B2B-then-B2C refactor decides when that changes
   (team memory: `project_chewbacca_refactor_waits_on_b2b_b2c`).
