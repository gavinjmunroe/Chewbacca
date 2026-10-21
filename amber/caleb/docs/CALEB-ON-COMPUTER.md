# Caleb on Perplexity Computer

A runbook for doing Amber work the same way Sagar does: inside Perplexity
Computer, with scheduled agents running 24/7, with a sandbox that looks
identical to his.

This doc is written for Caleb. It assumes you already have Perplexity
Computer access and have logged in at least once.

---

## The one-minute model

Perplexity Computer gives you a sandboxed Linux VM with a persistent
workspace at `/home/user/workspace/`. In that sandbox you have a `gh`
CLI that is authenticated to GitHub automatically when you pass
`api_credentials=["github"]` in bash calls.

Above the sandbox you have:

- **Memory** - durable facts about you. Ask "what do you remember about
  me?" to see what is stored.
- **Skills** - reusable playbooks. The one you care about most is
  [`amber-togari-sync`](https://github.com/amber-organization/amber-agent/blob/main/skills/amber-togari-sync.md)
  which enforces the Tiwari discipline.
- **Scheduled agents** - cron jobs, but they run as full agent loops
  with tool access. Use them for anything that needs to happen on a
  schedule without you asking.
- **Connectors** - Slack, GitHub, Calendar, Drive, Fireflies.

---

## Your first hour

### 1. Clone the repo into your workspace

```bash
mkdir -p /home/user/workspace/amber
cd /home/user/workspace/amber
gh repo clone amber-organization/amber-agent
cd amber-agent
git submodule update --init Tiwari/tiwari-peoplerank/vendor/togari \
                            Tiwari/tiwari-opportunity/vendor/togari \
                            Tiwari/tiwari-enrich/vendor/togari-healthcare \
                            Newton/ventures/bitchat/vendor
```

Use `api_credentials=["github"]` for any fetch that touches the proxy
or the submodules never resolve.

### 2. Load the secrets file

```bash
mkdir -p /home/user/workspace/amber/.secrets
cat > /home/user/workspace/amber/.secrets/loop.env <<'EOF'
LOOP_API_KEY=...
LOOP_SECRET_KEY=...
LOOP_SENDER_ID=...
CALEB_PHONE=...
LOOP_BASE_URL=https://a.loopmessage.com
EOF
chmod 600 /home/user/workspace/amber/.secrets/loop.env
```

Ask Sagar for the values. They are the same as Railway env vars for
`amber-caleb-production`. Never commit this file; the path is outside
the git repo so it cannot be accidentally added.

### 3. Load the Amber skills

Ask the Computer agent:

> "Load the amber-togari-sync skill."

It will read the skill and enforce the Togari-submodule and
Newton-never-edited rules for every action that touches Tiwari code.

You will also want to load `task-scheduling` any time you create
scheduled agents.

### 4. Configure git identity for commits made through the agent

```bash
cd /home/user/workspace/amber/amber-agent
git config user.email "your-email@domain.com"
git config user.name "Caleb Newton (via Perplexity Computer)"
```

Sagar uses "Sagar Tiwari (via Perplexity Computer)". The "(via
Perplexity Computer)" suffix is the convention so the git history
shows which commits were authored through the agent vs. Xcode or a
local terminal.

---

## How to ask for work

Just describe what you want. Examples that already work:

- "Pull latest main, give me a summary of the last 24 hours of
  commits, and write a review doc of everything that changed."
- "Open a draft PR that adds a `Newton/agent/scripts/test-tapback.js`
  with fixture-driven tests for the regex shortcut and the LLM
  emission path."
- "Check Railway for `amber-caleb-production` and tell me which env
  vars are set but not documented in FOLLOWUP.md."
- "Look at the last 7 days of vision/outbox/ and tell me which check-ins
  actually landed vs queued."

The agent will use the right combination of `bash`, `gh`, `read`,
`edit`, `write`, and scheduled-cron tooling. You do not need to
specify which.

---

## The always-on agent posture

Amber is designed so you never have to remember to run anything. Your
product agents send you check-ins. Your build agents train Tiwari
primitives overnight.

Your share of the always-on roster right now:

