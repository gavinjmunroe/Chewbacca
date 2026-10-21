/**
 * REACTING AND COMMENTING, AND THE ONE THING THAT MUST NOT BE WRONG.
 *
 * A post id is a small integer. Anybody can type the next one. So the question
 * every function here has to answer first is "may this person see this post at
 * all", and it has to answer it against the connection graph rather than trust
 * that the post arrived in a feed the caller already ran. The tests below spend
 * most of their time on that, because the rest is arithmetic.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMENT_MAX,
  addPostComment,
  deletePostComment,
  isReactionKind,
  listPostComments,
  commentAudioForPlayback,
  listPostReactors,
  markCommentAudioReady,
  REACTION_NOT_ACCEPTED,
  reactToPost,
  reserveCommentAudio,
  socialForPosts,
} from "./post-social.js";
import { __injectPoolForSmokeTests } from "./sql.js";
import { REACTION_KINDS } from "../lib/reaction-kinds.js";
import { readFileSync } from "node:fs";

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

/**
 * A pool that answers each statement by what it IS, so a test can say "the
 * visibility check fails" without also having to model a database.
 */
function pool({ visible = true, reactions = [], comments = [], onWrite = () => {} } = {}) {
  const seen = [];
  return {
    seen,
    query: async (text, params) => {
      seen.push({ text, params });
      if (/FROM wall_posts p/.test(text)) return { rows: visible ? [{ "?column?": 1 }] : [] };
      if (/INSERT INTO post_reactions|DELETE FROM post_reactions/.test(text)) {
        onWrite(text, params);
        return { rows: [], rowCount: 1 };
      }
      if (/FROM post_reactions/.test(text)) return { rows: reactions };
      if (/INSERT INTO post_comments/.test(text)) {
        onWrite(text, params);
        // ECHOES media_id, because the real RETURNING does. The first version of
        // this mock did not, so the branch that links the clip back to its
        // comment never ran and the test for it passed against nothing.
        // NULLIF('' ) is null in Postgres, so an empty transcript comes back null.
        return {
          rows: [
            {
              id: 7,
              text: params[2] === "" ? null : params[2],
              created_at: "2026-09-10T00:00:00Z",
              media_id: params[3] ?? null,
            },
          ],
        };
      }
      if (/UPDATE media_assets/.test(text)) {
        onWrite(text, params);
        return { rows: [], rowCount: 1 };
      }
      if (/FROM media_assets/.test(text)) {
        return { rows: [{ media_id: params?.[0], duration_ms: 2400, peaks: [4, 8] }] };
      }
      if (/UPDATE post_comments/.test(text)) {
        onWrite(text, params);
        return { rows: [], rowCount: 1 };
      }
      if (/FROM post_comments c/.test(text)) return { rows: comments };
      if (/FROM post_comments/.test(text)) return { rows: [] };
      if (/FROM users/.test(text)) return { rows: [{ amber_id: ME, username: "me", full_name: "Me", avatar_url: null }] };
      return { rows: [] };
    },
  };
}

// ── the gate ────────────────────────────────────────────────────────────────

test("A POST YOU CANNOT SEE CANNOT BE REACTED TO, COMMENTED ON, OR READ", async () => {
  for (const call of [
    () => reactToPost(ME, 42, "like"),
    () => listPostComments(ME, 42),
    () => addPostComment(ME, 42, "hello"),
  ]) {
    __injectPoolForSmokeTests(pool({ visible: false }));
    assert.equal(await call(), null, "a hidden post answered something other than null");
  }
});

test("the visibility check is the connection graph, not the feed query", async () => {
  const p = pool({});
  __injectPoolForSmokeTests(p);
  await reactToPost(ME, 42, "like");
  const gate = p.seen[0].text;
  assert.match(gate, /FROM wall_posts p/);
  assert.match(gate, /p\.deleted_at IS NULL/, "a deleted post is still reactable");
  assert.match(gate, /FROM connections c/, "visibility is not checked against the connection graph");
  assert.match(gate, /c\.status = 'active'/, "a pending or blocked connection counts as visibility");
  assert.match(gate, /p\.owner_id = \$2::uuid/, "you cannot react to your own post");
});

