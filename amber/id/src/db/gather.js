/**
 * ONE RETRIEVAL LADDER, RUN FOR EVERY QUESTION, LAYERED BY HOW GOOD THE EVIDENCE IS.
 *
 * "There has to be a retrieval mechanism that works well, not just a router."
 *
 * THE DEFECT THIS REPLACES. Amber had four lanes -- chat, network_query, both,
 * overview -- and each loaded a DIFFERENT FIXED SLICE of the database. Which
 * slice a question got was decided by how it was PHRASED, matched against
 * regexes somebody wrote by hand. So:
 *
 *   "who do I know at USC"          -> matched KNOWS_THEM -> read observations
 *   "who goes to USC"               -> matched nothing    -> read nothing
 *   "what do you know about Sagar"  -> matched nothing    -> read nothing
 *
 * The author of those regexes had thousands of observations, so every lane
 * returned something for him and the design looked fine. A new user has data in
 * exactly one place -- their synced contact rows -- and most lanes never looked
 * there. Same code, same deploy, and the app was a product for one person and a
 * shrug for everybody else. "How many people do I know?" answered "I don't have
 * any information" against 1,231 contacts.
 *
 * So this does not route. It SEARCHES, unconditionally, in one pass:
 *
 *   1. STATED   what the user said, to Amber or into their phone. Observations,
 *               facts, experiences, notes -- and equally the notes, birthdays,
 *               nicknames, job titles and cities that came in with an Apple or
 *               Google sync. A note the user typed into their own address book
 *               is the same class of evidence as one they spoke to Amber; it is
 *               theirs, about a real person, and it was being ignored.
 *
 *   2. LABELED  the tags a person typed into a contact NAME -- "USC", "BTG",
 *               "Plumber". Self-reported, so nearly as good as a note, and for
 *               most address books it is the ONLY structured thing present.
 *
 *   3. IMPLIED  what a phone number's area code suggests. The floor. Never
 *               presented as fact, never allowed to outrank a stated city, and
 *               genuinely useful when it is all there is -- a mobile number that
 *               never moved still says something about where somebody is from.
 *
 * LAYERS ARE NOT EXCLUSIVE, and that is the part a fallback chain gets wrong:
 *
 *   "Only one person fits that perfectly according to your notes, but these
 *    people have area codes that might be appropriate as well. Would you want to
 *    reach out to any of them?"
 *
 * Every layer that found something is returned, each labeled with what it is, so
 * the answer can lead with the strong evidence and offer the weak evidence as
 * weak. A chain that stopped at layer 1 would have hidden the ten people worth
 * texting behind the one person who matched.
 *
 * AND THE INVENTORY IS PART OF THE RESULT. `inventory` says what was searched
 * and what each layer returned, INCLUDING ZEROS. That is what turns "I don't
 * have any information" into "I went through your notes, your contact fields and
 * your area codes; here is what I found and here is what would help." An answer
 * path that cannot say what it looked at can only shrug.
 *
 * WHAT THIS IS NOT. There is no vocabulary table here and no phrase matching.
 * Terms come from the question's own words; every layer is a database query over
 * indexed columns; and the model decides what is relevant from what it is given
 * rather than being handed a slice chosen by a regex. Nothing about it works
 * better for an account with ten years of history than for one that synced its
 * contacts a minute ago -- it returns more, because there is more, which is the
 * only difference there should ever be.
 */

import { query } from "./sql.js";

/** Hard ceilings. This runs in front of the first token of every answer. */
const MAX_PER_LAYER = 25;
const MAX_TERMS = 12;

/**
 * The words in a question that could match stored data.
 *
 * NO SYNONYM TABLE. An earlier version had one -- tech/finance/medicine/law,
 * hand-written -- and it is exactly the thing that makes an app work for the
 * person who wrote the table and nobody else. The question's own words, minus
 * the scaffolding every question shares, is a rule rather than a list: it works
 * for "podcasting" and "orthodontist" and "Kappa Sigma" without anybody
 * predicting them.
 *
 * The stopword set is grammar, not domain knowledge. It is the only thing here
 * that is written down, it is closed, and it is the same for every user.
 */