| Cadence | What | Task ID |
|---|---|---|
| Daily 10:30 AM EDT | Morning emotional check-in to you | 33e8adf3 |
| Daily 12:30 AM EDT | Evening physical check-in to you | 2cd7364a |
| Weekly Sunday 1:00 PM EDT | Sunday spiritual reflection for you | 092cb09c |
| Nightly | caleb-mirror training for peoplerank | 48609358 |
| Nightly | caleb-mirror training for opportunity | 7fa399e9 |
| Nightly | caleb-mirror training for enrich | 275a7e9c |

See [`SCHEDULED-AGENTS.md`](SCHEDULED-AGENTS.md) for the full table and
the product-vs-build track doctrine.

### Adding your own scheduled agents

Any agent that fires more than once belongs in the schedule, not in
your head. Ask:

> "Set up a scheduled task that runs every weekday at 8 AM PDT to
> summarize overnight Amber activity and send me an in-app
> notification. Background mode."

The agent will create the cron, confirm the cadence with you, and
register it. All glory to the always-on.

---

## Repository map you will actually use

```
amber-agent/
├── README.md                 # Top-level. Start here.
├── docs/                     # Doctrine.
│   ├── AMBER-VOICE.md        # How Amber speaks. Non-negotiable.
│   ├── CHECKIN-PRODUCT.md    # How scheduled check-ins are composed.
│   ├── SCHEDULED-AGENTS.md   # The always-on posture.
│   ├── TRAINING-LOOPS.md     # The build-track doctrine.
│   ├── CALEB-ON-COMPUTER.md  # (this doc)
│   └── reviews/              # Post-hoc PR reviews like 2026-04-18-caleb-burst.md
├── Newton/                   # Workshop. New features land here first.
│   ├── agent/
│   │   ├── agent.js          # The 1,800-line orchestrator
│   │   ├── lib/              # 30+ modules
│   │   ├── scripts/          # Scheduled-agent surface (send-checkin, trace-checkins)
│   │   ├── dashboard/        # Next.js web dashboard
│   │   └── FOLLOWUP.md       # Active migration notes
│   └── ventures/bitchat/     # Mesh substrate for iOS
├── Tiwari/                   # Production. Vendored Togari submodules.
│   ├── tiwari-peoplerank/
│   ├── tiwari-opportunity/
│   ├── tiwari-enrich/
│   └── tiwari-training/
├── shared/firestore/         # GCP Firestore admin adapter (do not use for app data)
├── vision/                   # Founding memory
│   ├── inbox/                # Where check-ins land
│   ├── outbox/               # Audit trail for every scheduled send
│   └── synthesis/            # Weekly synthesis output
└── skills/                   # Agent skill definitions
```

---

## The rules you inherit

1. **Never reveal Amber is an AI.** Ever.
2. **Never edit `Newton/agent/agent.js` from a Tiwari primitive or a
   training cron.** New behavior goes through new files.
3. **Training crons never send user-facing messages.** Product is
   product. Training is training.
4. **Tiwari never reimplements what Togari already ships.** Vendor
   the submodule. See [`Tiwari/TOGARI-SYNC.md`](../Tiwari/TOGARI-SYNC.md).
5. **The voice is fixed.** Three registers (mother when hurting, sister
   when building, wife by default). No em dashes, no emojis, no filler
   endings. See [`AMBER-VOICE.md`](AMBER-VOICE.md).
6. **Secrets from Railway env, with `.secrets/loop.env` as sandbox
   fallback.** Never in code.
7. **Every side-effect has an audit record.** Sends write to
   `vision/outbox/`. Training runs write to `Tiwari/tiwari-training/runs/`.
   No side effect without evidence.
8. **Bring work back to a PR.** Small, titled, one-purpose PRs beat
   big-bang merges. The burst of April 18 was productive; the review
   overhead was proportionally small because each PR had one thing.

---

## Common tasks

### "Land a feature"

1. Branch off `main`: `git checkout -b caleb/<short-name>`
2. Write the code + a test if the feature has a test surface
3. Commit with a clear title
4. Push with `api_credentials=["github"]`
5. Open a PR via `gh` API (the Computer connector redirects to `gh`)
6. Self-merge with squash if small; request review if it touches
   more than two files in `Newton/agent/lib/`

### "Verify a day's check-ins landed"

