# Competitors

For Caleb, Gavin, Jake and Semyon. Written 2026-10-05, the day Ghost launched Core, after Caleb said: "We gotta MOG ghost, instinct, etc."

This covers each product that sells the same promise Chewbacca OS makes (an assistant that knows your texts, mail, calendar and meetings and acts on them), what it really does, where its data goes, what its own launch film shows, what people have actually complained about, and the bar Chewbacca has to clear to beat it. It ends with ten demo jobs taken from their films, ranked by how much of their pitch Chewbacca would take away by doing each one on a stranger's own laptop.

Read alongside [AFTER-PANES.md](AFTER-PANES.md) (the interface), [OS-COVERAGE.md](OS-COVERAGE.md) (which apps get replaced, in measured order) and [KYBER-SURFACES.md](KYBER-SURFACES.md) (what is built).

## How the sources are marked

Every claim carries its link and one of three marks.

- **[read]**: the page was fetched in full. Web pages went through a fetch tool that summarizes, so a quote is close to verbatim but not guaranteed exact.
- **[film]**: the launch video was downloaded and transcribed on this Mac with mlx-whisper (small.en). Names in a transcript can be misspelled ("Woop" for Whoop).
- **[snippet]**: only a search result snippet was seen. Treat it as a lead, not a fact.

Nothing here was tested hands-on. None of these products was bought or used.

## The short version

| Product      | Price                                          | Where it runs                             | Where your data goes                                                         | Platform                         |
| ------------ | ---------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------- |
| Ghost Core   | $3,499 once                                    | a box in your home with an NVIDIA GPU     | stays on the box, except web search, phone calls, app sync and remote access | screenless box, phone app        |
| Instinct     | free, invite only                              | its own cloud computer                    | Instinct's cloud, perpetual license over your materials                      | text, call, Mac app, web         |
| Meta Muse    | free, $20, $100 a month                        | a cloud VM at Meta                        | Meta's cloud, not shared with ads per Meta                                   | iOS, Android, web, WhatsApp      |
| Automat Ace  | $1,800 to $2,000 a month                       | a dedicated Mac and iPhone run by Automat | Automat's isolated environment, SOC 2                                        | Slack, Teams, email, text, phone |
| OPAL         | $85 bangle                                     | the bracelet plus Opal OS                 | not stated on the site                                                       | wrist, web home screen           |
| Screenpipe   | free to $42 a seat                             | your own computer                         | local by default                                                             | Mac, Windows, Linux              |
| Granola      | free to $35 a user                             | your computer captures, cloud stores      | AWS in the US, kept indefinitely by default                                  | Mac, Windows, iOS, Android       |
| Chewbacca OS | free (MIT LICENSE file; repo is private today) | your own Mac                              | local graph, but reasoning goes to Anthropic and Jev's service               | macOS only                       |

The pattern: every funded competitor except Ghost and Screenpipe puts your life in their cloud. Ghost keeps it home but charges $3,499 for a second computer. Chewbacca is the only one that runs on the computer you already own and reads Messages, Mail and Calendar where they already live. Its weak spot is that its reasoning still leaves the Mac.

---

## Ghost Core

