---
name: project_amber_circles_architecture
description: "Karthik's people architecture in amber-id: circles, the two permission tables, observations as one table, and the six dimensions as rows. Read before touching Amber's backend."
metadata:
  node_type: memory
  type: project
---

Scanned 2026-09-03 against live `amber-id` main. **This is Karthik's work**, not
Sagar's and not Caleb's: 292 of the last 3 months' commits are his, and circles
have been his thread since `circles foundation` on 2026-07-17.

**It is not BigQuery.** Everything below is one GCP **Cloud SQL Postgres**
database, 71 tables, migrations `20260828_001` to `20260901_028`. See
[[reference_medha_id_storage]].

## The four ideas worth stealing

**Tenant isolation is a foreign key, not a WHERE clause.** Every table carries
`UNIQUE (owner_id, id)`, and children point at *both* columns
(`FOREIGN KEY (owner_id, circle_id) REFERENCES circles (owner_id, id)`). A row
whose owner disagrees with its parent's owner is unwritable. Karthik's note:
"the single line that makes a row whose owner disagrees with its parent's owner
impossible to write."

**Circle members are contacts, not accounts.** You can put someone in a circle
who has never heard of Amber; they see nothing until they sign up and the card
links. Visibility resolves at read time through the contact, so a membership
change takes effect instantly.

**Two permission tables that read the same way.** `network_visibility` is "their
network you can see" (`max_depth` 0-3); `shares` is "your info they can see".
Both use the same scope model: `network` (scope_ref NULL) / `circle` / `contact`,
most specific grant wins, and **absence of a row means depth 0, not depth 1**.
Traversal walks `connections` and only `connections`: "your address book is not
an edge anyone else may hop through, that distinction is the difference between
a webtree and a leak."

**Observations is one table, not seven.** Facts, notes, experiences, memories and
transcript chunks collapsed into `observations` because they had identical
shapes, indexes, authorization and lifecycles. Subject is contact / circle / you,
enforced by CHECK. `modality` (actual, planned, hypothetical, desired, available,
declined) is a **column not a tag**, because getting it wrong yields a wrong
answer rather than a vague one.

## The six dimensions are rows

`dimensions` seeds spiritual, emotional, physical, intellectual, social,
financial, each with a `half_life_days` (spiritual 730, emotional 90) and a
`base_weight`. `scoring_params` is key/value on purpose so a new knob needs no
migration. **Retuning how Amber weighs financial stress is an UPDATE in Cloud
SQL Studio, not a deploy.** Note this unifies what
[[project_amber_vision]] describes as the Medha (S/E/P) and Togari (I/F/S) split:
at the schema level they are now one table.

`contact_scores` and `contact_dimension_state` are derived, rebuildable, and
refreshed by a job rather than a trigger, "because a trigger fires invisibly
whether you meant it to or not."

## How circles reach PeopleRank

Indirectly, through facts. `circle-classifier.js` sends the circle name and
description to Haiku, gets back `{kind, fact}` (interest / experience /
affiliation / other), and `circle-enrichment.js` writes that fact onto every
member as a `contact_facts` row with `source_circle_id` provenance. PeopleRank
(`amber-search`) then searches those facts. **`amber-search` has zero references
to circles** and does not need any.

Related: [[reference_medha_id_storage]], [[project_amber_vision]], a private note,
[[project_togari_collaborators]].