test("no write happens before the gate answers", async () => {
  const writes = [];
  __injectPoolForSmokeTests(pool({ visible: false, onWrite: (t) => writes.push(t) }));
  await reactToPost(ME, 42, "like");
  await addPostComment(ME, 42, "hello");
  assert.deepEqual(writes, [], "something was written for a post the caller cannot see");
});

// ── reactions ───────────────────────────────────────────────────────────────

test("ONE REACTION VOCABULARY, AND IT IS THE ONE THE DATABASE WILL ACCEPT", () => {
  // Read out of the migration rather than typed here, because a copy of a list
  // is what this test exists to prevent. Three tables carry this set in a CHECK
  // constraint and three stores used to carry it as a literal; if the app's
  // list and the constraint disagree, the symptom is a tap that fails with
  // "Couldn't save that reaction" and looks like a network problem.
  const sql = readFileSync(
    new URL("../../db/migrations/20260911_045_reactions_add_heart.sql", import.meta.url),
    "utf8",
  );
  // The migration declares the set once, as a pg array, and applies it to every
  // table in a loop -- so there is one list to read rather than three CHECK
  // clauses to compare against each other.
  const declared = /kinds\s+text\[\]\s*:=\s*ARRAY\[([^\]]+)\]/.exec(sql);
  assert.ok(declared, "the migration's `kinds` array could not be found");
  const fromSql = declared[1]
    .split(",")
    .map((x) => x.trim().replace(/'/g, ""))
    .filter(Boolean)
    .sort();
  assert.deepEqual([...REACTION_KINDS].sort(), fromSql, "the app and the database disagree");

  // And it must still be applied to every table that carries the vocabulary. A
  // list widened in one place and looped over zero tables is a migration that
  // passes this test and changes nothing.
  const tables = /tables\s+text\[\]\s*:=\s*ARRAY\[([^\]]+)\]/.exec(sql);
  assert.ok(tables, "the migration's `tables` array could not be found");
  assert.deepEqual(
    tables[1].split(",").map((x) => x.trim().replace(/'/g, "")).sort(),
    ["dm_reactions", "note_reactions", "post_reactions"],
    "a table that carries the reaction vocabulary is not being widened",
  );

  // A TABLE THAT IS NOT THERE MUST NOT TAKE THE FILE DOWN. This is the bug that
  // hit production: note_reactions lives only in _archive and was never applied
  // to that database, so an unguarded ALTER rolled back the whole migration and
  // post_reactions never got widened either.
  assert.match(sql, /to_regclass/, "the migration does not check that a table exists before altering it");

  for (const k of REACTION_KINDS) assert.ok(isReactionKind(k), `${k} should be a reaction`);
  for (const k of ["", "LIKE", null, undefined, 5, {}, "like; DROP TABLE", "shrug"]) {
    assert.ok(!isReactionKind(k), `${JSON.stringify(k)} should not be a reaction`);
  }
});

test("an unknown kind is refused before it reaches the database", async () => {
  const writes = [];
  __injectPoolForSmokeTests(pool({ onWrite: (t) => writes.push(t) }));
  assert.equal(await reactToPost(ME, 42, "shrug"), null);
  assert.deepEqual(writes, [], "an invalid kind reached a write");
});

test("reacting is an upsert, so a double tap cannot make two rows", async () => {
  const writes = [];
  __injectPoolForSmokeTests(pool({ onWrite: (t) => writes.push(t) }));
  await reactToPost(ME, 42, "like");
  assert.match(writes[0], /ON CONFLICT \(post_id, reactor_amber_id\)/);
  assert.match(writes[0], /DO UPDATE SET kind = EXCLUDED\.kind/, "changing your mind should not need a delete first");
});

test("null clears the reaction rather than storing a null kind", async () => {
  const writes = [];
  __injectPoolForSmokeTests(pool({ onWrite: (t) => writes.push(t) }));
  await reactToPost(ME, 42, null);
  assert.match(writes[0], /DELETE FROM post_reactions/);
});

test("THE WHOLE REACTION STATE COMES BACK, not just the change", async () => {
  // A client computing counts from a delta will eventually be wrong -- somebody
  // else reacted while this request was in flight, and now the number on screen
  // is a number nobody can explain.
  __injectPoolForSmokeTests(
    pool({
      reactions: [
        { kind: "like", mine: true },
        { kind: "like", mine: false },
        { kind: "laugh", mine: false },
      ],
    }),
  );
  const res = await reactToPost(ME, 42, "like");
  assert.deepEqual(res, { counts: { like: 2, laugh: 1 }, mine: "like" });
});

test("mine is null when the only reactions are other people's", async () => {
  __injectPoolForSmokeTests(pool({ reactions: [{ kind: "laugh", mine: false }] }));
  assert.deepEqual(await reactToPost(ME, 42, null), { counts: { laugh: 1 }, mine: null });
});

test("a garbage post id never reaches the database", async () => {
  const p = pool({});
  __injectPoolForSmokeTests(p);
  for (const id of [0, -1, 1.5, NaN, "abc", null, undefined, "1; DROP TABLE"]) {
    assert.equal(await reactToPost(ME, id, "like"), null, `id ${JSON.stringify(id)} was accepted`);
  }
  assert.equal(p.seen.length, 0);
});

// ── comments ────────────────────────────────────────────────────────────────

test("a comment is trimmed, and an empty one is refused", async () => {
  const writes = [];
  __injectPoolForSmokeTests(pool({ onWrite: (t, params) => writes.push(params) }));
  assert.equal(await addPostComment(ME, 42, "   "), null);
  assert.equal(await addPostComment(ME, 42, ""), null);
  assert.equal(await addPostComment(ME, 42, null), null);
  assert.deepEqual(writes, [], "an empty comment was written");

  __injectPoolForSmokeTests(pool({ onWrite: (t, params) => writes.push(params) }));
  const c = await addPostComment(ME, 42, "  hello there  ");
  assert.equal(c.text, "hello there", "the comment was not trimmed");
});

test("a comment longer than the cap is refused HERE, not only in the route", async () => {
  // This is the function anything else will call. "The route validates it"
  // stops being true the first time something else writes a comment.
  const writes = [];
  __injectPoolForSmokeTests(pool({ onWrite: (t, params) => writes.push(params) }));
  assert.equal(await addPostComment(ME, 42, "x".repeat(COMMENT_MAX + 1)), null);
  assert.deepEqual(writes, []);
  __injectPoolForSmokeTests(pool({}));
  assert.ok(await addPostComment(ME, 42, "x".repeat(COMMENT_MAX)), "exactly the cap should be allowed");
});

test("a thread reads oldest first, because a conversation reads down the page", async () => {
  const p = pool({ comments: [] });
  __injectPoolForSmokeTests(p);
  await listPostComments(ME, 42);
  const q = p.seen.find((s) => /FROM post_comments c/.test(s.text));
  assert.match(q.text, /ORDER BY c\.created_at ASC/);
  assert.match(q.text, /c\.deleted_at IS NULL/, "deleted comments are still being read");
});

test("YOU CAN ONLY DELETE YOUR OWN COMMENT, and the delete is soft", async () => {
  const writes = [];
  __injectPoolForSmokeTests(pool({ onWrite: (t, params) => writes.push({ t, params }) }));
  await deletePostComment(ME, 7);
  assert.match(writes[0].t, /UPDATE post_comments SET deleted_at/, "a comment was hard deleted");
  assert.match(writes[0].t, /author_amber_id = \$2::uuid/, "somebody else's comment is deletable");
  assert.deepEqual(writes[0].params, [7, ME]);
});

test("a comment carries who wrote it and whether that is you", async () => {
  __injectPoolForSmokeTests(
    pool({
      comments: [
        { id: 1, text: "mine", created_at: "t", amber_id: ME, username: "me", full_name: "Me", avatar_url: null },
        { id: 2, text: "theirs", created_at: "t", amber_id: OTHER, username: "them", full_name: "Them", avatar_url: null },
      ],
    }),
  );
  const list = await listPostComments(ME, 42);
  assert.equal(list[0].mine, true);
  assert.equal(list[1].mine, false);
  assert.equal(list[1].author.fullName, "Them");
});

// ── the page ────────────────────────────────────────────────────────────────

test("EVERY POST IN A PAGE GETS STATE, INCLUDING THE ONES WITH NONE", async () => {
  // A post with no reactions must come back as an empty reaction row rather
  // than as a missing key, or the feed renders undefined for the commonest case.
  __injectPoolForSmokeTests({
    query: async (text) => {
      if (/FROM post_reactions/.test(text)) return { rows: [{ post_id: 1, kind: "like", mine: true }] };
      // The count query groups; the preview query joins users. Both read
      // post_comments, so they are told apart by what they select.
      if (/count\(\*\)/.test(text)) return { rows: [{ post_id: 2, n: 3 }] };
      if (/LATERAL/.test(text)) {
        return {
          rows: [
            {
              post_id: 2,
              id: 9,
              text: "nice",
              created_at: "2026-09-10T10:00:00Z",
              amber_id: OTHER,
              username: "them",
              full_name: "Them",
              avatar_url: null,
            },
          ],
        };
      }
      return { rows: [] };
    },
  });
  const m = await socialForPosts(ME, [1, 2, 3]);
  assert.deepEqual(m.get("1"), {
    reactions: { counts: { like: 1 }, mine: "like" },
    commentCount: 0,
    comments: [],
  });
  assert.equal(m.get("2").commentCount, 3);
  // THE COUNT AND THE PREVIEW ARE DIFFERENT NUMBERS ON PURPOSE: three comments
  // exist and the card shows the last two, which is what the comments button is
  // for. A card that showed "2" beside two comments would look complete.
  assert.equal(m.get("2").comments.length, 1);
  assert.equal(m.get("2").comments[0].author.fullName, "Them");
  assert.deepEqual(m.get("3"), {
    reactions: { counts: {}, mine: null },
    commentCount: 0,
    comments: [],
  });
});

test("THE PAGE COSTS THE SAME WHETHER IT HOLDS ONE POST OR A HUNDRED", async () => {
  // The number itself is not the invariant -- it went from two to three when
  // the inline comment preview arrived, and that was correct. What must never
  // change is that it does not grow with the page: a query per card is the
  // difference between a feed that loads and one that draws forty empty rows
  // and fills them in one at a time.
  const cost = async (n) => {
    let queries = 0;
    __injectPoolForSmokeTests({
      query: async () => {
        queries += 1;
        return { rows: [] };
      },
    });
    await socialForPosts(ME, Array.from({ length: n }, (_, i) => i + 1));
    return queries;
  };
  const one = await cost(1);
  const hundred = await cost(100);
  assert.equal(one, hundred, `1 post cost ${one} queries, 100 cost ${hundred}`);
  assert.ok(hundred <= 4, `the page costs ${hundred} queries`);
});

test("a broken social query degrades the feed rather than failing it", async () => {
  __injectPoolForSmokeTests({
    query: async () => {
      throw new Error("connection terminated unexpectedly");
    },
  });
  const m = await socialForPosts(ME, [1, 2]);
  assert.equal(m.size, 2);
  assert.deepEqual(m.get("1"), {
    reactions: { counts: {}, mine: null },
    commentCount: 0,
    comments: [],
  });
});

test("no ids, no query", async () => {
  let n = 0;
  __injectPoolForSmokeTests({ query: async () => { n += 1; return { rows: [] }; } });
  assert.equal((await socialForPosts(ME, [])).size, 0);
  assert.equal((await socialForPosts(null, [1])).size, 0);
  assert.equal(n, 0);
});

test("non-numeric ids are dropped before the query rather than cast in SQL", async () => {
  let params = null;
  __injectPoolForSmokeTests({
    query: async (t, p) => {
      params = params ?? p;
      return { rows: [] };
    },
  });
  await socialForPosts(ME, [1, "2", "abc", null, -3, 0, 4.5]);
  assert.deepEqual(params[0], [1, 2], "a bad id reached the database");
});

// ── who reacted ─────────────────────────────────────────────────────────────

test("WHO REACTED IS GATED BY THE SAME VISIBILITY RULE AS EVERYTHING ELSE", async () => {
  // The names of everybody who reacted to a post is exactly the kind of thing
  // an unauthorized read should not hand over, and a post id is a small integer
  // anybody can increment. Null here, 404 at the route -- never a 403, which
  // would confirm the post exists.
  //
  // THE FIRST VERSION OF THIS TEST PROVED NOTHING, and deleting the gate did not
  // fail it: the mock THREW for the reactor query, so an ungated read still
  // ended up in the catch and still answered null. It proved that a failure
  // returns null, which is a different sentence.
  //
  // So the mock now answers the reactor query SUCCESSFULLY, with a real name in
  // it. Null can now only mean the gate turned it away -- if the gate goes, the
  // name comes back and this fails, which is the whole point.
  let reactorQueryRan = false;
  __injectPoolForSmokeTests({
    query: async (text) => {
      if (/FROM wall_posts/.test(text)) return { rows: [] };
      reactorQueryRan = true;
      return {
        rows: [
          {
            kind: "laugh",
            created_at: "2026-09-10T10:00:00Z",
            amber_id: OTHER,
            username: "them",
            full_name: "Them",
            avatar_url: null,
          },
        ],
      };
    },
  });
  assert.equal(await listPostReactors(ME, 42), null, "an invisible post handed over its reactors");
  assert.equal(reactorQueryRan, false, "the reactor query ran despite the visibility check failing");
});

test("each reactor comes back with their kind and whether they are you", async () => {
  __injectPoolForSmokeTests({
    query: async (text) => {
      if (/FROM wall_posts/.test(text)) return { rows: [{ "?column?": 1 }] };
      return {
        rows: [
          {
            kind: "laugh",
            created_at: "2026-09-10T10:00:00Z",
            amber_id: OTHER,
            username: "them",
            full_name: "Them",
            avatar_url: null,
          },
          {
            kind: "like",
            created_at: "2026-09-10T11:00:00Z",
            amber_id: ME,
            username: "me",
            full_name: "Me",
            avatar_url: null,
          },
        ],
      };
    },
  });
  const rows = await listPostReactors(ME, 42);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, "laugh");
  assert.equal(rows[0].mine, false);
  assert.equal(rows[0].person.fullName, "Them");
  assert.equal(rows[1].mine, true);
});

test("a bad post id never reaches the database", async () => {
  let ran = false;
  __injectPoolForSmokeTests({
    query: async () => {
      ran = true;
      return { rows: [] };
    },
  });
  for (const bad of [null, undefined, 0, -1, "abc", "1; DROP TABLE users"]) {
    assert.equal(await listPostReactors(ME, bad), null, `${bad} was let through`);
  }
  assert.equal(await listPostReactors(null, 1), null);
  assert.equal(ran, false, "a malformed id was sent to the database anyway");
});

test("a database failure is an empty answer, not a thrown error", async () => {
  __injectPoolForSmokeTests({
    query: async (text) => {
      if (/FROM wall_posts/.test(text)) return { rows: [{ "?column?": 1 }] };
      throw new Error("connection terminated unexpectedly");
    },
  });
  // null, which the route turns into a 404. A long press that does nothing is
  // better than a long press that crashes the feed.
  assert.equal(await listPostReactors(ME, 42), null);
});

// ── voice comments ──────────────────────────────────────────────────────────
//
// "There should be a little voice thing next to it, like a waveform, where I
//  can leave a voice comment, which should be transcribed and shown with the
//  voice."
//
// The recording is the easy half. What can be wrong:
//
//   THE SILENT COMMENT   transcription fails, or the clip is two seconds of
//                        laughing. A comment with no words is still a comment;
//                        rejecting it loses the recording.
//   THE ORPHAN           a clip uploaded and then abandoned because the app was
//                        killed mid-post. Invisible, uncollectable, and paid for
//                        every month.
//   THE WRONG LISTENER   audio gated on owning the clip rather than on seeing
//                        the post. A voice comment is FOR the thread.

test("THE SILENT COMMENT: a clip with no words is still a comment", async () => {
  const writes = [];
  __injectPoolForSmokeTests(pool({ onWrite: (t) => writes.push(t) }));
  // Neither words nor audio is not a comment...
  assert.equal(await addPostComment(ME, 42, "   "), null);
  assert.deepEqual(writes, [], "an empty comment reached a write");
  // ...but audio with no words is.
  const made = await addPostComment(ME, 42, "", { mediaId: "33333333-3333-3333-3333-333333333333" });
  assert.ok(made, "a voice comment with no transcript was refused");
});

test("the clip is pointed back at the comment, so an orphan can be told from a live one", async () => {
  const writes = [];
  __injectPoolForSmokeTests(pool({ onWrite: (t) => writes.push(t) }));
  await addPostComment(ME, 42, "hello", { mediaId: "33333333-3333-3333-3333-333333333333" });
  assert.ok(
    writes.some((t) => /UPDATE media_assets/.test(t) && /comment_id/.test(t)),
    "the clip was never linked back to its comment",
  );
});

test("a typed comment writes no media at all", async () => {
  const writes = [];
  __injectPoolForSmokeTests(pool({ onWrite: (t) => writes.push(t) }));
  await addPostComment(ME, 42, "just words");
  assert.equal(
    writes.filter((t) => /UPDATE media_assets/.test(t)).length,
    0,
    "a typed comment touched the media table",
  );
});

test("THE WRONG LISTENER: playback is gated on seeing the POST, not on owning the clip", async () => {
  // The clip exists and is ready; the viewer cannot see the post it hangs off.
  // A voice comment is for the thread, so "can you see the thread" is the only
  // question -- and the answer must be no here.
  let audioQueried = false;
  __injectPoolForSmokeTests({
    query: async (text) => {
      if (/FROM post_comments c/.test(text) && /media_assets/.test(text)) {
        audioQueried = true;
        return {
          rows: [
            { post_id: 42, storage_key: "k", content_type: "audio/m4a", duration_ms: 1000, peaks: [] },
          ],
        };
      }
      if (/FROM wall_posts/.test(text)) return { rows: [] }; // not visible
      return { rows: [] };
    },
  });
  assert.equal(await commentAudioForPlayback(ME, 7), null, "an invisible post handed over its audio");
  assert.equal(audioQueried, true, "the test did not exercise the path it claims to");
});

test("playback answers with the key and the waveform when the post IS visible", async () => {
  __injectPoolForSmokeTests({
    query: async (text) => {
      if (/FROM post_comments c/.test(text) && /media_assets/.test(text)) {
        return {
          rows: [
            { post_id: 42, storage_key: "comment-audio/x/y.m4a", content_type: "audio/m4a", duration_ms: 4200, peaks: [3, 9, 4] },
          ],
        };
      }
      if (/FROM wall_posts/.test(text)) return { rows: [{ "?column?": 1 }] };
      return { rows: [] };
    },
  });
  const clip = await commentAudioForPlayback(ME, 7);
  assert.equal(clip.storageKey, "comment-audio/x/y.m4a");
  assert.equal(clip.durationMs, 4200);
  assert.deepEqual(clip.peaks, [3, 9, 4]);
});

test("a bad comment id never reaches the database", async () => {
  let ran = false;
  __injectPoolForSmokeTests({ query: async () => { ran = true; return { rows: [] }; } });
  for (const bad of [null, undefined, 0, -1, "abc", "1; DROP TABLE users"]) {
    assert.equal(await commentAudioForPlayback(ME, bad), null, `${bad} was let through`);
  }
  assert.equal(ran, false);
});

test("the server names the object; the client never gets to", async () => {
  const writes = [];
  __injectPoolForSmokeTests({
    query: async (text) => {
      writes.push(text);
      if (/INSERT INTO media_assets/.test(text)) {
        return { rows: [{ media_id: "44444444-4444-4444-4444-444444444444" }] };
      }
      return { rows: [] };
    },
  });
  const reserved = await reserveCommentAudio(ME);
  // Derived from the owner and a fresh id, so one person cannot point the
  // server at another person's audio by choosing a key.
  assert.equal(reserved.mediaId, "44444444-4444-4444-4444-444444444444");
  assert.match(reserved.storageKey, /^comment-audio\/11111111-1111-1111-1111-111111111111\/44444444-4444-4444-4444-444444444444\.m4a$/);
});

test("peaks are clamped and capped, because they are drawn straight into a view", async () => {
  let params = null;
  __injectPoolForSmokeTests({
    query: async (text, p) => {
      if (/UPDATE media_assets/.test(text)) params = p;
      return { rowCount: 1, rows: [] };
    },
  });
  await markCommentAudioReady(ME, "44444444-4444-4444-4444-444444444444", {
    durationMs: -5,
    byteSize: -1,
    peaks: [...Array(900).fill(500), -20, Number.NaN],
  });
  const [, , durationMs, byteSize, peaks] = params;
  assert.equal(durationMs, 0, "a negative duration was stored");
  assert.equal(byteSize, 0);
  assert.equal(peaks.length, 512, "an unbounded waveform was stored");
  assert.ok(peaks.every((n) => n >= 0 && n <= 100), "a peak outside 0-100 was stored");
});

test("a voice comment comes back with its waveform attached", async () => {
  __injectPoolForSmokeTests(pool());
  const made = await addPostComment(ME, 42, "hello there", {
    mediaId: "33333333-3333-3333-3333-333333333333",
  });
  assert.ok(made.audio, "the comment came back with no clip on it");
  assert.equal(made.audio.durationMs, 2400);
  assert.deepEqual(made.audio.peaks, [4, 8]);
  // The transcript IS the text, which is what makes a voice comment searchable
  // and readable in a notification exactly like a typed one.
  assert.equal(made.text, "hello there");
});

test("a typed comment has no audio field to draw", async () => {
  __injectPoolForSmokeTests(pool());
  const made = await addPostComment(ME, 42, "just words");
  assert.equal(made.audio, null);
});

test("A POST THAT APPEARS TWICE IN A PAGE DOES NOT DOUBLE ITS COMMENTS", async () => {
  // Reported as "for some reason there are two comments, it looks like it
  // duplicated them." `ids` feeds unnest(), which the comment preview CROSS
  // JOINs LATERAL against -- so a repeated post id ran the LATERAL twice and
  // pushed the same comment into the same slot twice.
  let unnested = null;
  __injectPoolForSmokeTests({
    query: async (text, params) => {
      if (/LATERAL/.test(text)) {
        unnested = params[0];
        // The database answers once per id it was given. With [7, 7] that is
        // the same comment twice, which is exactly the shape of the bug.
        return {
          rows: (params[0] ?? []).map(() => ({
            post_id: 7,
            id: 99,
            text: "said once",
            created_at: "2026-09-10T10:00:00Z",
            amber_id: OTHER,
            username: "them",
            full_name: "Them",
            avatar_url: null,
            media_id: null,
          })),
        };
      }
      return { rows: [] };
    },
  });
  const m = await socialForPosts(ME, [7, 7, 7]);
  assert.deepEqual(unnested, [7], "duplicate ids were sent to the database");
  assert.equal(m.size, 1);
  assert.equal(m.get("7").comments.length, 1, "one comment was drawn more than once");
});

test("A REJECTED KIND IS A DEPLOY FAULT, NOT A MISSING POST", async () => {
  // This is the bug as it was reported: "when I react, it said Could not save
  // the reaction." The app had shipped `heart` and the database's CHECK
  // constraint had not been widened yet, so the INSERT raised 23514, landed in
  // the same catch as everything else, and came back as null -- which the route
  // turns into a 404, which the app shows as a generic failure.
  //
  // A permission fault and a deployment fault are different events. They must
  // not produce the same answer, or the next one takes an hour to find too.
  __injectPoolForSmokeTests({
    query: async (text) => {
      if (/FROM wall_posts/.test(text)) return { rows: [{ "?column?": 1 }] };
      if (/INSERT INTO post_reactions/.test(text)) {
        throw Object.assign(new Error('violates check constraint "post_reactions_kind_chk"'), {
          code: "23514",
        });
      }
      return { rows: [] };
    },
  });
  assert.equal(await reactToPost(ME, 42, "heart"), REACTION_NOT_ACCEPTED);
});

test("...and an ordinary database failure is still just a failure", async () => {
  __injectPoolForSmokeTests({
    query: async (text) => {
      if (/FROM wall_posts/.test(text)) return { rows: [{ "?column?": 1 }] };
      throw new Error("connection terminated unexpectedly");
    },
  });
  assert.equal(await reactToPost(ME, 42, "like"), null);
});

test("EVERY KIND THE APP OFFERS IS ONE THE MIGRATION WIDENS", () => {
  // The check that would have caught the whole thing before it shipped: the
  // vocabulary the server validates against and the vocabulary the constraint
  // accepts have to be the same set, and both are read from source here rather
  // than typed out.
  const sql = readFileSync(
    new URL("../../db/migrations/20260911_045_reactions_add_heart.sql", import.meta.url),
    "utf8",
  );
  const declared = /kinds\s+text\[\]\s*:=\s*ARRAY\[([^\]]+)\]/.exec(sql);
  const accepted = new Set(
    declared[1].split(",").map((x) => x.trim().replace(/'/g, "")),
  );
  for (const k of REACTION_KINDS) {
    assert.ok(accepted.has(k), `the app offers "${k}" and the database will refuse it`);
  }
});
