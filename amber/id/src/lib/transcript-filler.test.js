/**
 * THE NOTE THAT CAME BACK AS "THANK YOU FOR WATCHING!"
 *
 * Two things have to be true at once and they pull against each other: every
 * known hallucination has to go, and not one word the user actually said may.
 * The second is the harder half and it is where the tests are weighted, because
 * a filter that eats real speech is a worse bug than the one it fixes -- it
 * would be silent, and it would look like the app losing notes again.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { stripTranscriptFiller } from "./transcript-filler.js";

test("THE ONE FROM THE SCREENSHOT", () => {
  const { text, removed, allFiller } = stripTranscriptFiller(
    "Remind me to pick up my clothes tomorrow. Thank you for watching!",
  );
  assert.equal(text, "Remind me to pick up my clothes tomorrow.");
  assert.deepEqual(removed, ["Thank you for watching!"]);
  assert.equal(allFiller, false);
});

test("a transcript that is ONLY the hallucination is nothing at all", () => {
  /**
   * The state that matters most: the recording caught no speech, so the honest
   * result is empty and the caller can escalate or keep the audio. Filing
   * "Thank you for watching!" as the user's note is how a long voice note
   * became a line of YouTube boilerplate.
   */
  for (const junk of [
    "Thank you for watching!",
    "Thanks for watching.",
    "Please subscribe to my channel",
    "Subtitles by the Amara.org community",
    "you",
    "Bye.",
    "♪♪♪",
    "[BLANK_AUDIO]",
    "The End",
  ]) {
    const r = stripTranscriptFiller(junk);
    assert.equal(r.text, "", `kept: ${junk}`);
    assert.equal(r.allFiller, true, `did not report nothing was said: ${junk}`);
  }
});

test("filler at BOTH ends comes off, and the middle survives", () => {
  const { text } = stripTranscriptFiller(
    "Bye. Call the bank about the mortgage on Tuesday. Thanks for watching!",
  );
  assert.equal(text, "Call the bank about the mortgage on Tuesday.");
});

test("a hallucination with a period inside it is one sentence, not two", () => {
  /**
   * "Subtitles by the Amara.org community" split on the period in the domain,
   * so the front half matched the filter, the back half did not, and the note
   * came out reading "org community". A split that only breaks when whitespace
   * follows the punctuation keeps the URL whole -- and keeps "at 9 a.m." whole
   * in real speech, which is the same bug pointing at the user's words.
   */
  assert.equal(stripTranscriptFiller("Subtitles by the Amara.org community").text, "");
  const real = "Meet him at 9 a.m. sharp on Tuesday.";
  assert.equal(stripTranscriptFiller(real).text, real);
});

test("REAL SPEECH THAT LOOKS LIKE FILLER IS KEPT", () => {
  /**
   * The expensive mistake. Somebody dictating a note about their own video
   * genuinely says these words, and a filter that hunted through the body would
   * eat the sentence. Whisper brackets the real audio rather than interrupting
   * it, so only the ends are ever considered.
   */
  const inner =
    "I told Maggie thanks for watching the pitch and she said she would send notes.";
  assert.equal(stripTranscriptFiller(inner).text, inner);

  const withBye = "Sagar said bye. Then he called back about the term sheet.";
  assert.equal(stripTranscriptFiller(withBye).text, withBye);
});

test("a plain thank-you at the end of a real note is not a hallucination", () => {
  // "Thanks" on its own is a thing people say and is not on the list. This is
  // the line the filter must not cross: it removes YouTube outros, not manners.
  const note = "Remind me to send Dana the deck. Thanks.";
  const r = stripTranscriptFiller(note);
  assert.equal(r.text, "Remind me to send Dana the deck. Thanks.");
  assert.deepEqual(r.removed, []);
});

test("the words that survive are byte for byte the words that came in", () => {
  /**
   * Nothing is normalized on the way through. A filter that trimmed doubled
   * spaces or straightened quotes would be rewriting transcripts on every call
   * for no reason anybody asked for, and the difference would surface as
   * "Amber changes what I said".
   */
  const messy = "Meet  AJ at 4.  Bring the  deck — the NEW one, not Ajay's.";
  assert.equal(stripTranscriptFiller(messy).text, messy);
});

test("an empty or missing transcript is empty, and is NOT reported as filler", () => {
  // allFiller means "there was audio and it was all boilerplate", which is a
  // different thing from "there was nothing here". The caller reacts to them
  // differently, so they cannot collapse.
  for (const empty of ["", "   ", null, undefined, 42]) {
    const r = stripTranscriptFiller(empty);
    assert.equal(r.text, "");
    assert.equal(r.allFiller, false, `an empty input claimed to be filler: ${String(empty)}`);
  }
});

test("multi-sentence hallucinations at the tail all come off", () => {
  // Whisper stacks them on a long silence: an outro, then a subscribe plea.
  const { text, removed } = stripTranscriptFiller(
    "Set a reminder for the dentist. Thanks for watching! Please subscribe. Bye.",
  );
  assert.equal(text, "Set a reminder for the dentist.");
  assert.equal(removed.length, 3);
});

test("a real note is untouched, which is the common case", () => {
  const real =
    "Remind me tomorrow and Sunday to find a good place to do some deep thinking. " +
    "Go to a park or something and get dialed on what the offering is.";
  const r = stripTranscriptFiller(real);
  assert.equal(r.text, real);
  assert.deepEqual(r.removed, []);
  assert.equal(r.allFiller, false);
});
