# Serif Health: how to research a warm-introduction path

This is the document the AI reads before researching a person. It is the
source of truth for the method and the rules. Publish it as a Google Doc
(**File → Share → Publish to web**) and put the `/pub` URL in
`SERIF_CONNECTION_GUIDE_URL`. Setup is in `docs/SERIF_CONNECTIONS_SETUP.md`.

Everything here is written to be read by a machine with no other context, so
it repeats things a person would consider obvious.

**This document has 9 sections and ends with section 9.** If you can see only
part of it, say so in `notes`.

---

## 1. What you are doing

Serif Health sells payer rate data to health systems, provider groups and
provider-tech companies. Serif wants warm introductions into a list of target
accounts, and the best route in is often through people at Serif's existing
customers.

You are given one person who works at one of Serif's customers. Your job is to
find out:
- where that person, and the senior people who work alongside them, **used to
  work**;
- which of those former employers are on Serif's target account list;
- **who sits in the buyer seat** at each of those target accounts today.

A typical path looks like this. Shannon works at Surgery Partners, a Serif
customer. Her colleague Justin is COO there, and before that he was at Hospital
for Special Surgery, which is a target account. So Shannon might introduce
Serif to Justin, and Justin might introduce Serif to the payer contracting lead
at HSS.

Each finished path runs from Shannon, through Justin and HSS, to a named person
in HSS's payer contracting team today. You are building the evidence for paths
like that. You are **not** deciding whether an introduction will happen, and
you never contact anyone.

---

## 2. The target account list

The task gives you a link to a published CSV with the columns Segment, Type,
Account and Company Domain. Read every row.

- If you can read only part of it, report how many rows you read in
  `target_rows_read`. **Never fill in the rest from memory.** A guessed list
  looks exactly like a real one, and that is the problem.
- When you name a match, use the **Account** value exactly as the sheet
  writes it, not your own spelling of the organization.

---

## 3. Who to research

(If your task says it is a **top-up**, read section 9 first. It changes who
you research.)

**The person on the row.** Confirm who they are first. A role counts only if a
source ties it to this individual, on their current employer plus their title
or location. Healthcare has a lot of people who share a name. If you cannot
confirm the person, set `identity_confirmed` to false, give them no roles, and
carry on with their colleagues.

**Their senior colleagues.** Up to eight people who work at the same company
**now**, in these roles:

- CEO, COO, CFO, Chief Strategy Officer, Chief Revenue Officer
- VP, SVP or Director of Managed Care
- VP, SVP or Director of Payer Relations, Payer Contracting or Payer Strategy
- VP, SVP or Director of Revenue Cycle
- VP, SVP or Director of Strategy or Corporate Development

Only include someone a current public source places at the company: a
leadership page, a recent press release, a recent filing. Leave out clinical-only
roles (MD, RN, PA) with no administrative title. If the company is small and
you find nobody, that is a fine answer.

---

## 4. What to report for each person

Every prior employer since 2005, **whether or not it is on the list.** A
non-match today is a match when Serif adds accounts, and the full history is
what makes that possible.

For each prior job:

| Field | What goes in it |
|---|---|
| `company` | The organization exactly as the source names it |
| `company_domain` | The organization's website domain. **Always give it.** If the job's source doesn't state it, look it up: it describes the company, not the person, so it needs no source of its own. Togari checks matches by domain. Null only if the company has no website you can find. |
| `title` | Their title there |
| `start_year`, `end_year` | Only years a source states. Never infer a year from the job before or after it. |
| `source_url` | The page that shows this job. **No source URL, leave the job out.** |
| `target_account` | The sheet's Account value, if this employer is on the list (see section 5). Otherwise null. |
| `match_basis` | `domain`, `name`, or `acquisition`. Null when there is no match. |

Leave out board seats, advisory roles and volunteer positions.

---

## 5. What counts as a match

A match means the **same operating organization**.

**These match:**

- The same website domain.
- The same organization under a slightly different name: "X Health" and
  "X Health System", or an abbreviation and its full name (HSS and Hospital for
  Special Surgery).
- An employer that has since been acquired by, merged into, or renamed to a
  listed account. Use `match_basis: acquisition`, and keep the name the source
  uses in `company`.

**These do not match:**

- A hospital that is merely a member of a listed health system, unless the
  person's role was system-level.
- Organizations that share a name in different places. Baptist Health South
  Florida is not Baptist Health in Kentucky.
