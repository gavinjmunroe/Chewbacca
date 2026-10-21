# How to Review + Test an Amber PR

Perplexity Computer does static analysis and scaffolding. Railway, Xcode, and
actual iMessage wiring run on your laptop. This doc is the bridge.

## 1. Static pass (Computer — already done on every session)

- `node --check` on every touched `.js` file
- `git submodule status` to confirm pinned SHAs
- PR body contains the Togari sync statement (see `Tiwari/TOGARI-SYNC.md`)
- No edits inside `Newton/agent/agent.js`, `Newton/platform/*`,
  `Newton/infrastructure/*`, or `Perplexity/*`
- Every new route has a billing-tier guard if it consumes Tiwari primitives

## 2. Local smoke — amber-id

```bash
cd amber-id
git checkout sagar/feat/cnft-pinecone-ask
pnpm i  # or npm i
cp .env.example .env
# fill SOLANA_*, PINECONE_*, OPENAI_*, ANTHROPIC_*, PEOPLERANK_*
pnpm drizzle-kit push  # applies 0001_cnft_identity.sql
pnpm dev               # starts on :3000

# ── smoke requests ──
curl -s localhost:3000/health

TOKEN="<Privy JWT from Privy dashboard>"

# mint (run once)
curl -s -X POST localhost:3000/identity/mint \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ownerPubkey":"<pubkey>"}' | jq

# whoami
curl -s localhost:3000/identity/me -H "Authorization: Bearer $TOKEN" | jq

# ask
curl -s -X POST localhost:3000/ask \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question":"Who in my network cares about longevity?"}' | jq
```

Green if: `/health` → 200, mint → `{ cnftMint, cnftAssetId }`, ask → `{ ok:
true, answer: "...", people: [...], citations: [...] }`.

## 3. Local smoke — amber-agent (Tiwari proxy)

```bash
cd amber-agent
git checkout sagar/feat/people-knowledge-layer
git submodule update --init --recursive
cd Newton/agent
npm i
cp .env.example .env   # fill AMBER_ID_API_URL, AMBER_ID_API_KEY
node agent.js          # starts on :10000

TOKEN="<same Privy JWT>"

# identity resolution through the proxy
curl -s localhost:10000/api/identity/me -H "Authorization: Bearer $TOKEN" | jq

# ask
curl -s -X POST localhost:10000/api/ask \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"question":"Who should I call today?"}' | jq

# peoplerank
curl -s -X POST localhost:10000/api/tiwari/peoplerank \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"longevity founders in SF","filters":{}}' | jq

# opportunity — FREE-tier iMessage gate (expect 402)
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:10000/api/tiwari/opportunity \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"trigger":{"type":"daily_digest","channel":"imessage"}}'
# expected: 402
```

## 4. Local smoke — amber-ios

```bash
cd amber-ios-dev
git checkout sagar/feat/ask-amber-bar
pnpm i            # turbo workspace install
open AmberApp/AmberApp.xcodeproj
# select simulator, run. sign in with Privy, onboarding should mint cNFT.
# drop AskAmberBar into any screen as a subview to test /ask.
```

## 5. Staging deploy

- **amber-id** → push to `dev-preview` branch, Railway preview env.
- **amber-agent** → push to `staging`, Railway preview env.
- **amber-ios** → merge PR into `dev`; GitHub Actions ships TestFlight build.

## 6. Promotion criteria

A feature can promote Newton → Tiwari or dev → main only when:

1. All three smoke blocks above return the expected responses.
2. Togari sync statement in the PR body is current (pinned SHA = Togari main
   HEAD at merge time, or a conscious lag is documented).
3. Billing gates are tested for at least one paid route.
4. At least one real user (Sagar or Caleb) has completed onboarding against
   the staging env and seen their cNFT minted.

## 7. Tie to Billion Dollar Build

Every Tiwari PR description must name which of the five criteria it
advances: market, engine, traction, economics, founder-market-fit. This
keeps the build honest — if a PR doesn't move one of those, it's a
distraction.
