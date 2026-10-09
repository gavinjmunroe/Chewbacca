---
name: project-amber-architecture-study
description: "What Karthik is actually building in amber-id, what Chewbacca should take from it, and the amber-pull tool that keeps this current."
metadata:
  node_type: memory
  type: project
  originSessionId: 08fd02f2-a49a-4908-a6fe-ceb1f7f96407
  modified: 2026-09-16T18:48:03.177Z
---

**Source-of-truth update 2026-10-01 (Caleb):** For Amber architecture questions, read `amber-id` and `amber-search` at freshly fetched `origin/main`. Older notes below are historical context, not current architecture evidence.

Studied 2026-09-09 on Caleb's instruction to keep pulling changes from Amber.
Chewbacca's `people` layer is a port of Amber's with Karthik and Sagar's
standing permission, so their architecture decisions are upstream of ours.

**Karthik ships hard.** 82 commits to `amber-id` in the three days to 2026-09-09.
The current shape is a chat lane over a people-and-circles graph: a question is
parsed in code in under a millisecond, each clause is asked separately, answers
come back as cards plus prose in matching sections, and parts stream as they
land. Voice notes keep their recording, not only the transcript.

## The three things worth taking

**1. Facts have a shelf life** (`amber-search/api/temporal.py`, 2026-08-25).
"Sagar is visiting SF for a month" and "Sagar moved to SF" are the same sentence
to anything that only reads text. One is true forever, one is true for five
weeks, and nobody sends a correction when a trip ends. Karthik's rule is
conservative: a fact perishes only when it SAYS it is temporary, a permanence
cue always wins, and an expired fact is evidence of what someone DID, never of
what is true now. **Ported into Chewbacca 2026-09-09** and credited in the
source.

**2. `contact_identity_keys`.** One person, many handles: phone, email, and the
provider's own id, all hashed. Chewbacca hit the identical problem the same week
(Carlo texting from his iCloud address read as a stranger, 1,247 messages) and
arrived at the same table independently. Karthik's version carries a warning
worth repeating: _no user-facing path may query it, only the signup job, because
a user-facing reverse lookup turns the product into a surveillance tool._

**3. The private-edge invariant**, from `docs/PERSON-CONTRACT.md`: _your notes
about a person are not that person's account._ A contact row is a private edge.
`linked_amber_id` is set only when the contact is actually an Amber user, and an
unknown inbound sender returns 404 rather than being substituted with the tenant
owner. That last clause is what prevented "Maggie answered as Sagar", and it is
the **same class of bug** Chewbacca had on 2026-09-09, where a group thread's
name claimed every other sender's messages.

## The six dimensions are Amber's ontology, not a Chewbacca invention

`ARCHITECTURE-SIX-DIMENSIONS.md` is explicit that spiritual, emotional,
physical, intellectual, social and financial are the schema of the product and
of the company. Never invent a seventh, never merge two, never rename. Never use
"mental health" as a catch-all: it collapses emotional, spiritual and
intellectual into one bucket. Amber owns the three feminine-coded dimensions
(the connection hemisphere), Perplexity the three masculine-coded ones (the
knowledge hemisphere).

## Retired framing, do not resurrect

`ARCHITECTURE-PEOPLE.md` still describes the April 2026 Privy to cNFT to
Pinecone `cnft:<mint>` design. **That namespace is retired.** Knowledge lives in
`tenant-<privy_did>`, `amber_id` is the ownership root, and Postgres holds the
dataset. Bubblegum survives only as a nullable portable identity proof.

## The 2026-09-16 pull: two more things taken

200 commits in the fortnight to 9/16, all Karthik, across `amber-id` and
`amber-ios` only. `amber-search` is quiet and **`amber-sandbox` now 404s**, so
that repo is gone rather than private. The shape of his fortnight: social
sign-in, blocking and reporting, many calendars per person, reminders that
survive midnight, and a rebuild of how a question gets answered.

**1. The retrieval ladder** (`src/db/gather.js`, commit 4d69468). Amber had
four lanes and each loaded a different fixed slice of the database, chosen by
how the question was PHRASED. "who do I know at USC" read observations; "who
goes to USC" read nothing. Karthik had thousands of observations so every lane
returned something for him, and the app was a product for one person and a
shrug for everybody else. The replacement does not route: it searches every
layer unconditionally, layers are non-exclusive and each is labelled with how
good its evidence is, and **the inventory is part of the result, including the
zeros**. No synonym table, because a hand-written vocabulary only ever fits the
person who wrote it.

**Ported into Chewbacca 2026-09-16.** `people who` had the identical defect: it
filtered the `people` table and never read `observations`, so `distill` and
`infer --apply` were write-only. It could conclude somebody went to his school,
store it, and answer "who went to school with me" by ignoring it. That closes
defect 2 of the four in a private note.

**2. The name splitter in `src/lib/name-split.js`**, which decides what part of
a contact name is a name and what part is an annotation. The address book is
its own dictionary: a token on thirty different people is a label, the same
token on three is a family. No list, no model. This replaced Chewbacca's
two hand-written label lists, which were Caleb's own vocabulary shipping in a
public kit where they matched nothing for anybody else. Pointed at his 3,351
contacts it rediscovered the entire hand list and found AINA, FCF, Arcadia, CV
and TC on top.

**Three places the port had to diverge, each because it broke on real data:**

- A learned label must never apply to a first token, or "Maia IYA" goes back to
  stripping to an empty string.
- A token the book mostly uses as a name is a name, whatever position it lands
  in. **Three-part names are the trap**: a surname at index 2 reads as
  annotation, so four cards like "Colin Inkyu Kim" leaked "kim" into the
  vocabulary and all 43 Kims lost their surname. Middle names are ordinary, and
  in Korean, Vietnamese and Spanish books they are the common case. Amber has
  this bug.
- When every token reads as a label, the whole field goes back to being the
  name rather than just the first token, because this store holds organisations
  somebody saved as a contact and "USC Christian Challenge" is a ministry.

## Keeping this current

`amber-pull` is on PATH (`chewbacca/bin/lib/amber-pull.sh`). No arguments shows
everything since the last run; `amber-pull 14` for a fixed window; `--clone`
also fetches the repos into `~/code/`.

Related: a private note, [[project_chewbacca_amber_port_authorized]],
[[project_amber_circles_architecture]], [[reference_amber_org_restructure_2026_08_31]].
