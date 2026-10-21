"use client";

/**
 * EVERYTHING ABOUT ONE PERSON, WITHOUT LEAVING THE ANSWER.
 *
 * WHY IT OPENS IN PLACE. The answer is the context the name came from.
 * Clicking "Sagar Tiwari" and being navigated to a directory means reading
 * the record and then going back to remember why you were looking -- and
 * the question is usually "should I ask this person", which needs both
 * halves on screen at once.
 *
 * WHAT IT SHOWS AND IN WHAT ORDER. Who they are and where they work, their
 * address because that is how you actually reach them, how warm the
 * relationship is, who else here knows them -- which is the real answer to
 * "can I get an introduction" -- and then the meetings, most recent first.
 *
 * IT REUSES THE SAME READ THE PERSON SCREEN USES, so it shows exactly what
 * this viewer is allowed to see and nothing else. `hidden` is reported
 * rather than silently dropped: knowing there are four more you cannot see
 * is a different thing from thinking there are none.
 */

import { useEffect, useState } from "react";
import { Loader2, Mail, X } from "lucide-react";
import { ago, getPerson, type Interaction, type Knower, type PersonDetail } from "@/lib/memory";

export default function PersonCard({
  personId,
  onClose,
}: {
  personId: string;
  onClose?: () => void;
}) {
  const [data, setData] = useState<{
    person: PersonDetail;
    whoKnows: Knower[];
    history: Interaction[];
    hidden: number;
  } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    getPerson(personId)
      .then((r) => alive && setData(r))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [personId]);

  if (failed) return null;

  if (!data) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--ds-line)] px-3 py-3 text-[12.5px] text-[var(--ds-muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Opening…
      </div>
    );
  }

  const { person, whoKnows, history, hidden } = data;
  const emails = (person.identities ?? []).filter((i) => i.kind === "email");

  return (
    <div className="rounded-xl border border-[var(--ds-line)] bg-[var(--ds-sunk,var(--ds-card))] p-3.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[var(--ds-ink)]">{person.display_name}</p>
          <p className="text-[12.5px] text-[var(--ds-muted)]">
            {[person.title, person.account_name ?? person.company].filter(Boolean).join(" · ") ||
              "No title or firm on this record yet"}
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-[var(--ds-faint)] transition hover:text-[var(--ds-ink)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {emails.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {emails.slice(0, 4).map((e) => (
            <a
              key={e.value}
              href={`mailto:${e.value}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ds-line)] px-2.5 py-1 text-[12px] text-[var(--ds-muted)] transition hover:border-[var(--ds-accent)] hover:text-[var(--ds-ink)]"
            >
              <Mail className="h-3 w-3" />
              {e.value}
            </a>
          ))}
        </div>
      ) : null}

      <p className="mt-2.5 text-[12px] text-[var(--ds-faint)]">
        {person.interactions ?? 0} {(person.interactions ?? 0) === 1 ? "touch" : "touches"} yours
        {Number(person.company_interactions ?? 0) > Number(person.interactions ?? 0)
          ? ` · ${person.company_interactions} across the company`
          : ""}
        {person.last_at ? ` · last ${ago(person.last_at)}` : " · never met"}
      </p>

      {whoKnows.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11.5px] uppercase tracking-wide text-[var(--ds-faint)]">
            Who here knows them
          </p>
          <ul className="mt-1 space-y-0.5">
            {whoKnows.slice(0, 5).map((k) => (
              <li key={k.member_id} className="text-[12.5px] text-[var(--ds-ink)]">
                {k.member_name ?? "Somebody here"}
                <span className="text-[var(--ds-muted)]">
                  {" "}
                  · {k.interactions} {k.interactions === 1 ? "touch" : "touches"}
                  {k.last_at ? `, last ${ago(k.last_at)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11.5px] uppercase tracking-wide text-[var(--ds-faint)]">Recently</p>
          <ul className="mt-1 space-y-0.5">
            {history.slice(0, 6).map((h) => (
              <li key={h.id} className="text-[12.5px] text-[var(--ds-muted)]">
                <span className="text-[var(--ds-ink)]">{h.summary ?? h.kind}</span>
                {" · "}
                {ago(h.occurred_at)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hidden > 0 ? (
        <p className="mt-2.5 text-[11.5px] text-[var(--ds-faint)]">
          {hidden} more {hidden === 1 ? "entry is" : "entries are"} private to the colleague who
          recorded {hidden === 1 ? "it" : "them"}.
        </p>
      ) : null}
    </div>
  );
}