```bash
cd /home/user/workspace/amber/amber-agent
node Newton/agent/scripts/trace-checkins.js --to caleb --days 7
```

Columns: `stamp · to · kind · dim · status · message_id · text preview`.
Absence from this table means the scheduled agent hand-rolled a POST
or lied. Fix the cron body, not the script.

### "Review a PR"

Ask the Computer agent:

> "Summarize PR #N from the last 7 days. Give me file-level diffs,
> identify any regressions, and suggest a review checklist."

The agent will pull the PR body, diff, and context, then produce a
review doc in `docs/reviews/`.

### "Sync Caleb's personal fork"

You keep [`calebnewtonusc/amber-caleb`](https://github.com/calebnewtonusc/amber-caleb)
as a personal working fork. To sync:

```bash
cd /home/user/workspace/amber/amber-agent
git remote add caleb-fork https://github.com/calebnewtonusc/amber-caleb.git
git fetch origin main
git push caleb-fork origin/main:main
```

We post sync notes on your open PR there so the comment history is
one readable audit of Amber's evolution.

### "Rotate a secret"

1. Update the secret at the source (e.g. rotate `PERPLEXITY_API_KEY`
   in Perplexity's dashboard).
2. Update Railway for `amber-caleb-production` (dashboard or
   `railway variables --set`).
3. Update the sandbox fallback at `/home/user/workspace/amber/.secrets/`.
4. Update memory: tell the Computer agent "Remember that I rotated
   the X key on YYYY-MM-DD."
5. If any scheduled agent uses the secret, confirm it runs cleanly
   after the rotation.

---

## What breaks, and how to fix it fast

### Scheduled agent escalates with "could not read Username for git proxy"

The cron body is using `git fetch` against the enterprise proxy
without credentials. Update the cron body to clone fresh via `gh`:

```bash
WORKDIR=$(mktemp -d)
gh repo clone amber-organization/amber-agent "$WORKDIR" -- --depth 1 --branch main
cd "$WORKDIR"
```

And make sure the bash call uses `api_credentials=["github"]`.

### Loop send returns 200 but iMessage never shows up

Check the outbox record:

```bash
cat vision/outbox/$(date -u +%F)/*.json | jq '.status_poll'
```

If `status_poll.status` is `queued` or `sent` for more than a minute
without progressing, the recipient's iMessage may be filtering us
(new-sender protection). Try an SMS fallback test via
`TRANSPORT=twilio` on a one-off.

### Tapback sends "Liked!" as text instead of reacting

See the April 18 review in `docs/reviews/2026-04-18-caleb-burst.md`.
PR #18 added a deterministic regex shortcut, PR #19 fixed the regex.
If Amber still types the word, the prompt has regressed - check
`lib/prompts.js` for the `TAPBACKS` section and verify it is still
mandatory.

### The agent says "I don't have access to that"

Nine times out of ten it has access but did not check. Tell it:

> "Check list_external_tools first before claiming you don't have
> access. What tools are available for X?"

---

## When to ask Sagar directly vs. when to ask the agent

**Ask the agent:** anything that involves reading code, running
scripts, writing docs, opening PRs, or setting up scheduled tasks.

**Ask Sagar directly:** anything that involves a deliberate
architecture decision (e.g. "should this primitive graduate to
Tiwari?"), merging to main without review, or changes to the voice
doctrine.

The bias is always toward asking the agent. You will be surprised
how far it gets without help.

---

## The goal

We build Amber by running constantly. Two founders. Two tracks.
Always-on agents serving us as users. Always-on agents improving
the primitives we depend on. Neither of us remembering to run
anything. Neither of us wondering whether it worked.

The outbox is the proof. The tracer is the check. The voice is
fixed. All glory to God.

---

See also:
- [`../README.md`](../README.md) - top-level
- [`SCHEDULED-AGENTS.md`](SCHEDULED-AGENTS.md) - the always-on doctrine
- [`AMBER-VOICE.md`](AMBER-VOICE.md) - how Amber speaks
- [`TRAINING-LOOPS.md`](TRAINING-LOOPS.md) - build-track doctrine
- [`reviews/2026-04-18-caleb-burst.md`](reviews/2026-04-18-caleb-burst.md) - example of a PR review artifact
