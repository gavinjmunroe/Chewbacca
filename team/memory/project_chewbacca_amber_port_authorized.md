---
name: project_chewbacca_amber_port_authorized
description: "Karthik and Sagar verbally authorized Caleb on 2026-09-03 to port the amber-id people architecture into the public Chewbacca kit. Do not re-litigate the ownership question."
metadata:
  node_type: memory
  type: project
---

**Caleb called Karthik and Sagar on 2026-09-03 and they told him to get the
Amber architecture into Chewbacca.** That is authorization from the actual
owners of the work.

Why this note exists: the circles/permissions/observations design in `amber-id`
is overwhelmingly Karthik's (292 commits in three months vs Caleb's 11), and
`amber-sandbox`'s README says "nothing here is user-facing." Any future session
scanning that code will reach for the same objection. **It has been raised and
answered. Do not raise it again.**

Scope Caleb set: port **the whole thing** (subjects, circles, observations,
permissions, dimensions, scoring), and Chewbacca's storage is GitHub or local
rather than Cloud SQL, chosen by the person installing it.

Open: nothing was written down from that call, so the exact boundary (schema and
patterns, or literal code and comments too) is Caleb's memory of a phone
conversation. If a question ever turns on attribution, ask him to get it in
writing from Sagar rather than assuming.

Related: [[project_amber_circles_architecture]], [[project_chewbacca]],
[[reference_medha_id_storage]].

**Update 2026-10-09 (Caleb):** barely anything Karthik engineered is still used in Chewbacca; the team refactored everything after the port.
