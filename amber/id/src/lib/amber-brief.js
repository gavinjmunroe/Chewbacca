/**
 * THE ACCOUNT, IN WORDS, FOR THE FIRST QUESTION SOMEBODY ASKS.
 *
 *   "Tell me about my contacts."   "What can Amber do for me?"
 *
 * The generic answer to the second one is a paragraph about what an assistant
 * is, and it is worthless: every product says it. The specific answer is "you
 * have 966 people, 134 of them with something saved, four circles, one calendar
 * connected and six things on your week" -- and the specific answer is only
 * possible because these numbers are real.
 *
 * EVERY NUMBER CARRIES ITS DENOMINATOR WHERE IT HAS ONE, and that is not a
 * style preference. Two of four live "tell me about my network" turns stated a
 * false figure about the user's own address book: a bare 723 printed one line
 * under a total of 2,897 came back as "all 2,897 have saved notes, meaning you
 * have captured context on every single person". A numerator next to a total is
 * read as the whole, so the remainder is spelled out and the sentence becomes
 * impossible to write. See the same rule in the overview branch of chat.js.
 *
 * A ZERO IS A SENTENCE, NOT A GAP. A brand-new user asking what Amber is must
 * get the same quality of answer as a ten-year one, which means the empty state
 * is stated plainly along with the one action that changes it, never hidden and
 * never dressed up as a description of what will happen one day.
 */

/** Pluralize without a library and without "1 contacts". */
function count(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The block that goes in front of the model.
 *
 * @param {object|null} inv    readAmberInventory()'s snapshot, or null if unreadable
 * @param {"about_amber"|"about_theirs"} flavor  which question was asked
 * @returns {string} the block, or "" when there is nothing trustworthy to say
 */
export function renderAmberBrief(inv, flavor = "about_theirs") {
  // NULL IS NOT ZERO. A failed read must never become "you have nobody yet" in
  // front of somebody holding three thousand people, so it says nothing at all
  // and the turn falls back to the answer it would have given before.
  if (!inv) return "";

  const lines = [];
  lines.push("WHAT YOU ACTUALLY HOLD FOR THIS PERSON, RIGHT NOW. Every number is exact.");
  lines.push("");

  if (inv.contacts === 0) {
    /**
     * DAY ONE, SAID OUT LOUD. Amber's identity forbids guessing whether
     * contacts are synced, precisely so this line can be definite when it is
     * definite: there is nobody, and syncing is the thing that changes it.
     */
    lines.push(
      "They have NO contacts yet. This is a brand-new account. Say so in one plain line " +
        "and name the one thing that changes it, which is syncing their phone's contacts " +
        "from Settings. Do not describe what you will be able to do one day as though it " +
        "were happening now, and do not apologize at length.",
    );
  } else {
    const withFacts = inv.contactsWithFacts;
    const without = Math.max(0, inv.contacts - withFacts);
    lines.push(`- ${count(inv.contacts, "contact")} in their address book.`);
    lines.push(
      `- ${withFacts} of those ${inv.contacts} carry something you have saved about them. ` +
        `The other ${without} have nothing on them yet.`,
    );
    if (inv.facts > 0) {
      lines.push(`- ${count(inv.facts, "saved fact")} in total, across those people.`);
    }
  }

  if (inv.circles > 0) {
    lines.push(
      `- ${count(inv.circles, "circle")}, holding ${count(inv.circleMembers, "person", "people")} between them.`,
    );
  }

  if (inv.calendarAccounts > 0) {
    lines.push(
      `- ${count(inv.calendarAccounts, "calendar account")} connected and syncing into their day.`,
    );
  } else {
    lines.push(
      "- NO calendar account connected to Amber. Their phone's own calendar is read on the " +
        "device and never reaches you, so do not claim their week is empty.",
    );
  }

  lines.push(
    inv.eventsNext7d > 0
      ? `- ${count(inv.eventsNext7d, "thing")} scheduled in the next seven days (${inv.eventsTotal} on their calendar in total).`
      : "- Nothing scheduled in the next seven days that you can see.",
  );

  if (inv.openReminders > 0 || inv.timedRemindersAhead > 0) {
    const parts = [];
    if (inv.openReminders > 0) {
      parts.push(`${count(inv.openReminders, "open reminder")} waiting to be ticked off`);
    }
    if (inv.timedRemindersAhead > 0) {
      parts.push(`${count(inv.timedRemindersAhead, "reminder")} with a time still ahead of them`);
    }
    lines.push(`- ${parts.join(", and ")}.`);
  }

  if (inv.voiceNotes > 0) {
    lines.push(`- ${count(inv.voiceNotes, "voice note")} recorded.`);
  }
  if (inv.amberConnections > 0) {
    lines.push(
      `- ${count(inv.amberConnections, "person", "people")} connected to them on Amber itself.`,
    );
  }
  if (inv.pendingRequests > 0) {
    lines.push(
      `- ${count(inv.pendingRequests, "connection request")} waiting on them to answer.`,
    );
  }

  lines.push("");
  lines.push(
    flavor === "about_amber"
      ? "THEY ASKED WHAT YOU ARE. Answer as Amber, in a few sentences of plain prose, and " +
          "ground it in the numbers above rather than in adjectives: what you are holding for " +
          "THEM is the answer, and every product can recite a feature list. Lead with their " +
          "people. Then one line on what that makes possible, and close by offering one " +
          "specific thing you could do with what they already have, phrased as a question. " +
          "Never a headed menu of capabilities and never a bulleted list of features."
      : "THEY ASKED ABOUT THEIR OWN BOOK. Lead with the size of it, then how much they have " +
          "captured, then whatever above is genuinely worth knowing. Skip anything that is " +
          "zero rather than reciting an empty inventory at them. Close by offering one " +
          "specific next step as a question.",
  );
  lines.push(
    "NEVER INVENT A NUMBER, and never round one into a claim. Do not write \"all\", " +
      "\"every\", \"each\", \"everyone\" or \"none\" for a figure that is not literally the " +
      "total or literally zero, and never praise their coverage as complete unless the two " +
      "numbers above are actually equal. Getting a count wrong about their own address book " +
      "is worse than saying less.",
  );
  lines.push(
    "Speak about their people and their days, never about the mechanics. Do not use the " +
      "words data, record, field, database, sync payload or inventory. Short clean prose, " +
      "no headings, no bullet points, no em-dashes.",
  );

  return lines.join("\n");
}
