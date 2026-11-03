# people-amber

Six modules from Amber's people layer, copied from `amber/id/src/lib/`
(amberintelligence/amber-id 9d29252) with the files they import. Karthik's
ruling on 2026-10-20 is that features move between Amber and Chewbacca freely.
Em dashes became commas, per the kit's house rule; nothing else changed, and
their own tests run here with `node --test`.

| Module | What it answers |
| --- | --- |
| `people-rank-realness.js` | Is this contact a person, or a shortcode, OTP sender, no-reply bot or bare number? |
| `name-nicknames.js` | Are "Nate" and "Nathan" the same first name? A closed table, never edit distance. |
| `contact-duplicates.js` | Which rows are the same person, from shared email, phone or employer evidence, never a name alone? |
| `source-trust.js` | May this source overwrite that field? Something typed by hand outranks a vendor guess. |
| `transcript-filler.js` | Strip what Whisper invents from silence ("Thank you for watching", subtitle credits). |
| `person-mentions.js` | Which known contacts does this free text mention? |

They're ES modules (this folder's package.json says so). From CommonJS:
`const { filterRealContacts } = await import("../people-amber/people-rank-realness.js")`.
From Python, `bin/lib/people-amber/cli.mjs` reads JSON on stdin.