const STOPWORDS = new Set([
  "a", "about", "all", "am", "an", "and", "any", "anybody", "anyone", "anything",
  "are", "as", "at", "be", "been", "being", "but", "by", "can", "could", "d",
  "did", "do", "does", "each", "every", "find", "for", "from", "get", "give",
  "had", "has", "have", "he", "her", "here", "hers", "him", "his", "how", "i",
  "if", "in", "into", "is", "it", "its", "know", "knows", "list", "ll", "m",
  "me", "might", "mine", "my", "myself", "need", "of", "on", "one", "or", "our",
  "ours", "out", "over", "please", "re", "s", "said", "say", "see", "shall",
  "she", "should", "show", "so", "some", "someone", "something", "still", "t",
  "tell", "than", "that", "the", "their", "them", "then", "there", "these",
  "they", "thing", "this", "those", "to", "told", "too", "under", "us", "ve",
  "very", "want", "was", "we", "were", "what", "when", "where", "which", "who",
  "whom", "whose", "why", "will", "with", "would", "you", "your", "yours",
  // THE WORDS THAT NAME THE ADDRESS BOOK ITSELF ARE SCAFFOLDING TOO.
  //
  // Ten mock books were asked "who do I know in my contacts?" and "do you know
  // anything about any of my contacts?" and all ten came back with nothing and
  // an apology, while the shape sitting right beside the answer knew the exact
  // total, the top twelve labels and the top five metros.
  //
  // Two separate faults, one cause. Searching notes for the literal string
  // "contact" is nonsense -- it hits a note reading "contact him at work" and
  // misses the question entirely -- and leaving the term in made the question
  // look SPECIFIC, so the empty result read as "I searched and found nothing"
  // instead of "you asked about the book, and here is the book".
  //
  // In a question addressed to an address book, "contacts" is the same kind of
  // word as "know" and "tell", which have been in this list from the start. It
  // is grammar for this surface, not domain knowledge: the rule is still that
  // whatever is LEFT is searched literally, and no synonym is ever supplied.
  "contact", "contacts", "everybody", "everyone", "folk", "folks", "friend",
  "friends", "network", "people", "person",
  // Quantifiers, for the same reason. "How MANY people do I know" is a question
  // about the size of the book, and "many" is not a thing to look for.
  "count", "few", "lot", "lots", "many", "most", "much", "number", "total",
  // NEGATION AND RECENCY ARE GRAMMAR, NOT SEARCH TERMS.
  //
  // "who have I not talked to in a while that I should reconnect with" tokenized
  // to ["not","talked","talk","talke","while","reconnect"]. "not" and "while"
  // are function words with no content, and searching notes for them is the same
  // nonsense as searching for "contact": a note reading "said not to call after
  // 9" comes back as a match for a question about who has gone quiet.
  //
  // Worse than the noise is what it does to the SHAPE of the answer. Leaving
  // them in makes the question look specific, so an empty or saturated result
  // reads as "I searched and this is what I found" rather than "you asked me
  // something about time and I cannot see time". Amber has no last-contacted
  // signal; the honest failure is better than a keyword search wearing its
  // clothes.
  //
  // Only closed-class words go in. Nothing here could be a company, a title, a
  // city, a school or a thing somebody says about a person.
  "again", "ago", "also", "always", "another", "back", "because", "before",
  "after", "since", "until", "both", "either", "ever", "even", "just", "lately",
  "never", "no", "nor", "not", "only", "other", "others", "own", "perhaps",
  "pretty", "probably", "quite", "really", "recently", "same", "such", "while",
  "yet",
]);

/**
 * Mechanical English suffix removal. Grammar, closed, identical for every user.
 *
 * Deliberately conservative on length so short words are never mangled: "sales"
 * must not become "sale", and "is"/"in" never reach here at all.
 */
function stemsOf(w) {
  const out = [];
  const add = (x) => {
    if (x && x.length >= 4 && x !== w) out.push(x);
  };
  if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) add(w.slice(0, -1));
  if (w.length > 6 && w.endsWith("ing")) {
    add(w.slice(0, -3));
    add(w.slice(0, -3) + "e"); // consulting -> consult, coding -> code
  }
  if (w.length > 5 && w.endsWith("ed")) {
    add(w.slice(0, -2));
    add(w.slice(0, -1)); // graduated -> graduate
  }
  if (w.length > 6 && w.endsWith("ers")) add(w.slice(0, -3));
  else if (w.length > 5 && w.endsWith("er")) add(w.slice(0, -2));
  return out;
}

