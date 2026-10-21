"use client";

/**
 * SIX REACTIONS, AND THE REASON THERE ARE ONLY SIX.
 *
 * Free-form emoji turns into a second messaging channel that nobody can
 * search and everybody has to interpret. These cover what a reaction is
 * actually FOR at work -- read it, agree, on it, nice, funny, confused --
 * and the server rejects anything else, so the picker is the whole set
 * rather than a doorway to one.
 *
 * IT ANSWERS IMMEDIATELY AND RECONCILES AFTER. Pressing a reaction is the
 * smallest thing anybody does in a chat and it must feel free: the count
 * moves on the press, the request goes, and if it fails the count goes back.
 * Waiting for a round trip to colour in a thumb is how a product earns the
 * word sluggish.
 *
 * REACTING IS IDEMPOTENT IN THE USEFUL SENSE -- the same call adds or takes
 * back -- so a double tap cannot strand one, and the client never needs to
 * know the current state to act.
 */

import { useEffect, useState } from "react";
import { SmilePlus } from "lucide-react";
import { REACTIONS, REACTION_MEANING, react, type PostReaction } from "@/lib/knowledge";

export default function Reactions({
  postId,
  initial = [],
}: {
  postId: string;
  initial?: PostReaction[];
}) {
  const [rows, setRows] = useState<PostReaction[]>(initial);
  const [picking, setPicking] = useState(false);

  /* A refresh of the room brings new counts; adopt them. */
  useEffect(() => setRows(initial), [initial]);

  const toggle = async (emoji: string) => {
    setPicking(false);
    const before = rows;
    const mine = rows.find((r) => r.emoji === emoji)?.mine ?? false;

    setRows((cur) => {
      const next = cur.map((r) =>
        r.emoji === emoji ? { ...r, count: r.count + (mine ? -1 : 1), mine: !mine } : r,
      );
      if (!next.some((r) => r.emoji === emoji)) next.push({ emoji, count: 1, mine: true });
      return next.filter((r) => r.count > 0);
    });

    try {
      await react(postId, emoji);
    } catch {
      setRows(before);
    }
  };

  const shown = rows.filter((r) => r.count > 0);

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {shown.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => toggle(r.emoji)}
          title={REACTION_MEANING[r.emoji] ?? r.emoji}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[12px] transition ${
            r.mine
              ? "border-[var(--ds-accent)] bg-[var(--ds-accent-soft,rgba(232,162,79,.16))] text-[var(--ds-ink)]"
              : "border-[var(--ds-line)] text-[var(--ds-muted)] hover:border-[var(--ds-accent)]"
          }`}
        >
          <span>{r.emoji}</span>
          <span className="tabular-nums">{r.count}</span>
        </button>
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => setPicking((v) => !v)}
          aria-label="React"
          className={`rounded-full border border-[var(--ds-line)] p-[3px] text-[var(--ds-faint)] transition hover:border-[var(--ds-accent)] hover:text-[var(--ds-ink)] ${
            shown.length === 0 ? "opacity-0 group-hover:opacity-100" : ""
          }`}
        >
          <SmilePlus className="h-3.5 w-3.5" />
        </button>

        {picking ? (
          <>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setPicking(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div className="absolute bottom-7 left-0 z-50 flex gap-0.5 rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] p-1 shadow-[var(--ds-shadow-md,0_4px_16px_rgba(0,0,0,.12))]">
              {REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => toggle(e)}
                  title={REACTION_MEANING[e] ?? e}
                  className="rounded-lg px-1.5 py-1 text-[15px] transition hover:bg-[var(--ds-sunk,rgba(0,0,0,.05))]"
                >
                  {e}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
