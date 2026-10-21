"use client";

/**
 * THE ANSWER, WITH THE PEOPLE IN IT MADE OPENABLE.
 *
 * WHAT THIS FIXES. The answer names people -- "Sagar Tiwari has 12 touches,
 * last seen 15 October" -- and the next thing anybody wants is everything
 * else about Sagar: their firm, their title, the meetings, their address.
 * Reading a name and then going to find that person in a list is the kind of
 * small friction that makes a product feel like a report rather than a tool.
 *
 * SO EVERY NAME AND ADDRESS THE EVIDENCE KNOWS BECOMES A CHIP, in place, in
 * the sentence. The index that came with the answer says who those are, so
 * nothing here is guessed: a word is only made clickable when it matches
 * somebody the server actually returned. A name the model mentioned that the
 * evidence does not contain stays plain text, which is the honest outcome --
 * there is nothing to open.
 *
 * ADDRESSES ARE SHOWN AS ADDRESSES rather than quietly swapped for names,
 * because before enrichment runs the address IS what somebody is called
 * here, and a chip that says one thing while the record says another is
 * worse than either.
 */

import { Fragment, useMemo } from "react";

export type AnswerPerson = {
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  firm: string | null;
  touches: number;
  lastAt: string | null;
  internal: boolean;
};

/** Longest first, so "Sagar Tiwari" wins over "Sagar". */
function needles(people: AnswerPerson[]) {
  const out: { text: string; person: AnswerPerson }[] = [];
  for (const p of people) {
    if (p.name && p.name.length >= 3) out.push({ text: p.name, person: p });
    if (p.email) out.push({ text: p.email, person: p });
  }
  return out.sort((a, b) => b.text.length - a.text.length);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default function AnswerText({
  text,
  people,
  onOpen,
}: {
  text: string;
  people: AnswerPerson[];
  onOpen?: (personId: string) => void;
}) {
  const parts = useMemo(() => {
    const found = needles(people);
    if (found.length === 0) return [{ text }];

    /*
     * ONE PASS WITH ONE EXPRESSION, rather than a replace per person. Doing
     * them one at a time means the second pass can match inside what the
     * first produced, which is how "Sagar" ends up linked inside the chip
     * that already says "Sagar Tiwari".
     */
    const re = new RegExp(`(${found.map((f) => escape(f.text)).join("|")})`, "gi");
    const pieces: { text: string; person?: AnswerPerson }[] = [];
    let last = 0;
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      if (at > last) pieces.push({ text: text.slice(last, at) });
      const hit = found.find((f) => f.text.toLowerCase() === m[0].toLowerCase());
      pieces.push({ text: m[0], person: hit?.person });
      last = at + m[0].length;
    }
    if (last < text.length) pieces.push({ text: text.slice(last) });
    return pieces;
  }, [text, people]);

  return (
    <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--ds-ink)]">
      {parts.map((p, i) =>
        p.person ? (
          <button
            key={i}
            type="button"
            onClick={() => onOpen?.(p.person!.id)}
            title={[p.person.title, p.person.firm].filter(Boolean).join(" · ") || undefined}
            className="mx-[1px] rounded-md bg-[var(--ds-accent-soft,rgba(232,162,79,.16))] px-1 py-[1px] font-medium text-[var(--ds-ink)] underline decoration-[var(--ds-accent)] decoration-dotted underline-offset-2 transition hover:bg-[var(--ds-accent)] hover:text-white"
          >
            {p.text}
          </button>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </p>
  );
}