- A vendor or consultancy that served a listed account.
- A private equity fund's portfolio company is not the fund, and the fund is
  not its portfolio company.

When you are unsure, leave `target_account` null. Togari checks every employer
you report against the sheet itself, so a missed match can still be found. A
false match is the expensive mistake. It sends someone to ask a customer about
a connection that does not exist.

---

## 6. Who to find at each target account

For each target account you matched, find who sits in the **buyer seat
there today**. That person is where the path ends.

- **How many.** At most 5 target accounts per person you research, the most
  recent departures first. Up to 3 people at each.
- **Only current people.** A current public source must place them there:
  a leadership page, a recent press release, a recent filing.

The buyer seat at a **health system or provider**:

- VP, SVP or Director of Managed Care, Payer Relations, Payer Contracting or
  Payer Strategy. This is the strongest fit.
- CFO, CEO or Chief Strategy Officer.
- VP or Director of Revenue Cycle.

At a **PE fund**, look for an Operating Partner, a Healthcare Vertical Lead, or
a Head of Portfolio Operations.

At a **provider-tech company**, look for a VP of Partnerships or a Chief Data
Officer. They don't have a managed-care function.

For each person:

| Field | What goes in it |
|---|---|
| `target_account` | The sheet's Account value, exactly as written |
| `target_domain` | That organization's website domain |
| `name`, `title` | As the source states them |
| `persona` | `managed_care_contracting`, `revenue_cycle`, `executive`, or `other` |
| `linkedin_url` | Their public profile, if you find one |
| `source_url` | The page that places them there now |
| `joined_year` | The year they joined **the organization**, not their current role. Only if a source states it. |

`joined_year` matters most. Togari compares it with the years the bridge
worked at the same organization, to see whether they were there at the same
time. Report the year a source gives. Never estimate it.

Finding nobody is a fine answer. Plenty of organizations don't publish who
runs payer contracting.

---

## 7. Rules that do not bend

1. **Never state or imply that two people know each other.** Public sources
   show that people worked at the same place, nothing more. Do not describe a
   working relationship, a reporting line, or a friendship unless a source
   says so in as many words.
2. **Every job needs a source URL.** No source, no job.
3. **Null, never a guess.** An unstated year is null. An unstated domain is
   null.
4. **Public professional history only.** Employer, title, dates. Nothing
   about anyone's personal life, contact details, or anything that is not on
   a professional page.
5. **Do not contact anyone.** Do not send email, connection requests, or
   messages.

---

## 8. What happens to your answer (do not change)

The task tells you where to POST your result and which field names to use.
Use exactly those names:
- `row_id`, `target_rows_read`, `identity_confirmed`;
- `people`, with their `roles`;
- `target_contacts`;
- `notes`.

The endpoint reads `row_id` to know which person you researched. A result
under any other field name is silently lost.

Authenticate with the credential already saved in this project for that host.
Never open a credential request form. Nobody is watching to approve it, and
the task stalls.

---

## 9. Top-up research

Some tasks start "You are topping up warm-introduction research". Togari
already holds the person's career history, and their colleagues', from
research done in the last year. Only the gaps are left, and the task lists
them. Everything in sections 1 to 8 still applies, except for these
differences:

- **Do not research the person again.** Don't confirm them, and don't list
  their employers. Leave them out of `people` and set `identity_confirmed` to
  null. Togari already has both.
- **Colleagues, only if the task asks for them.** It lists the roles to look
  for and the colleagues Togari already has. Find people in those roles who
  are not on that list, using the rules in section 3. For each new colleague,
  report every prior employer exactly as section 4 says, and match against
  the sheet exactly as section 5 says.
- **Buyer seats, only at the accounts the task lists**, plus any target
  account a new colleague matched. Use the rules in section 6. The task also
  lists accounts whose buyers Togari already has. Don't search those, even if
  a new colleague matched them.
- **If a section has nothing to do, skip it.** A top-up that asks only for
  buyer seats doesn't need the sheet. Report `target_rows_read` as null.

Post the result the way section 8 says, to the same address, with the same
field names. `people` holds only the new colleagues, and `target_contacts`
holds only the new buyers. Togari merges them with what it already holds
before it builds any path, so you never need to repeat known people.

Finding nothing new is a fine answer. Post an empty `people` and
`target_contacts`, with a line in `notes` saying so.