export function termsFrom(message) {
  const words = String(message || "")
    .toLowerCase()
    // LETTERS IN EVERY SCRIPT, NOT JUST a-z.
    //
    // This was `[^a-z0-9'’\s-]`, which deleted every character outside ASCII
    // and did it silently, mid-word. The results, measured:
    //
    //   "wer kennt Müller-Lüdenscheidt" -> ["wer","kennt","ller","denscheidt"]
    //   "Şahin Öztürk"                  -> ["ahin","zt","rk"]
    //   "who do I know 🇯🇵 in 東京"       -> []
    //   "من أعرف في نيويورك"             -> []
    //
    // So a contact named Müller was unfindable by name, a Turkish or Icelandic
    // or Vietnamese name was shredded into fragments that match nothing, and a
    // question in Japanese or Arabic produced NO terms at all -- which then read
    // as "they asked about their whole book" and got answered with a summary of
    // it. An app that is meant to work for everyone cannot only tokenize the
    // Latin alphabet.
    //
    // \p{L}\p{N} with the u flag keeps letters and digits in every script and
    // still drops every regex metacharacter -- ( ) [ ] * + . | \ ^ $ ? { } are
    // none of them -- so the alternation built for `~*` below stays safe. The
    // only punctuation kept is the apostrophe and the hyphen, and a hyphen is
    // literal inside an alternation.
    .replace(/[^\p{L}\p{N}'’\s-]+/gu, " ")
    .split(/[\s-]+/)
    .map((w) => w.replace(/['’]s$/, "").trim())
    // LENGTH 1 IS ALLOWED NOW, and only because short terms match as whole
    // words (see regexTerm). "C++" tokenizes to "c" and a book full of C++
    // engineers was unreachable while this said `>= 2`. Pure digits and
    // grammar words are still dropped.
    .filter((w) => w.length >= 1 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  const out = [];
  const seen = new Set();
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    // ENGLISH SUFFIXES COME OFF MECHANICALLY, AND THE STEM IS ADDED, NOT
    // SUBSTITUTED.
    //
    // A card says "lawyer" and a question says "lawyers". A card says "Podcast
    // Producer" and a question says "podcasting" -- that one came back empty
    // against a mock book with 1,098 job titles in it, including podcast
    // producers, purely because of four letters.
    //
    // This is suffix arithmetic, not a word list: the same four rules apply to
    // "orthodontists" and "welding" and any word nobody has thought of, which
    // is the entire difference between this and the synonym table it replaced.
    // Every stem is an EXTRA term, never a replacement, and the layers match on
    // substring -- so a stem that is not really a word ("goe", "podcast") costs
    // one term that matches nothing rather than losing the original.
    for (const stem of stemsOf(w)) {
      if (seen.has(stem)) continue;
      seen.add(stem);
      out.push(stem);
    }
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

const rowsOf = (res) => res?.rows ?? [];

/** Never let one slow or broken layer cost the whole answer. */
async function safely(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`GATHER_LAYER_FAILED ${label} ${(err?.message || err).toString().slice(0, 160)}`);
    return null;
  }
}

/**
 * LAYER 1a — what the user has said about people, to Amber or into their phone.
 *
 * Both sources in one query on purpose. An observation the user spoke and a note
 * they typed into Apple Contacts are the same kind of evidence about the same
 * kind of person, and treating the synced one as second class is the bug: "his
 * Apple contacts have detailed information about the 200 people he knows in New
 * York, and Amber won't be able to retrieve that at all."
 */
/**
 * One term, made safe for the operator that actually runs it.
 *
 * THE OLD ESCAPING WAS FOR THE WRONG OPERATOR. It was
 * `t.replace(/[%_\\]/g, "\\$&")` -- escaping `%` and `_`, which are LIKE
 * wildcards -- while the query below matches with `~*`, a regular expression.
 * So it escaped two characters that mean nothing to a regex and left every
 * character that does: . * + ? ^ $ { } ( ) | [ ] and the backslash.
 *
 * Nothing was exploitable, but only by luck at a distance: termsFrom strips
 * every one of those characters, so none ever reached here. The safety of this
 * query lived in a different function, was written down nowhere, and would have
 * turned into a live regex-injection the moment anybody widened the tokenizer --
 * which is exactly what the next paragraph does.
 *
 * WORD BOUNDARIES FOR SHORT TERMS. A one or two character term is useless as a
 * substring: "c" appears inside "contact", "practice" and half of every note.
 * As a whole word it is precisely right, and it is the only way a question about
 * C++, C#, R or Go can find anything -- termsFrom reduces "C++" to "c", and
 * before this every one of 150 mock books answered "who do I know at C++" with
 * "Nothing in your contacts answers that yet" while holding contacts whose
 * company was literally "C++ Systems". `\y` is Postgres's word boundary.
 */
function regexTerm(t) {
  const safe = String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return t.length <= 2 ? `\\y${safe}\\y` : safe;
}

/**
 * A term that must match a WHOLE WORD, whatever its length. Used where the
 * column is a short controlled string -- a metro name -- and a substring hit is
 * always a coincidence rather than a match.
 */
function wordTerm(t) {
  return `\\y${String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\y`;
}

async function statedLayer(ownerId, terms) {
  if (terms.length === 0) return [];
  const pattern = terms.map(regexTerm).join("|");
  const res = await query(
    `WITH hits AS (
       SELECT c.id,
              c.full_name,
              c.company,
              c.title,
              c.city,
              o.body        AS matched_text,
              'note'        AS matched_in,
              o.observed_at AS at
         FROM observations o
         JOIN contacts c ON c.id = o.contact_id AND c.owner_id = o.owner_id
        WHERE o.owner_id = $1
          AND o.deleted_at IS NULL
          AND o.status = 'resolved'
          AND c.deleted_at IS NULL
          AND o.body ~* $2
       UNION ALL
       SELECT c.id, c.full_name, c.company, c.title, c.city,
              c.apple_notes, 'synced note', c.updated_at
         FROM contacts c
        WHERE c.owner_id = $1 AND c.deleted_at IS NULL
          AND c.apple_notes IS NOT NULL AND c.apple_notes ~* $2
       UNION ALL
       SELECT c.id, c.full_name, c.company, c.title, c.city,
              COALESCE(c.company, '') || ' ' || COALESCE(c.title, '') || ' ' ||
              COALESCE(c.department, ''), 'job', c.updated_at
         FROM contacts c
        WHERE c.owner_id = $1 AND c.deleted_at IS NULL
          AND (c.company ~* $2 OR c.title ~* $2 OR c.department ~* $2)
       UNION ALL
       SELECT c.id, c.full_name, c.company, c.title, c.city,
              COALESCE(c.city, '') || ' ' || COALESCE(c.region, ''), 'stated location', c.updated_at
         FROM contacts c
        WHERE c.owner_id = $1 AND c.deleted_at IS NULL
          AND (c.city ~* $2 OR c.region ~* $2)
     )
     SELECT id, full_name, company, title, city,
            max(at)                              AS at,
            array_agg(DISTINCT matched_in)       AS matched_in,
            (array_agg(matched_text ORDER BY at DESC))[1:3] AS excerpts,
            count(*)::int                        AS hits,
            -- HOW MANY MATCHED, NOT HOW MANY FIT.
            --
            -- Every layer is capped at MAX_PER_LAYER, and without this the
            -- caller cannot tell "25 people" from "25 of 34 people". It said
            -- "25" either way, which for a question like "who do I know that
            -- goes to USC" is a wrong number stated confidently -- the exact
            -- failure mode the inventory exists to prevent. A window function
            -- over the grouped rows counts the groups before the LIMIT trims
            -- them, so it costs nothing extra.
            count(*) OVER ()::int                AS match_total
       FROM hits
      GROUP BY id, full_name, company, title, city
      ORDER BY hits DESC, at DESC NULLS LAST
      LIMIT ${MAX_PER_LAYER}`,
    [ownerId, `(${pattern})`],
  );
  return rowsOf(res).map((r) => ({
    contactId: String(r.id),
    matchTotal: Number(r.match_total ?? 0),
    name: r.full_name,
    company: r.company ?? null,
    title: r.title ?? null,
    city: r.city ?? null,
    where: (r.matched_in || []).join(", "),
    excerpts: (r.excerpts || []).filter(Boolean).map((t) => String(t).slice(0, 220)),
  }));
}

/**
 * LAYER 2 — the labels a person typed into contact names.
 *
 * "There are maybe 30 contacts that have the tag USC in their name. It might not
 *  be in their school field, they just add it to their name field like everyone
 *  does with Apple contacts. If Caleb asks about that it should say 30 contacts
 *  have the USC tag."
 *
 * contact_tags is written by retagAddressBook, which can tell "USC" on thirty
 * cards from "Park" on three by comparing each card against the whole book. The
 * match here is on whole tags, so a question about tech never matches a person
 * called Techachapi.
 */
/**
 * THE PERSON'S OWN NAME.
 *
 * THIS LAYER WAS MISSING, and its absence is the plainest possible failure: ask
 * "what do you know about Tobias Lindqvist" and the ladder returned NOTHING,
 * for a contact sitting in the book with a company, a title and a city on it.
 *
 * Every other layer searches something ABOUT a person -- what was said, the
 * labels typed into the name field, the job columns, the area code -- and none
 * of them searches the name. The only path that did was the structured `search`
 * intent, so the answer depended entirely on the router classifying the question
 * as a search. Measured: "what do you know about Tobias Lindqvist and about
 * Fleet 22" classified as `chat`, found nobody, and told the user their own
 * contact did not exist while offering to look him up on the web.
 *
 * That is the same shape as the bug where gatherEverything sat inside the chat
 * branch and network questions never got it -- one branch over, and worse,
 * because a name is the most specific thing a user can give.
 *
 * FIRST AMONG THE LAYERS. A name match is the strongest evidence there is: if
 * somebody types a name that is in the book, they mean that person, and nothing
 * inferred from an area code should be listed above them.
 *
 * Matched against the stored name AND the split parts, so "Lindqvist" finds him
 * by surname and "Tobias" by first name. regexTerm word-bounds anything short,
 * so a two-letter term cannot match every name containing those letters.
 */
async function namedLayer(ownerId, terms) {
  if (terms.length === 0) return [];
  const patterns = terms.map(wordTerm);
  const pattern = patterns.join("|");
  const res = await query(
    `SELECT id, full_name, first_name, last_name, nickname, company, title, city,
            contact_tags,
            -- HOW MANY OF THE WORDS THEY TYPED THIS NAME ACTUALLY MATCHES.
            --
            -- This is the whole ranking and it has to come first. "Tobias
            -- Lindqvist" is two words; the Tobias Lindqvist in the book matches
            -- both and the eighteen other Lindqvists match one. Ordering by how
            -- complete a card is instead put DARA Lindqvist at the top of a
            -- question about Tobias -- a confident answer about the wrong
            -- person, which is worse than no answer.
            (SELECT count(*) FROM unnest($3::text[]) AS t
              WHERE full_name ~* t OR first_name ~* t OR last_name ~* t OR nickname ~* t
            )::int AS terms_hit,
            count(*) OVER ()::int AS match_total
       FROM contacts
      WHERE owner_id = $1 AND deleted_at IS NULL
        AND (full_name ~* $2 OR first_name ~* $2 OR last_name ~* $2 OR nickname ~* $2)
      ORDER BY
        terms_hit DESC,
        -- Then the card with more on it. Two people really do share a full name,
        -- and the one meant is nearly always the one with a job or a note rather
        -- than the row imported from a SIM card and never touched.
        (
          (company IS NOT NULL)::int + (title IS NOT NULL)::int +
          (city IS NOT NULL)::int + (apple_notes IS NOT NULL)::int
        ) DESC,
        length(full_name) ASC, full_name ASC
      LIMIT ${MAX_PER_LAYER}`,
    [ownerId, `(${pattern})`, patterns],
  );
  return rowsOf(res).map((r) => ({
    contactId: String(r.id),
    matchTotal: Number(r.match_total ?? 0),
    termsHit: Number(r.terms_hit ?? 0),
    name: r.full_name,
    nickname: r.nickname ?? null,
    tags: r.contact_tags ?? [],
    company: r.company ?? null,
    title: r.title ?? null,
    city: r.city ?? null,
  }));
}

async function labeledLayer(ownerId, terms) {
  if (terms.length === 0) return [];
  const res = await query(
    `SELECT id, full_name, contact_tags, company, title, city,
            -- WHY THIS IS NOT AN INTERSECT.
            --
            -- It was, and it came back EMPTY on every single row. contact_tags
            -- holds the label exactly as the user typed it -- "USC" -- and the
            -- terms are lowercased by termsFrom, so INTERSECT compared 'USC'
            -- against 'usc' and matched nothing. The WHERE clause below was
            -- right (it folds case with lower(t)), so the correct people came
            -- back; only the REASON was blank. renderGathered then printed
            -- "[tagged ]" for each one and told the model to "say how many and
            -- name them" with nothing to name them by.
            --
            -- Folding case here too, and returning the tag AS TYPED, because
            -- "USC" is what the user wrote and what they should see back.
            ARRAY(
              SELECT t FROM unnest(contact_tags) AS t
               WHERE lower(t) = ANY($2::text[])
            ) AS matched,
            count(*) OVER ()::int AS match_total
       FROM contacts
      WHERE owner_id = $1 AND deleted_at IS NULL
        AND contact_tags IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM unnest(contact_tags) t
           WHERE lower(t) = ANY($2::text[])
        )
      ORDER BY full_name
      LIMIT ${MAX_PER_LAYER}`,
    [ownerId, terms],
  );
  return rowsOf(res).map((r) => ({
    contactId: String(r.id),
    matchTotal: Number(r.match_total ?? 0),
    name: r.full_name,
    tags: r.contact_tags ?? [],
    matched: r.matched ?? [],
    company: r.company ?? null,
    title: r.title ?? null,
    city: r.city ?? null,
  }));
}

/**
 * LAYER 3 — what a phone number implies. The floor, and labeled as such.
 *
 * "Area code should be the very bottom ranking for understanding a person's
 *  location, but it should still be a factor. If there's nothing else, like no
 *  notes, then that should be something that comes up."
 *
 * Only consulted when the question's terms actually name a place this can speak
 * to, and only for contacts with NO stated city -- a person who says where they
 * live has already answered the question, and offering an inference about them
 * alongside a fact would be noise.
 */
/**
 * WHAT THE USER SAID ABOUT SOMEBODY WHO HAS NO CARD.
 *
 * A fact about a name that matched no contact is filed with contact_id NULL and
 * the spoken name in raw_name, waiting for a tap. Every other layer here joins
 * contacts, so those rows were invisible to retrieval on every path.
 *
 * The result was the app contradicting the user about something they had just
 * told it. "I met Wren Halloway, partner at Northlight Capital" and, two turns
 * later, "Nobody in your contacts goes by Wren Halloway, so there is nothing on
 * file to share." It also caught the case where the person DOES have a card but
 * the fact was filed under a bare first name -- "Priya, the LA one not the
 * Flatiron one, is pregnant" parked under "Priya", and "is Priya Sundaram
 * pregnant" answered "that's not something I have any information on."
 *
 * These are not people, they are sentences: no contactId, so nothing here can
 * reach the people cards or be counted as a match. The renderer presents them as
 * what they are -- something the user said that is not filed to anyone yet.
 */
async function unfiledLayer(ownerId, terms) {
  if (terms.length === 0) return [];
  const pattern = terms.map(regexTerm).join("|");
  const res = await query(
    `SELECT o.observation_id AS id, o.body, o.raw_name, o.observed_at AS at
       FROM observations o
      WHERE o.owner_id = $1
        AND o.deleted_at IS NULL
        AND o.contact_id IS NULL
        AND o.raw_name IS NOT NULL
        AND (o.raw_name ~* $2 OR o.body ~* $2)
      ORDER BY o.observed_at DESC
      LIMIT 8`,
    [ownerId, `(${pattern})`],
  );
  return res.rows.map((r) => ({
    id: String(r.id),
    rawName: String(r.raw_name || ""),
    text: String(r.body || ""),
    at: r.at,
  }));
}

async function impliedLayer(ownerId, terms) {
  if (terms.length === 0) return [];
  const res = await query(
    `SELECT id, full_name, area_code, area_metro, company, title,
            count(*) OVER ()::int AS match_total
       FROM contacts
      WHERE owner_id = $1 AND deleted_at IS NULL
        AND area_metro IS NOT NULL
        AND city IS NULL
        -- A METRO IS MATCHED ON WHOLE WORDS, NOT ON SUBSTRINGS.
        --
        -- This used a LIKE with the term wrapped in percent signs, and the
        -- moment one-character terms became searchable it started answering
        -- "anyone who writes Go or R" with everybody in Chi-GO. "york" inside
        -- "New York" is the match that matters; "go" inside "Chicago" is not a
        -- match at all, it is a coincidence of spelling.
        --
        -- $2 is the term list joined into a word-boundary alternation by
        -- wordTerm, so this layer and the strong layer agree about what a term
        -- means. LIKE cannot express a word boundary; a regex can.
        --
        -- (No backticks in this comment. That is not a style note: a backtick
        -- here closes the template literal, and it has now happened three times
        -- in one day -- see src/db/sql-template-integrity.test.js.)
        AND area_metro ~* $2
      ORDER BY full_name
      LIMIT ${MAX_PER_LAYER}`,
    [ownerId, `(${terms.map(wordTerm).join("|")})`],
  );
  return rowsOf(res).map((r) => ({
    contactId: String(r.id),
    matchTotal: Number(r.match_total ?? 0),
    name: r.full_name,
    areaCode: r.area_code,
    metro: r.area_metro,
    company: r.company ?? null,
    title: r.title ?? null,
  }));
}

/**
 * ALWAYS COMPUTED, whatever the question.
 *
 * The shape of the book: how many contacts, how many carry a note, which labels
 * the user actually uses, where their numbers are from. This is what makes "how
 * many people do I know" and "tell me about my contacts" answerable at all, and
 * it is what a thin answer leads with instead of shrugging.
 */
async function bookShape(ownerId) {
  const res = await query(
    `SELECT
       count(*)::int                                                        AS total,
       count(*) FILTER (WHERE phone_primary IS NOT NULL)::int               AS with_phone,
       count(*) FILTER (WHERE emails IS NOT NULL AND emails <> '')::int     AS with_email,
       count(*) FILTER (WHERE company IS NOT NULL AND company <> '')::int   AS with_company,
       count(*) FILTER (WHERE apple_notes IS NOT NULL AND apple_notes <> '')::int AS with_synced_note,
       count(*) FILTER (WHERE birthday IS NOT NULL)::int                    AS with_birthday,
       count(*) FILTER (WHERE contact_tags IS NOT NULL
                          AND array_length(contact_tags, 1) > 0)::int       AS with_tags
       FROM contacts
      WHERE owner_id = $1 AND deleted_at IS NULL`,
    [ownerId],
  );
  const counts = rowsOf(res)[0] ?? {};

  const [tags, metros, titles, companies, noted] = await Promise.all([
    query(
      `SELECT lower(t) AS tag, count(*)::int AS n, (array_agg(full_name))[1:4] AS examples
         FROM contacts, unnest(contact_tags) t
        WHERE owner_id = $1 AND deleted_at IS NULL
        GROUP BY lower(t)
       HAVING count(*) > 1
        ORDER BY n DESC
        LIMIT 12`,
      [ownerId],
    ).then(rowsOf).catch(() => []),
    query(
      `SELECT area_metro AS metro, count(*)::int AS n
         FROM contacts
        WHERE owner_id = $1 AND deleted_at IS NULL AND area_metro IS NOT NULL
        GROUP BY area_metro ORDER BY n DESC LIMIT 8`,
      [ownerId],
    ).then(rowsOf).catch(() => []),
    // WHAT THESE PEOPLE DO, AND WHERE THEY WORK.
    //
    // "Do I know any lawyers?" came back empty against a mock book holding
    // 1,098 job titles, fourteen of which said "Attorney". Literal matching is
    // correct -- a synonym table is the thing that only works for whoever wrote
    // it -- but coming back with NOTHING when the answer is one word away is
    // not. So the shape now reports the professions and the employers the book
    // actually contains, and a question that matched no title can be answered
    // with the user's own data instead of an apology: nothing here says
    // "lawyer", and you have 14 Attorneys and 9 Nurse Practitioners.
    //
    // Derived entirely from what the user synced. No list, no mapping, and the
    // same query for a book of twelve as for a book of four thousand.
    query(
      `SELECT initcap(lower(title)) AS title, count(*)::int AS n
         FROM contacts
        WHERE owner_id = $1 AND deleted_at IS NULL AND title IS NOT NULL AND title <> ''
        GROUP BY initcap(lower(title)) ORDER BY n DESC, title LIMIT 12`,
      [ownerId],
    ).then(rowsOf).catch(() => []),
    query(
      `SELECT initcap(lower(company)) AS company, count(*)::int AS n
         FROM contacts
        WHERE owner_id = $1 AND deleted_at IS NULL AND company IS NOT NULL AND company <> ''
        GROUP BY initcap(lower(company)) ORDER BY n DESC, company LIMIT 12`,
      [ownerId],
    ).then(rowsOf).catch(() => []),
    query(
      `SELECT count(DISTINCT contact_id)::int AS n
         FROM observations
        WHERE owner_id = $1 AND deleted_at IS NULL
          AND status = 'resolved' AND contact_id IS NOT NULL`,
      [ownerId],
    ).then((r) => rowsOf(r)[0]?.n ?? 0).catch(() => 0),
  ]);

  const total = Number(counts.total ?? 0);
  return {
    total,
    withPhone: Number(counts.with_phone ?? 0),
    withEmail: Number(counts.with_email ?? 0),
    withCompany: Number(counts.with_company ?? 0),
    withSyncedNote: Number(counts.with_synced_note ?? 0),
    withBirthday: Number(counts.with_birthday ?? 0),
    withTags: Number(counts.with_tags ?? 0),
    withAmberNote: Number(noted ?? 0),
    tags: tags.map((t) => ({ tag: t.tag, count: t.n, examples: (t.examples || []).filter(Boolean) })),
    metros: metros.map((m) => ({ metro: m.metro, count: m.n })),
    titles: titles.map((t) => ({ title: t.title, count: t.n })),
    companies: companies.map((c) => ({ company: c.company, count: c.n })),
  };
}

/**
 * Birthdays landing in the next `days` days, by anniversary.
 *
 * Here because "whose birthday is it today" was answered with "I don't know, you
 * didn't tell me" by an app holding the birthday of everyone in the address
 * book. Indexed on (owner, month, day) -- the year the person was born must not
 * be part of the key or every lookup is a full scan.
 */
export async function upcomingBirthdays(ownerId, { days = 0 } = {}) {
  const res = await query(
    // EVERY DATE HERE IS READ IN UTC, ON BOTH SIDES OF THE COMPARISON.
    //
    // `birthday` is a timestamptz, and EXTRACT on a timestamptz reads whatever
    // TimeZone the session carries. That makes the anniversary a property of the
    // CONNECTION rather than of the person: the same row answers "March 15" on a
    // UTC session and "March 14" on a US one. It also makes the expression
    // STABLE rather than IMMUTABLE, which is why the matching index in migration
    // 041 could not be created at all until both sides pinned a zone.
    //
    // So: `AT TIME ZONE 'UTC'` on the stored birthday, and `now() AT TIME ZONE
    // 'UTC'` on today. Same zone, always, for every user and every deploy. If
    // this literal ever changes, contacts_owner_birthday_md has to change with
    // it or the index stops being used and this becomes a full table scan.
    `SELECT id, full_name, birthday,
            EXTRACT(MONTH FROM (birthday AT TIME ZONE 'UTC'))::int AS month,
            EXTRACT(DAY   FROM (birthday AT TIME ZONE 'UTC'))::int AS day
       FROM contacts
      WHERE owner_id = $1 AND deleted_at IS NULL AND birthday IS NOT NULL
        AND (
          (EXTRACT(MONTH FROM (birthday AT TIME ZONE 'UTC'))::int,
           EXTRACT(DAY   FROM (birthday AT TIME ZONE 'UTC'))::int)
            IN (
              SELECT EXTRACT(MONTH FROM d)::int, EXTRACT(DAY FROM d)::int
                FROM generate_series(
                  date_trunc('day', now() AT TIME ZONE 'UTC'),
                  date_trunc('day', now() AT TIME ZONE 'UTC')
                    + make_interval(days => $2::int),
                  '1 day'
                ) AS d
            )
        )
      ORDER BY EXTRACT(MONTH FROM (birthday AT TIME ZONE 'UTC')),
               EXTRACT(DAY   FROM (birthday AT TIME ZONE 'UTC')), full_name
      LIMIT 50`,
    [ownerId, Math.max(0, Math.min(Number(days) || 0, 60))],
  );
  return rowsOf(res).map((r) => ({
    contactId: String(r.id),
    name: r.full_name,
    month: r.month,
    day: r.day,
  }));
}

/** Does this question ask about a date rather than a topic? */
const ASKS_BIRTHDAY = /\bbirthday|birthdays|born\b/i;
const ASKS_SOON = /\b(this week|next week|coming up|upcoming|soon|month)\b/i;

/**
 * THE LADDER. One call, every layer, for any question.
 *
 * Returns `{ terms, layers, shape, birthdays, inventory }`. Nothing here decides
 * what the answer should say -- it decides what is TRUE and hands all of it over,
 * labeled. The caller renders it.
 */
export async function gatherEverything(ownerId, message, { deps = {} } = {}) {
  const empty = {
    terms: [],
    layers: { stated: [], labeled: [], implied: [] },
    totals: { stated: 0, labeled: 0, implied: 0 },
    aboutTheBook: false,
    shape: null,
    birthdays: null,
    inventory: { searched: [], found: {} },
  };
  if (!ownerId) return empty;

  const terms = termsFrom(message);
  const wantsBirthdays = ASKS_BIRTHDAY.test(String(message || ""));

  const [named, stated, labeled, implied, shape, birthdays, unfiled] = await Promise.all([
    safely("named", () => (deps.namedLayer ?? namedLayer)(ownerId, terms)),
    safely("stated", () => (deps.statedLayer ?? statedLayer)(ownerId, terms)),
    safely("labeled", () => (deps.labeledLayer ?? labeledLayer)(ownerId, terms)),
    safely("implied", () => (deps.impliedLayer ?? impliedLayer)(ownerId, terms)),
    safely("shape", () => (deps.bookShape ?? bookShape)(ownerId)),
    wantsBirthdays
      ? safely("birthdays", () =>
          (deps.upcomingBirthdays ?? upcomingBirthdays)(ownerId, {
            days: ASKS_SOON.test(String(message || "")) ? 30 : 0,
          }),
        )
      : Promise.resolve(null),
    safely("unfiled", () => (deps.unfiledLayer ?? unfiledLayer)(ownerId, terms)),
  ]);

  const layers = {
    // The people the question NAMED. First, because a name is the most specific
    // thing a user can give and nothing inferred should outrank it.
    named: named ?? [],
    stated: stated ?? [],
    labeled: labeled ?? [],
    implied: implied ?? [],
    // Things the user said about somebody who could not be matched to a card.
    // Not a "layer" of people -- these have no contact -- but they belong in
    // the same block, because to the user they are simply things they said.
    unfiled: unfiled ?? [],
  };

  // A CONTACT NAMED BY THE STRONGEST LAYER IS NOT REPEATED BY A WEAKER ONE.
  // Somebody whose note says they live in New York must not also appear as "has
  // a New York area code" -- the fact already covers it, and listing them twice
  // reads as the app losing count of them.
  const claimed = new Set(layers.named.map((r) => r.contactId));
  layers.stated = layers.stated.filter((r) => !claimed.has(r.contactId));
  for (const r of layers.stated) claimed.add(r.contactId);
  layers.labeled = layers.labeled.filter((r) => !claimed.has(r.contactId));
  for (const r of layers.labeled) claimed.add(r.contactId);
  layers.implied = layers.implied.filter((r) => !claimed.has(r.contactId));

  // HOW MANY MATCHED, BESIDE HOW MANY ARE LISTED.
  //
  // Each layer is capped at MAX_PER_LAYER. Reporting only the capped length
  // makes the answer state a wrong number confidently -- "25 people went to
  // USC" when 34 did -- and a wrong count is worse than a short list, because
  // the user cannot see that it was trimmed. `matched` is what the query found,
  // `listed` is what came back, and a renderer that has both can say "34
  // people, here are 25 of them".
  const totalOf = (rows) => (rows.length > 0 ? Math.max(rows[0]?.matchTotal ?? 0, rows.length) : 0);
  const totals = {
    named: totalOf(layers.named),
    stated: totalOf(layers.stated),
    labeled: totalOf(layers.labeled),
    implied: totalOf(layers.implied),
  };

  /**
   * THE QUESTION WAS ABOUT THE BOOK, NOT ABOUT ANYONE IN IT.
   *
   * "How many people do I know?" / "Do you know anything about any of my
   * contacts?" -- ten mock books, all ten answered "I don't have any
   * information", every one of them while holding a shape that knew the exact
   * total, the top twelve labels, the top metros and the top job titles.
   *
   * With the scaffolding removed these questions leave NO terms behind, and no
   * terms means there was nothing specific to look for. An empty result is then
   * not a failed search, it is the wrong question to ask of the layers -- the
   * shape is the answer, and `thin` must not fire, because `thin` is what makes
   * the reply apologize and offer a web search for something the user never
   * asked about.
   *
   * "It should say, 'I know that you have this many contacts... I know 10 of
   *  your contacts have the tag USC on them. I know 50 of them have the area
   *  code for LA.'"
   */
  const aboutTheBook = terms.length === 0 && (shape?.total ?? 0) > 0;

  return {
    terms,
    layers,
    totals,
    aboutTheBook,
    shape,
    birthdays,
    /**
     * WHAT WAS LOOKED AT, INCLUDING THE ZEROS.
     *
     * The reason "I don't have any information" was ever an acceptable answer is
     * that no answer path could say what it had searched. With this it has to
     * be specific: went through your notes and your synced notes (0), your
     * contact tags (0 of 14 labels matched), your area codes (10 in the New York
     * metro). Failure becomes informative, and the user learns what to add.
     */
    inventory: {
      searched: [
        "the names on your contacts",
        "notes and facts you have saved",
        "notes, companies, titles and cities that came in with your synced contacts",
        "labels written into contact names",
        "area codes",
        ...(wantsBirthdays ? ["birthdays from your synced contacts"] : []),
      ],
      found: {
        named: layers.named.length,
        namedMatched: totals.named,
        stated: layers.stated.length,
        labeled: layers.labeled.length,
        implied: layers.implied.length,
        // What the queries matched, before the per-layer cap trimmed them.
        statedMatched: totals.stated,
        labeledMatched: totals.labeled,
        impliedMatched: totals.implied,
        birthdays: birthdays ? birthdays.length : null,
        totalContacts: shape?.total ?? 0,
        contactsWithAnyNote: (shape?.withAmberNote ?? 0) + (shape?.withSyncedNote ?? 0),
      },
      // THIN MEANS "I LOOKED FOR SOMETHING SPECIFIC AND DID NOT FIND IT".
      // It is not "the result is empty": a question about the book asks for
      // nothing specific, so an empty layer set there is expected and the shape
      // answers it in full. Firing thin on those turned five real questions per
      // book into an apology.
      // A NAME MATCH IS NEVER THIN. Someone asking about a person by name, when
      // that person is in the book, has been answered -- reporting it as thin
      // sends the reply into the "I searched and found nothing" copy while the
      // person's own card sits in the block above it.
      thin:
        !aboutTheBook &&
        layers.named.length === 0 &&
        layers.stated.length === 0 &&
        layers.labeled.length === 0 &&
        (!birthdays || birthdays.length === 0),
    },
  };
}
