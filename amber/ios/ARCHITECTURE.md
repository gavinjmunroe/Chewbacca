# Amber Architecture — How the Repos Work Together

This doc explains how the consumer-facing Amber product is wired together: the mobile app (this repo), the identity backend (`amber-id`), and the AI / iMessage backend (repo `amber-imessage`, deployed as Railway service `amber-agent`).

---

## The Core Repos

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER'S PHONE                             │
│                                                                 │
│    amber-ios — apps/mobile/ (React Native + Expo)               │
│    ┌──────────────────────────────────────────────────────────┐ │
│    │  Contacts · Chat · Profile · Network Viz · Onboarding    │ │
│    │  Health Dimensions · Privacy Tiers                       │ │
│    └────────┬─────────────────────────────────┬───────────────┘ │
└─────────────┼─────────────────────────────────┼─────────────────┘
              │ HTTPS                           │ HTTPS
              ▼                                 ▼
     ┌─────────────────┐              ┌──────────────────────┐
     │    amber-id     │              │     amber-agent      │
     │    (Railway)    │              │     (Railway)        │
     │                 │              │                      │
     │  WHO you are    │              │  WHAT Amber does     │
     │                 │              │  for you             │
     │  Auth (Privy)   │              │  AI chat             │
     │  Profile data   │              │  Health dim. infer   │
     │  Privacy tiers  │              │  iMessage bot        │
     │  Knowledge DB   │              │  Tools               │
     └─────────────────┘              └──────────────────────┘
```

> **Naming note.** The AI / iMessage codebase lives in the **`amber-imessage`** GitHub repo, but the Railway service it deploys is named **`amber-agent`**. References to `amber-agent` in this doc and in client code mean *the live Railway service*, not the repo. (Older docs referred to this service as `amber-caleb`; that name is retired.)

---

## amber-ios — The App (this repo)

**What it is:** The Amber mobile app users will install on their phone.

**Where the active code lives:** `apps/mobile/` — a **React Native + Expo** project. This is the app shipped to TestFlight / the App Store.

**Legacy:** `legacy-ios/AmberApp/` is the previous SwiftUI prototype, kept for reference. It is not the active build target.

**Also in this repo:**
- `packages/amberkit/` — shared Swift package retained for the legacy iOS path.
- `services/app/` — a TypeScript backend that currently still deploys to Railway via `railway.toml`. Treat as legacy infrastructure — do not extend it; new backend work belongs in `amber-id` or `amber-agent`.

**Deployment:**
- The mobile app ships via **TestFlight** (beta) and the **App Store** (production) using EAS / Expo build pipelines.
- The backend code under `services/app/` deploys to Railway via `railway.toml`. It is in-place legacy and out of scope for this doc.

**Branching:**
- `dev` = active development. All PRs merge here. Triggers TestFlight builds.
- `main` = production. Only accepts merges from `dev`.
- Feature branches: `{name}/feat/{description}` → PR to `dev`.

**The mobile app is a pure client.** It calls the Railway services over HTTPS. No API keys in the app bundle.

---

## amber-agent — The Brain

**What it is:** An always-on AI agent that lives in iMessage (via Loop Message) and powers the AI features in the mobile app.

**Repo:** `amberintelligence/amber-imessage`
**Live Railway service:** `amber-agent` (`amber-agent-production.up.railway.app`)

**What it does:**
- Receives messages via iMessage webhook (Loop Message).
- AI-powered conversations using the Tiwari router:
  - **Search** (Exa API) — web/social search.
  - **Context** (Perplexity API) — primary AI reasoning.
  - **Visualize** (Loop API) — iMessage output.
  - **Connect** (Composio) — Gmail, Calendar, Drive, LinkedIn.
- Tracks 6 health dimensions for every contact.
- Per-person profiles with confidence-scored notes.
- Skill files for health check-ins, ADHD support, prayer, etc.
- Proactive daily outreach and check-ins.

**How the mobile app talks to it:** The mobile app sends messages to `amber-agent-production.up.railway.app/api/chat` with a Privy JWT. The agent processes the message through its AI pipeline and returns a response. For iMessage users, the agent responds directly through Loop Message.

---

## amber-id — The Identity Vault

**What it is:** Privy auth, user profiles, privacy tiers, and the knowledge base (Pinecone vectors + wiki).

**Repo:** `amberintelligence/medha-id`
**Live Railway service:** `amber-id` (`amber-id-production.up.railway.app`)

**What it does:**
- Authenticates users via Privy (phone + SMS OTP).
- Resolves tenants (maps Loop sender IDs to user profiles).
- Stores user identity data (birthday, personality, alma mater, etc.).
- Manages privacy tiers (what data the user shares and with whom).
- Knowledge base: wiki articles + Pinecone vector embeddings.
- Single source of truth for "who is this user".

**How the mobile app talks to it:** On app launch, the mobile app calls `amber-id-production.up.railway.app/auth/verify` with the Privy token. amber-id returns the user profile. Every subsequent API call includes this token.

---

## How They Play Together

### User opens app for the first time
```
1. apps/mobile shows onboarding screens
2. User enters phone → Privy SMS OTP
3. apps/mobile → amber-id: POST /auth/onboard (creates profile)
4. apps/mobile → amber-id: POST /auth/verify (gets JWT)
5. User enters birthday, personality, alma mater → amber-id stores it
6. User grants Contacts permission → apps/mobile reads phone contacts
7. Done. User is on the home screen.
```

### User chats with Amber AI
```
1. apps/mobile → amber-agent: POST /api/chat { message, token }
2. amber-agent verifies token with amber-id
3. amber-agent loads user context
4. amber-agent calls Perplexity (Tiwari Context bucket) for AI response
5. If search is needed → Exa API (Tiwari Search bucket)
6. amber-agent → apps/mobile: response with health dimension tags
7. apps/mobile renders the response in the chat UI
```

### Someone texts the user on iMessage
```
1. Loop Message webhook → amber-agent
2. amber-agent resolves sender via amber-id tenant lookup
3. amber-agent processes message, infers health dimensions
4. amber-agent → Loop Message: sends iMessage reply
5. Background: updates contact profile
```

---

## For Your Reference

| Repo                                  | Live Railway service | Notes                                                        |
| ------------------------------------- | -------------------- | ------------------------------------------------------------ |
| `amberintelligence/amber-ios`        | n/a (mobile client)  | This repo. `apps/mobile/` is the active app; `legacy-ios/` is reference. `services/app/` still deploys to Railway as legacy. |
| `amberintelligence/medha-id`         | `amber-id`           | Identity, auth, knowledge base.                              |
| `amberintelligence/amber-imessage`   | `amber-agent`        | AI agent + iMessage integration. Repo and service have different names — don't conflate them. |

### To clone and start working
```bash
git clone https://github.com/amberintelligence/amber-ios.git
cd amber-ios
git checkout dev
pnpm install
pnpm --filter mobile start
```