**What it is.** A screenless "personal AI computer" from Ghost, founded by Zain Javaid (19) with Nicholas Chua, Yifei Chen and Gautam Sharda. It pulls in your email, calendar, finances, files, browser and screen history, smart home devices and wearables (Oura, Whoop, Eight Sleep), runs models on the box 24/7, and acts proactively ([ghost.ai](https://ghost.ai) [read]; [TechCrunch, 2026-10-05](https://techcrunch.com/2026/10/05/at-19-ghost-founder-raises-11-million-to-build-a-3499-computer-for-your-personal-ai/) [read]). It has its own browser and file system, and you reach it through a phone app or voice mode in that app (TechCrunch [read]; [FourWeekMBA](https://fourweekmba.com/ai-ghost-core-3499-personal-ai-computer-models-on-device-web-se/) [read]).

**Price and hardware.** $3,499, no subscription, 30-day returns. NVIDIA RTX PRO 4000 Blackwell SFF (24 GB), AMD Ryzen 5 7600, 64 GB DDR5, 1 TB NVMe. Models listed: Qwen 3.8-Next, Qwen 3.8-27B, Gemma 4-31B, Muse-Glimmer-30B, plus anything from Hugging Face ([ghost.ai](https://ghost.ai) [read]). The launch post claims 87 tok/s on Qwen-3.8-27B and 32 tok/s on Qwen-3.8-Next ([Zain's post, via search](https://x.com/zainmfj/status/2107146556176798081) [snippet]). Shipping is the last week of October (TechCrunch [read]). $11M seed led by a16z, with Abstract, Audacious, SV Angel and Nova (TechCrunch [read]). The launch post had 1.63M views and 7,328 likes by the evening of launch day ([api.fxtwitter.com/zainmfj/status/2107146556176798081](https://api.fxtwitter.com/zainmfj/status/2107146556176798081) [read]).

**Where data goes.** The headline is "No data ever leaves your home" ([ghost.ai](https://ghost.ai) [read]). Ghost's own privacy policy is narrower. Phone calls and web search travel "from Core to Ghost's managed-service gateway, then to the third-party provider." Remote access goes through "Ghost's remote-access relay." Connected-app sync talks to those services, and screen history is captured on your other computer and sent to the Core. The gateway says it keeps no logs, and the company collects no telemetry ([ghost.ai/privacy](https://ghost.ai/privacy) [read]). The support page says Core needs internet for web search, email and updates (FourWeekMBA [read]). There is also a built-in firewall that watches outgoing requests and flags agent actions for review (TechCrunch [read]).

**The launch film** (2:24, one founder, one set) [film], from [the launch post](https://x.com/zainmfj/status/2107146556176798081):

1. Core sees Whoop resting heart rate is up, sees he was up late preparing the keynote, notes flu season, and suggests magnesium and vitamin C.
2. A camera shows it his ingredients and it walks him through an immunity shot while the supplements ship.
3. "Is there anything I'm missing for this week?" "You have a demo on Monday, but you're still missing the GPU." "Can you find anyone that comes by Friday?" Three options, one ready Wednesday. "Want me to order it?" "Yeah, go for it."

Its thesis line is "The most capable personal AI will be the one with the most access to your life."

**Real limitations.** The 24 GB GPU caps it at mid-sized open models, which trail cloud models (TechCrunch and others, [summarized in search](https://aiweekly.co/alerts/ghost-raises-11m-to-sell-3499-core-pc-running-local-ai-agents) [snippet]). "Fully local" has the gateway and relay exceptions above. Dedicated AI hardware has a bad recent record: the Humane AI Pin went to HP for $116M ([TechCrunch](https://techcrunch.com/2025/02/18/humanes-ai-pin-is-dead-as-hp-buys-startups-assets-for-116m), read in the AFTER-PANES research, not re-read today). Javaid's answer to "why not a Mac mini" is that running models on existing hardware is "a terrible experience" (TechCrunch [read]). No review exists yet because nothing has shipped.

### The bar for Chewbacca

- Do Ghost's demo 3 on a laptop someone already owns: answer "what am I missing this week" from their own calendar, mail and tasks, name the missing thing, and find options. Chewbacca has the calendar and task walks; it lacks the cross-source "missing prerequisite" answer (see job 2 below).
- Match the privacy line honestly. Today Chewbacca's graph is local (0600, 7-day 80-character snippets, `kyber-surfaces forget`), but the voice answers and meeting summaries go through `claude -p` to Anthropic, and Jev calls TypeSafe's service ([KYBER-SURFACES.md](KYBER-SURFACES.md), [JEV.md](JEV.md)). A stranger can't say "nothing leaves my Mac" about Chewbacca yet. The route to parity is a local model path for the classifier and summary steps on Apple Silicon. The Ollama engine panels exist but only list models; nothing reasons through them.
- Ghost reads wearables and smart home. Chewbacca reads neither. Apple Health export is the local-first way in.
- Price is the opening: $0 on the Mac you own against $3,499. That only lands if the first ten minutes work for a stranger, which today they don't (see gap 1 in the closing list).

---

## Instinct

**What it is.** A personal agent from Instinct (Spear Street Technology, San Francisco), founded by Noah Shinn, 23, formerly a researcher at Sierra. You text or call it; there is "no new interface." It is "trained to use a phone and a computer in the same way that humans do" ([Noah's intro post, 2026-08-26](https://api.fxtwitter.com/noahrshinn/status/2092691344456351744) [read], 2.09M views). The site says it connects to "email, messaging, screen, audio, location, and more" and lists "following up on threads you've dropped, proactively calling or texting you, arranging a ride to the airport, booking a handyman" ([instinct.co](https://instinct.co) [read]). It runs "a persistent machine of its own, with browser access and cached credentials" ([Vellum breakdown](https://www.vellum.ai/blog/official-instinct-breakdown) [read]). There is also a Mac app and a web workspace at app.instinct.com ([eesel review](https://www.eesel.ai/blog/instinct-ai-review) [read]).

**Price and scale.** Free, invite only, five invites each, invites resold on eBay ([Fortune, 2026-09-30](https://fortune.com/2026/09/30/noah-shinn-instinct-ai-assistant-meta-muse-alexandr-wang-tech-series-c-ai-agent-mark-zuckerberg/) [read]). Close to $1B in annual transaction volume, about half of it travel, $0 spent on marketing (Fortune [read]). Raised $1B at a $10B valuation in September from Sequoia, Benchmark and Coatue ([TechCrunch, 2026-09-28](https://techcrunch.com/2026/09/28/viral-ai-agent-instinct-raises-1b-series-c-at-a-10b-valuation/) [read]). It added its own email addresses and, on 2026-09-16, Concierge, which places phone calls to businesses ([TechCrunch, 2026-09-17](https://techcrunch.com/2026/09/17/rival-ai-agents-instinct-and-metas-muse-both-add-the-ability-to-make-calls/) [read]). Growth of "roughly 10% a day" is Patrick O'Shaughnessy's figure ([his post](https://x.com/patrick_oshag/status/2104542892073095398) [snippet]).

**Where data goes.** Instinct's cloud. The Terms grant "a perpetual, irrevocable, transferable, and sub-licensable license" over user materials, including for model training; the opt-out is forward-only and excludes only Google Workspace data. The privacy policy lists keystrokes, cursor positions, email, messages, audio and precise location ([Vellum](https://www.vellum.ai/blog/official-instinct-breakdown) [read]; [summary of the policy](https://mlq.ai/news/instinct-is-still-invite-only-as-its-ai-assistant-takes-broad-access-to-users-data/) [snippet]). Disconnecting doesn't delete indexed data; you request deletion separately (eesel [read]).

**Launch film.** None found. The intro post is text only. Its demo jobs come from the site and the post: road trips, groceries, concert tickets, cancelling subscriptions, a wedding, an airport ride, a handyman.

**Real complaints.** Everything happens in one chat thread, so status across several tasks is hard to track and people keep ChatGPT for real work ([daily.dev](https://daily.dev/posts/instinct-s-onboarding-wows-but-nobody-wants-to-do-real-work-in-it-6rijpuy6a) [read]; eesel [read]). Browser brittleness on CAPTCHAs and 2FA (Vellum [read]). Reported in the first week of coverage: inbox data kept after disconnect, a successful prompt-injection test, an unapproved email (Vellum [read]; eesel could not find the email incident documented, so treat it as reported, not proven). On 2026-09-23 a user saw "someone else's financial document"; Shinn said the model fabricated a proper noun and shipped a detection layer in 48 hours (eesel [read]). A user said it "tried to change my seat while checking me in once" (eesel [read]).

### The bar for Chewbacca

- Instinct's daily value is "following up on threads you've dropped." Chewbacca's needs-you walk does exactly this from chat.db and Mail, with no model in the draw, but `AWAITS_REPLY_FROM` is right on 8 of 12 held-out threads ([KYBER-SURFACES.md](KYBER-SURFACES.md)). It has to clear about 90% before a stranger trusts it over a text from Instinct.
- Beat the single thread. Chewbacca's graph keeps each person, task and session as its own node with its own state, which is the thing Instinct's users say they miss. Show that in the film.
- Beat the trust story with facts Instinct can't say: no license over your data, nothing stored but 7 days of 80-character snippets, a reply sent only on your press to a handle re-read from chat.db and read back after. Every one of those is already built.
- Instinct does things in the world (calls, bookings, purchases). Chewbacca deliberately stops before send, buy and book (`jev-browse` refuses those clicks). That's a defensible line, but the film has to make the press feel like one tap, not like a missing feature.

---

## Meta Muse

**What it is.** Meta's personal agent, launched in the US on 2026-09-08. It "doesn't just answer questions, it actually does the work": emails, travel, bills, forms, plans, recipe reels into grocery lists, party invites, purchases. It keeps working after you close the app and returns when something changes or needs approval ([Meta newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/) [read]). It runs on "Muse Secure VM," "its own dedicated computer in the cloud," with a separate Sentinel agent on the same machine: "Nothing Muse does reaches the internet unless the Sentinel approves it." A Confidential VM with user-held keys is promised later (Meta newsroom [read]). Payments go through Stripe Link (Meta newsroom [read]).

**Price and platform.** Free with a usage meter, then $20 and $100 a month; iOS, Android, muse.ai and WhatsApp, glasses later ([TechCrunch, 2026-09-08](https://techcrunch.com/2026/09/08/meta-debuts-its-muse-ai-agent-will-consumers-trust-it/) [read]). 730,000+ US downloads in the first days ([TechCrunch, 2026-09-17](https://techcrunch.com/2026/09/17/rival-ai-agents-instinct-and-metas-muse-both-add-the-ability-to-make-calls/) [read]) and 2.8M worldwide installs in 12 days, briefly the top free app (Fortune [read]).

**Where data goes.** Meta's cloud. Meta says conversations and VM data don't reach its ad systems, credentials sit in separate storage, you can opt out of training and tell it to forget, and it shows "a complete audit trail of everything it has done and plans to do" (Meta newsroom [read]).

**The launch film** (2:02) [film], from [Meta's Facebook video](https://www.facebook.com/Meta/videos/3420967771398373/):

1. It sees a half-marathon registration email and, unprompted, offers a training plan, then asks follow-ups (time of day, route) and draws a mileage chart.
2. With read-only bank statements, it builds a savings dashboard with spending by category and finds forgotten subscriptions.
3. "Every morning, Muse can review your inbox, surface unanswered emails, and draft responses for you to review. It even catches scheduling conflicts before you get double-booked."
4. It watches Facebook Marketplace for a standing desk under $200 within 10 miles, pings only when a good one appears, and buys it through a secure link.

The rule it states: "Muse will always check with you before it spends, sends, or shares anything."

**Real complaints.** Trust in Meta: the 2011 FTC settlement, the $5B 2019 penalty, plaintext passwords found in 2019, Cambridge Analytica. TechCrunch says the no-ads claim "will require deeper investigation by security experts" (TechCrunch, 2026-09-08 [read]). CNBC framed the launch around Meta's "public reckoning over privacy and safety" ([CNBC](https://www.cnbc.com/2026/09/08/meta-personal-ai-agents-public-reckoning-privacy-safety.html) [snippet], the page returned 403).

### The bar for Chewbacca

- Muse's demo 3 is the core of Chewbacca's needs-you card. Chewbacca already surfaces unanswered threads and drafts mail with `mac mail draft`; it needs to draft the reply text too (today the composer is empty until he types) and catch calendar conflicts, which nothing in the graph computes yet.
- Demo 1 is proactive detection from an incoming email. Chewbacca ingests mail but has no rule or model that turns "registration confirmed" into an offer. The Docket in [AFTER-PANES.md](AFTER-PANES.md) is where that card would land.
- Muse's dashboards are generated. `kyber-genui` already draws panels (19 of 20 after repair) but binds only four registered walks. A bank-statement CSV ingester plus a budget walk would match demo 2 with nothing leaving the Mac.
- Match the audit trail. Chewbacca logs every surface action to `~/.bob/surfaces-activity.jsonl`, but there is no view of it on the glass and no undo yet (the undo ledger is a Day 3 item in AFTER-PANES).

---

## Automat Ace

**What it is.** "An AI agent with its own computer, email address, and phone number" that you onboard like a hire: invite it to Slack, add it to email threads, share files with access levels ([Ace launch film](https://x.com/lucas0choa/status/2105342164658204705) [film]). Automat (YC W23) is Lucas Ochoa (CEO, ex-Google robotics and Microsoft) and Gautam Bose; its other product, Automat Core, is managed automation for mortgage, banking, insurance and healthcare ([YC](https://www.ycombinator.com/companies/automat) [read]).

**The post that framed Instinct and Muse.** On 2026-09-30 Ochoa wrote: "'It's instinct but actually for work.' For Instinct & Muse, work and compliance was an afterthought; that's why we built Ace" (51,444 views) ([fxtwitter](https://api.fxtwitter.com/lucas0choa/status/2105342164658204705) [read]). The next day: "deploying agents with personas into organizations takes a different architecture than a b2c personal assistant" ([fxtwitter](https://api.fxtwitter.com/lucas0choa/status/2105525984913211871) [read]).

**Price and platform.** Automat Workforce is $1,800 a month on an annual contract or $2,000 month to month, with a 14-day trial. Each Ace gets a "Dedicated Mac, iPhone, and email account." It works through Slack, Teams, email, text, WhatsApp and phone, and handles "Windows apps, Citrix, web portals, and internal tools" ([runautomat.com](https://runautomat.com) [read]). The site doesn't say whether the Mac and iPhone are physical machines or virtual.

**Where data goes.** Automat's infrastructure: "an isolated environment scoped to your organization, with SOC 2 controls, encrypted credentials, role-based access, and a full audit trail." "Every run is logged with the steps Ace took and the screens it saw" ([runautomat.com/workforce](https://runautomat.com/workforce) [read]). Certifications claimed: SOC 2 Type II, GDPR, HIPAA, ISO 27001, with SSO and SCIM ([runautomat.com](https://runautomat.com) [read]).

**The launch film** (1:42) [film]:

1. Share a document with Ace; it jumps in, suggests changes, you approve.
2. It books appointments "through a Calendly link, a website, or an email thread, handling all the back and forth."
3. Customer quotes ("snappy," "context aware") and a "talent development team" of humans who tune your agent.

The homepage adds a sales one-pager from CRM data, Slack analysis that updates opportunities, scheduling over text, flagging an invoice dispute, editing an offer letter, and negotiating with a venue by phone ([runautomat.com](https://runautomat.com) [read]).

**Real limitations.** No independent review found. The price is a hire's, not a tool's. Part of the product is people (a named 24/7 team, playbook writing), which is a services margin. Named customers are T3 Sixty, Parsnipp, Paraform and Near Space Labs (runautomat.com/workforce [read]).

**The bar for Chewbacca.** Ace isn't Chewbacca's consumer competitor; it's the enterprise bar Caleb set when he said the corporate world should run on this (Caleb's private brain note `project_chewbacca_os`). Against it Chewbacca has none of SSO, SCIM, an admin console, fleet install, SOC 2, or Windows. The local sockets for the session inbox and Carlton's session engine have no auth. What Chewbacca can win on is that the agent works as you, on your own machine, in your own sessions, so there is no second identity to provision, no $2,000 seat, and no customer data copied to a vendor. To make that a real enterprise pitch: an audit log viewable on the glass, socket auth on every local engine, and a signed, notarized installer IT can push with MDM.

---

## OPAL and Opal OS

Langston's company, where Caleb leads Tizzy (paused until OPAL prioritizes the bone-conduction necklace, per Caleb's private brain note `opal.md`). Read this section as a fair account of a partner, not as a target.

**What it is.** "Jewelry that listens": the Opal Bangle, a 17 mm open C-cuff in silver or gold with a microphone port and wireless charging. "It hears the day as you live it. The names, the promises, the thing you swore you'd do by Thursday. Then it acts." Named actions: calendar events for meetings, follow-up messages, birthday reminders. $85; batch 1 sold out, batch 2 on preorder ([opal.fashion](https://opal.fashion) [read]). Caleb's own 2026-09-01 note describes "a luxury titanium bracelet with private, on-device AI" and 200+ paid preorders in six days (Caleb's private brain note `opal.md`); the live site now says silver or gold and states nothing about on-device processing, so the materials and the on-device claim should be confirmed with Langston before anyone repeats them.

**Opal OS.** A search result describes "Opal OS: the account home screen for the Opal bracelet" at github.com/LangstonReid/opalv2 [snippet]; the repo returned 404 today, so it's private or gone. What Chewbacca knows about the desktop comes from the screenshot Caleb shared on 2026-10-01, torn down in [the kyber-surfaces skill](../.claude/skills/kyber-surfaces/SKILL.md) under "The bar to clear": every panel says what it's for in one line, header counts say what to do ("14 need you · 3 done today"), task rows carry provenance ("Calendar · from Late call · ≈5 min saved"), state tabs with counts (Ready, Cooking, Stuck, Done), and one design system across waveform, transcript, video and photo. Where it loses: ten panels at once, the same transcript twice, one green Go pill for different actions, "Opal's guess" shown once.

**Where data goes.** Not stated on the site [read].

**The bar for Chewbacca.** Opal's pitch is "it heard the promise, then it acted." Chewbacca's native meeting capture already turns a call into action items as Tasks, but the next step (the calendar event, the follow-up message) isn't drawn from them. Match Opal's row honesty (provenance on every row, Stuck as a first-class state, which Chewbacca has) without the "time saved" number, which nothing measures. Opal hears in-person conversations from a wrist; Chewbacca hears only what the Mac's mic and output hear, which is calls, not the hallway.

---

## Screenpipe

**What it is.** Records screen (OCR), audio and accessibility context into a local database with a REST API and MCP server, so any agent can search your computer history. Model-agnostic, local or cloud. macOS, Windows and Linux ([screenpipe.com](https://screenpipe.com/) [read]). YC S26, 21,823 GitHub stars, license reported by GitHub as NOASSERTION, so it's source-available rather than plainly open source ([GitHub API, screenpipe/screenpipe](https://github.com/screenpipe/screenpipe) [read]).

**Price.** Free download; Basic $21 a month; Business $42 a seat; Enterprise custom ([screenpipe.com/pricing](https://screenpipe.com/pricing) [read]).

**The bar for Chewbacca.** Screenpipe is the closest technical cousin and runs on Windows. Its record of everything is the opposite of Chewbacca's 7-day 80-character snippet rule. Chewbacca wins on typed facts (who is waiting, what is due) over raw pixels, and has to show that in a film. It should read Screenpipe as a source when one is installed, the same way it reads Anarlog, rather than rebuild screen capture.

---

## Granola

**What it is.** Bot-free meeting notes from device audio. Free (30-day history), Business $14 a user, Enterprise $35 with SSO, SCIM, HIPAA and SOC 2 Type II ([granola.ai/pricing](https://www.granola.ai/pricing) [read]).

**Where data goes.** Audio is deleted after transcription; transcripts and notes sit in AWS in the US and are kept indefinitely by default ([summary of Granola's policy](https://anarlog.so/blog/is-granola-ai-safe/) [snippet]).

**Real complaints.** A proposed class action filed 2026-07-30 in the Northern District of California says Granola records other participants without consent, against California's all-party rule, and trains on meetings by default on Free and Business ([PPC Land](https://ppc.land/granola-sued-for-recording-meetings-without-consent-to-train-ai-models/), [Computerworld](https://www.computerworld.com/article/4206255/granola-lawsuit-raises-concerns-over-ai-note-taking-app-privacy.html) [snippet]).

**The bar for Chewbacca.** `room-capture` does Granola's capture with audio deleted per chunk and transcripts kept on the Mac. The summary step sends the transcript to Anthropic unless `CHEWBACCA_MEETING_SUMMARY=0`. The Granola suit is a warning for Chewbacca too: native capture records the other side of a call, so a consent prompt (a line said or posted at start) has to ship before strangers use it in all-party states.

---

## The rest of 2026

- **Google Disco and GenTabs.** A Google Labs browser, macOS waitlist, that turns your open tabs and Gemini chat history into small web apps (study visualizers, meal plans, trip plans), each linking back to sources ([TechCrunch, 2025-12-11](https://techcrunch.com/2025/12/11/google-debuts-disco-a-gemini-powered-tool-for-making-web-apps-from-browser-tabs) [read]). Generated UI like this takes 30 to 90 seconds or more to appear ([Android Authority](https://www.androidauthority.com/gemini-dynamic-view-3619662/), read in the AFTER-PANES research). Chewbacca's fixed walks draw with no model, which is the speed edge; `kyber-genui` is its GenTabs.
- **OpenAI Dots.** Always-on agents announced at DevDay on 2026-09-29, for Pro, Business Premium and Enterprise ([Business Standard](https://www.business-standard.com/amp/technology/tech-news/openai-devday-2026-dots-gpt-6-1-sol-codex-developer-tools-126093000396_1.html) [snippet]). Not researched further.
- **Rewind and Limitless.** Meta bought Limitless on 2025-12-05, stopped Pendant sales, and disabled Rewind's screen and audio capture on 2025-12-19; service ended in the EU, UK and several other countries ([WinBuzzer](https://winbuzzer.com/2025/12/05/meta-acquires-ai-wearables-startup-limitless-kills-pendant-sales-and-sunsets-rewind-app-xcxwbn/), [Rewind's page](https://rewind.ai/what-happened-to-rewind/) [snippet]). The lesson for buyers: a cloud memory product can be switched off by an acquisition. Chewbacca's data is files on your own disk.
- **Humane AI Pin and Rabbit R1.** Both removed the screen and every task got slower than the phone; Humane sold to HP for $116M (Brownlee's reviews and TechCrunch, read in the AFTER-PANES research).
- **Plaud NotePin and Friend.** Plaud is a $159 to $179 recorder pendant with $0, $99.99 and $239.99 a year plans; Friend is a $99 necklace ([tl;dv](https://tldv.io/blog/plaud-notepin-review/), [Plaud pricing guide](https://ticnote.com/en/blog/plaud-price-guide) [snippet]). Recorders, not agents.
- **Other text agents.** TechCrunch names Wajo, Town and Ollie as popular text-based assistants alongside Instinct (TechCrunch, 2026-09-17 [read]). Not researched.

---

## What Chewbacca has today, in one place

Everything below is from [KYBER-SURFACES.md](KYBER-SURFACES.md) and [OS-COVERAGE.md](OS-COVERAGE.md) unless marked.

- **Reads, local:** iMessage (chat.db), Mail.app unread mail, macOS Calendar (needs the grant), Reminders, Apple Notes, coursework ledger, people store, Claude and Codex sessions, git repos, GitHub via `gh`, native meeting capture.
- **Not wired:** Slack, WhatsApp (needs a QR), Gmail and Google Calendar for anyone but Caleb (his OAuth client is in Testing mode with him added by hand), wearables, Apple Health, smart home, bank data, browser history as a graph source.
- **Acts:** 1:1 iMessage reply on a press, read back; mail drafts only; Notes append; Claude session send, allow once, deny, interrupt, fork; meeting action item to Task; plan-mode `claude -p` runs on tasks; web tasks in your own Chrome through `jev-browse`, stopping before any send, submit, pay, buy or book.
- **Leaves the Mac:** voice answers and summaries through `claude -p` to Anthropic; meeting summaries the same way (switchable); Jev classifications to TypeSafe.
- **Platform:** macOS only. No Windows build, no phone app, no remote access.
- **Measured:** "waiting on you" right on 8 of 12 held-out threads; generated panels 14 of 20 first try, 19 of 20 after repair.

---

## Ten jobs a stranger must do faster with Chewbacca

Each job is taken from a competitor's own film or launch page. "Faster" means fewer presses and less wait than the competitor's flow, on the stranger's own Mac, timed from a recording with nothing set up by us. None of these has been timed yet. Ranked by how much of the competitors' combined pitch the job takes away if Chewbacca does it well.

**1. "Who's waiting on me, and draft the replies."** From Muse's film ("surface unanswered emails, and draft responses for you to review"), Instinct's site ("following up on threads you've dropped") and Opal's follow-up messages. This is the daily habit all three sell. Chewbacca has: the needs-you walk across iMessage and Mail with no model in the draw, the person timeline, the press-to-send reply read back from chat.db, mail drafts. Missing: precision (8 of 12, needs about 90%), a drafted reply body in the composer, Gmail for a stranger without a hand-made OAuth client, Slack and WhatsApp.

**2. "Is there anything I'm missing for this week?"** Ghost's demo 3, and Muse's "catches scheduling conflicts before you get double-booked." Chewbacca has: the today and tasks walks, coursework due dates with sources, calendar events, people-store promises. Missing: an answer that joins an upcoming event to what it needs (a demo on Monday needs a GPU that no order covers), calendar conflict detection, and a way to ask the question in words that lands on the glass instead of the voice model.

**3. "It heard the promise, then it acted."** Opal's site, Ghost's screen history, Ace's meeting handling. Chewbacca has: native capture with audio deleted per chunk, meetings named from the calendar, action items as guessed Tasks (confidence 0.5), `ks-add` to promote one. Missing: turning an action item into a calendar event or a drafted follow-up on the right network in one press; a consent line at capture start; a local summary model so the transcript never leaves.

**4. "It saw the email and offered before I asked."** Muse's demo 1 (half-marathon registration to training plan) and Instinct's "proactively calling or texting you." Chewbacca has: mail ingested into the graph, the Docket design for one card at a time ([AFTER-PANES.md](AFTER-PANES.md)). Missing: anything that reads an incoming message as an occasion and proposes a task. The Docket itself is not built.

**5. "Book a time with them."** Ace's film ("through a Calendly link, a website, or an email thread, handling all the back and forth") and Instinct's handyman booking. Chewbacca has: `jev-browse` in your own Chrome, mail drafts, calendar reads. Missing: a scheduling loop that reads the other side's proposed times, checks the calendar, drafts the answer and leaves the final press to you. The stop before "book" is a deliberate line and should stay.

**6. "Find it and get it to me by Friday."** Ghost's GPU order and Muse's Marketplace standing desk under $200 with an alert. Chewbacca has: `jev-browse` for search and filters in a real browser. Missing: a standing watch that re-checks a search and posts one token when something new matches; the buy step stays your press.

**7. "Look over this doc and suggest changes."** Ace's film demo 1. Chewbacca has: the Drive connector inside agent sessions, File and Diff components on the glass, Claude sessions it can start in a folder. Missing: a surface that takes a shared doc, shows suggested edits as a Diff, and writes them back on approval.

**8. "Where's my money going, and what can I cancel?"** Muse's demo 2 and Instinct's "cancelled hundreds of dollars of subscriptions." Chewbacca has: `kyber-genui` for a dashboard panel. Missing: any finance source. A local CSV or OFX statement ingester keeps this entirely on the Mac, which beats "read-only access to my bank statements" in Meta's cloud.

**9. "You might be getting sick."** Ghost's demo 1 (Whoop resting heart rate plus late-night work plus flu season). Chewbacca has: knowledgeC.db app-usage data, which already shows late-night work. Missing: Apple Health, Whoop and Oura data. An Apple Health export ingester is the local path; health advice should stay a fact shown with its source, never a diagnosis.

**10. "Call them for me."** Instinct Concierge, Muse business calls, Ace's venue negotiation. Chewbacca has: nothing that places a call. This is last because it needs a cloud telephony provider (Ghost uses its gateway for the same reason) and takes the least from the others' daily pitch. If built, the call script is shown and approved before dialing, and the transcript lands in the meetings surface.

## The top five gaps

1. **A stranger's first ten minutes fail.** Gmail and Google Calendar need Caleb's own OAuth client in Testing mode, WhatsApp needs a QR, and Kyber needs Calendar and Accessibility grants walked by hand. Job 1 can't be filmed on a stranger's laptop until this works. Owner per the OS note: Gavin (CHW-2, CHW-11).
2. **"Waiting on you" is right 8 times in 12.** Job 1 is the core of the Muse, Instinct and Opal pitches, and a wrong head card costs more than a wrong row. Clear about 90% on held-out threads, then wire Slack and WhatsApp so a hole doesn't read as "nothing pending."
3. **No cross-source "what am I missing" answer.** Ghost's best moment and Muse's conflict catch both need a walk that joins events to their prerequisites and to each other. Nothing in `osgraph_walks.py` does that yet.
4. **Meetings stop at the Task.** Opal's whole pitch is the action after the conversation. Chewbacca captures and extracts, but doesn't turn an item into an event or a drafted follow-up in one press, and has no consent line at capture start.
5. **The privacy line isn't ours yet.** Ghost can say nothing leaves the home. Chewbacca's graph is local, but answers, summaries and Jev calls go to Anthropic and TypeSafe. A local model route for classification and summaries on Apple Silicon is what lets the film say "on the Mac you already own, and nothing leaves it," which is the one sentence no competitor here can say.

## Sources

### Read

- Ghost: [ghost.ai](https://ghost.ai), [ghost.ai/privacy](https://ghost.ai/privacy), [TechCrunch](https://techcrunch.com/2026/10/05/at-19-ghost-founder-raises-11-million-to-build-a-3499-computer-for-your-personal-ai/), [FourWeekMBA](https://fourweekmba.com/ai-ghost-core-3499-personal-ai-computer-models-on-device-web-se/), [launch post via fxtwitter](https://api.fxtwitter.com/zainmfj/status/2107146556176798081), launch film (transcribed)
- Instinct: [instinct.co](https://instinct.co), [instinct.com](https://instinct.com), [Noah Shinn's intro via fxtwitter](https://api.fxtwitter.com/noahrshinn/status/2092691344456351744), [TechCrunch 09-28](https://techcrunch.com/2026/09/28/viral-ai-agent-instinct-raises-1b-series-c-at-a-10b-valuation/), [TechCrunch 09-17](https://techcrunch.com/2026/09/17/rival-ai-agents-instinct-and-metas-muse-both-add-the-ability-to-make-calls/), [Fortune](https://fortune.com/2026/09/30/noah-shinn-instinct-ai-assistant-meta-muse-alexandr-wang-tech-series-c-ai-agent-mark-zuckerberg/), [Vellum](https://www.vellum.ai/blog/official-instinct-breakdown), [eesel](https://www.eesel.ai/blog/instinct-ai-review), [daily.dev](https://daily.dev/posts/instinct-s-onboarding-wows-but-nobody-wants-to-do-real-work-in-it-6rijpuy6a)
- Muse: [Meta newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/), [TechCrunch 09-08](https://techcrunch.com/2026/09/08/meta-debuts-its-muse-ai-agent-will-consumers-trust-it/), [launch film](https://www.facebook.com/Meta/videos/3420967771398373/) (transcribed)
- Automat: [runautomat.com](https://runautomat.com), [runautomat.com/workforce](https://runautomat.com/workforce), [YC profile](https://www.ycombinator.com/companies/automat), Lucas Ochoa's posts via fxtwitter ([09-30](https://api.fxtwitter.com/lucas0choa/status/2105342164658204705), [10-01](https://api.fxtwitter.com/lucas0choa/status/2105525984913211871)), launch film (transcribed)
- OPAL: [opal.fashion](https://opal.fashion); Caleb's private brain note `opal.md`; the Opal desktop teardown in [kyber-surfaces SKILL.md](../.claude/skills/kyber-surfaces/SKILL.md)
- Others: [screenpipe.com](https://screenpipe.com/), [screenpipe pricing](https://screenpipe.com/pricing), screenpipe/screenpipe through the GitHub API, [Granola pricing](https://www.granola.ai/pricing), [TechCrunch on Disco](https://techcrunch.com/2025/12/11/google-debuts-disco-a-gemini-powered-tool-for-making-web-apps-from-browser-tabs)
- In this repo: [KYBER-SURFACES.md](KYBER-SURFACES.md), [OS-COVERAGE.md](OS-COVERAGE.md), [AFTER-PANES.md](AFTER-PANES.md), [JEV.md](JEV.md), [JEV-BROWSE.md](JEV-BROWSE.md), [RUNTIMES.md](RUNTIMES.md), and Caleb's private brain note `project_chewbacca_os`

### Snippet only, or blocked

- [Axios on the assistant race](https://www.axios.com/2026/09/20/ai-assistant-openai-meta-muse-instinct-grok-apple) and [CNBC on Muse](https://www.cnbc.com/2026/09/08/meta-personal-ai-agents-public-reckoning-privacy-safety.html) (both 403)
- [mlq.ai on Instinct's data access](https://mlq.ai/news/instinct-is-still-invite-only-as-its-ai-assistant-takes-broad-access-to-users-data/), [Patrick O'Shaughnessy's post](https://x.com/patrick_oshag/status/2104542892073095398), [Zain's post text through search](https://x.com/zainmfj/status/2107146556176798081) for the tok/s figures
- [aiweekly on Ghost criticism](https://aiweekly.co/alerts/ghost-raises-11m-to-sell-3499-core-pc-running-local-ai-agents)
- Granola suit: [PPC Land](https://ppc.land/granola-sued-for-recording-meetings-without-consent-to-train-ai-models/), [Computerworld](https://www.computerworld.com/article/4206255/granola-lawsuit-raises-concerns-over-ai-note-taking-app-privacy.html), [Anarlog's summary](https://anarlog.so/blog/is-granola-ai-safe/)
- Limitless and Rewind: [WinBuzzer](https://winbuzzer.com/2025/12/05/meta-acquires-ai-wearables-startup-limitless-kills-pendant-sales-and-sunsets-rewind-app-xcxwbn/), [Rewind](https://rewind.ai/what-happened-to-rewind/)
- Plaud and Friend: [tl;dv](https://tldv.io/blog/plaud-notepin-review/), [ticnote](https://ticnote.com/en/blog/plaud-price-guide)
- OpenAI Dots: [Business Standard](https://www.business-standard.com/amp/technology/tech-news/openai-devday-2026-dots-gpt-6-1-sol-codex-developer-tools-126093000396_1.html)
- Opal OS repo, [github.com/LangstonReid/opalv2](https://github.com/LangstonReid/opalv2) (search snippet; 404 when opened)
- Humane, Rabbit and generated-UI latency: read in the AFTER-PANES research on 2026-10-05, not re-read for this doc

### Not found

- An Instinct launch film. The intro post is text only.
- Any hands-on review of Ghost Core, which has not shipped.
- An independent review of Automat Ace.

Built with Chewbacca
