# Evaluation of folded sources

Deep evaluation performed 2026-08-02 before the fold. Verdicts guide what to
keep warm vs archive vs extract.

## Summary verdicts

| Source | What it is | Sandbox role | Extract priority |
| ------ | ---------- | ------------ | ---------------- |
| peoplerank-sandbox | FastAPI + Python scoring + MCP/DNC | **Primary algorithm lab** | P0 |
| messages2kit | Swift iMessage provider + CLI | Native messaging kit | P0 |
| messages2 | Electron Messages.app clone | Reference UX / SQL | P2 (lessons only) |
| amber-core | People/memory/approvals API | Platform foundation slice | P1 |
| tizzy | Wearable coach product | Product + schema sandbox | P1 (selective) |
| fiduciaryos / egats / marrow | Large product ventures | Archive / graduate elsewhere | P3 |
| waitlist/static ventures | Concept landings | Archive only | — |

---

## peoplerank-sandbox

**Identity:** Multi-surface people recommender for Amber / Togari. Explicitly the
algorithm sandbox (Caleb + Shirley); production engine lives in `togari-search`.

**Strengths**
- Dual surfaces sharing one scorer: one-sided PeopleRank + UC1/UC3 matching
- Schema-agnostic `Person` model + Blind8 adapters
- Fallback chain: OpenAI embeddings → TF-IDF → Jaccard
- Offline unittest contract for iOS response shape
- Rationale voice validators (product-differentiating copy rules)
- Eval fixtures (Austin dinners, Blind Aid) + diagnose CLI
- v2 design docs (retrieval → LTR → PageRank → outcome loop)
- DNC taxonomy + `dnc_sync.py` MERGE rules for medha-id → BQ → Clay

**Gaps**
- `centrality` / `recency` reported as 0.0 (seams only)
- In-memory match idempotency (not durable)
- MCP/DNC Node stack is adjacent ops, not the ranking core
- No CI config in source repo

**Preserve:** `src/peoplerank/`, matching/grouping, rationale validators,
response-shape tests, design + DNC docs.

---

## messages2 + messages2kit

**Identity:** Local macOS iMessage read/send. Electron app is the frozen
reference (`v0.2.0`); Kit is the Swift library ClearOut binds to.

**Strengths (shared)**
- Production chat.db SQL (window-function sidebar, reaction folding, optional columns)
- Mac Absolute Time handling; attributedBody when `text` is null
- Send path via AppleScript; TCC lessons (FDA, Automation)
- Group display-name derivation from participants

**Kit-specific strengths**
- Clean `MessagesProvider` + `MockMessagesProvider`
- WAL DispatchSource watcher (~250ms debounce)
- Contacts.framework (vs Electron AddressBook SQLite)
- `markRead` writeback; `messagesWithHandle` for per-person history
- Swift Testing smoke suite for pure logic

**Messages2-specific strengths**
- Full Messages.app UX parity (bubbles, filters, media, optimistic send)
- HEIC/CAF conversion; cold-start preview cache
- Typed IPC contract (`window.messages`)

**Gaps**
- Electron: no automated tests; macOS-only
- Kit: no real chat.db integration tests in CI; macOS 15+
- Neither is a cloud messaging product

**Preserve:** Kit as extractable package; Electron as reference, not platform core.

---

## tizzy

**Identity:** Pre-launch product — always-wearable autism conversation coach.
Not a library; company OS + demo + mobile scaffold.

**Strengths**
- Clear product thesis (coach ≠ companion; baseline-relative metrics)
- Coaching taxonomy + haptic language (Notice / Adjust / Ground)
- Privacy architecture (features-not-audio, consent modes, COPPA/FERPA docs)
- Rich conversation schema (sessions/turns/moments/haptics)
- Navigable Next.js demo + seeded longitudinal demoData + Claude coach
- Mobile offline stack seeds (BLE, SessionRecorder, SQLite sync queue)
- Mobile Jest suite present (partial coverage)

**Gaps**
- No in-repo backend (`api.tizzy.app` is aspirational)
- Mobile `App.tsx` stub vs Expo Router screens — wiring incomplete
- Hardware/firmware are specs only
- Docs volume dominates; some overlap/duplication

**Preserve:** Schema/taxonomy/privacy model, demo + demoData, client SDK patterns.
Leave business/legal docs in-domain; do not dump into medha-platform agent tree.

---

## amber-ventures / ventures archive

**Identity:** 11 ventures extracted from medha-platform on 2026-05-27 to stop
agent monorepo bloat (~130K LOC). Archive-first by original README policy.

**Worth keeping warm**
- `amber-core` — only real internal package graph; Loop Message + people/memory
- FiduciaryOS — most complete product (but belongs in its own repo if revived)
- EGATS / Marrow — substantial Supabase apps (Marrow canonical elsewhere)

**Thin / concept-only**
- homemap, bea90skid, tally-app, babel-translate

**Gaps across archive**
- Almost zero tests
- No root workspace (by design then; sandbox now uses `domains/` instead)
- README dimension labels sometimes mismatched actual products
- amber-core schema drift (`agent_suggestions` missing)

**Policy under medha-sandbox:** stay under `ventures/`; new work goes to
`domains/` or a dedicated amber-organization repo.

---

## Cross-domain opportunities (post-fold)

1. **People graph alignment** — amber-core `people-graph` + peoplerank `Person`
   share a thesis; eventually one contact spine (medha-id) should feed both.
2. **Messaging × ranking** — peoplerank says *who*; Messages2Kit can *reach*.
   ClearOut was the intended glue (deleted from archive); Kit restores the path.
3. **Tizzy × amber-core memory** — coaching moments could become Amber memories
   later; do not wire until Tizzy cloud API exists.
4. **Shared eval discipline** — peoplerank's offline harness pattern should be
   the template for any other algorithm domain added here.
