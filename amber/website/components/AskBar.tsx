"use client";

/**
 * THE ASK BAR, WHICH APPEARS ONCE AN ASSISTANT IS CONNECTED.
 *
 * WHY IT IS HIDDEN UNTIL THEN, rather than always present and apologetic.
 * An ask bar over an empty graph answers "I don't know" to everything, and a
 * feature whose first impression is that is a feature nobody presses twice.
 * Connecting Copilot is what fills the graph with the conversations that make
 * the answers worth reading, so that is when it shows up.
 *
 * EVERY ANSWER COMES WITH ITS EVIDENCE. An answer about a relationship with
 * no way to see which meetings it came from is a claim rather than a result,
 * and the first thing anybody does with a surprising answer is look for where
 * it came from. The rows are already in the response; showing them is the
 * difference between a chatbot and a tool somebody trusts with a client
 * conversation.
 *
 * AND THE EVIDENCE IS THEIRS. The server assembles it from the same
 * viewer-aware reads the screens use, so what the model saw is exactly what
 * this person could have found by clicking. Nothing here widens that; this
 * is a faster path to their own records.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import AnswerText, { type AnswerPerson } from "@/components/AnswerText";
import PersonCard from "@/components/PersonCard";
import { askStream } from "@/lib/amber";
import { Building2, CornerDownLeft, Loader2, Search } from "lucide-react";
import { call, tokenNow } from "@/lib/amber";

type Person = {
  name: string;
  title: string | null;
  firm: string | null;
  yourTouches: number | null;
  lastSeen: string | null;
  internal: boolean;
};

type Evidence = {
  lookedFor?: string[];
  matchedPeople: Person[];
  /** The answer to "who here knows someone at X" lives in here. */
  matchedFirms: {
    name: string;
    domain: string | null;
    peopleWeKnow: number;
    colleaguesWhoKnowThem: {
      name: string | null;
      people: number;
      touches: number;
      lastAt: string | null;
    }[];
  }[];
  timeline: { when: string; kind: string; source: string; summary: string | null }[];
  pages: { title: string; excerpt: string | null }[];
  goingQuiet?: { name: string; lastSeen: string | null; firm: string | null }[];
  everyoneYouKnow?: Person[];
};

type AskIndex = {
  people: AnswerPerson[];
  firms: { id: string; name: string; domain: string | null; people: number; knowers: number }[];
};

type AskResult = {
  answer: string | null;
  evidence: Evidence;
  index?: AskIndex;
  grounded: boolean;
  subject?: string | null;
  note?: string;
  /** True while tokens are still arriving, so the screen can say so. */
  streaming?: boolean;
};

type Availability = {
  available: boolean;
  assistants: { provider: string; label: string | null; connectedAt: string }[];
  synthesis: boolean;
};

export default function AskBar({
  placeholder,
  /**
   * WHAT IS ON SCREEN WHEN THE QUESTION IS ASKED.
   *
   * Somebody filters the network to eleven people and asks "which of these
   * should I chase". "These" is the filter. Without it the answer is about
   * the whole roster, which is wrong in the particular way that reads as
   * the product not listening.
   */
  focus,
  /** Narrow column beside a view, rather than a banner across the top. */
  compact = false,
}: {
  placeholder?: string;
  focus?: string[];
  compact?: boolean;
}) {
  const [ready, setReady] = useState<Availability | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  /** Which phase it is in, shown beside the spinner. */
  const [stage, setStage] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    call<Availability>("/v1/org/ask/available", {}, tokenNow() ?? undefined)
      .then((r) => alive && setReady(r))
      .catch(() => alive && setReady(null));
    return () => {
      alive = false;
    };
  }, []);

  const ask = useCallback(async () => {
    const text = q.trim();
    if (text.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    setOpenPerson(null);
    setResult(null);

    /*
     * THE EVIDENCE LANDS FIRST AND THE SENTENCES ARRIVE BEHIND IT.
     *
     * Retrieval is a few hundred milliseconds; the model is two or three
     * seconds. The blocking call held both back until the last token, so
     * the screen sat empty for the whole of it -- which is what "insane
     * latency" was. Nothing here makes the model faster. It stops the firm
     * cards, the people and the counts from waiting on it.
     */
    let streamed = "";
    try {
      await askStream(
        text,
        (e) => {
          if (e.type === "evidence") {
            const payload = e.payload as { evidence: Evidence; index?: AskIndex; subject?: string };
            setResult({
              answer: "",
              evidence: payload.evidence,
              index: payload.index,
              subject: payload.subject ?? null,
              grounded: true,
              streaming: true,
            });
          } else if (e.type === "token") {
            streamed += e.text;
            setResult((r) => (r ? { ...r, answer: streamed } : r));
          } else {
            /*
             * The finished text replaces the streamed text. Markdown cannot
             * be stripped from half a pair of asterisks, so the server
             * cleans the whole answer once and sends it at the end; what
             * was on screen until now was progress.
             */
            setResult((r) =>
              r
                ? {
                    ...r,
                    answer: e.payload.answer ?? streamed ?? null,
                    grounded: e.payload.grounded,
                    streaming: false,
                  }
                : r,
            );
          }
        },
        tokenNow() ?? undefined,
        undefined,
        focus,
      );
    } catch {
      /*
       * A FALLBACK, NOT AN ERROR. A proxy that will not pass an event
       * stream is a real deployment, and the plain route gives the same
       * answer a few seconds later. Somebody waiting is better than
       * somebody refused.
       */
      try {
        const r = await call<AskResult>(
          "/v1/org/ask",
          { method: "POST", body: JSON.stringify(focus?.length ? { q: text, focus } : { q: text }) },
          tokenNow() ?? undefined,
        );
        setResult(r);
      } catch (e) {
        setError((e as { message?: string })?.message ?? "Could not ask that.");
      }
    } finally {
      setBusy(false);
    }
  }, [q, busy, focus]);

  /*
   * SHOWN WHENEVER IT CAN ANSWER, which is whenever there is a graph.
   *
   * It used to require a connected assistant, which meant the bar was
   * invisible until somebody wired up Copilot -- and the thing it is best at
   * is answering from the CALENDAR, which lands long before any assistant
   * does. Hiding the one control that makes a graph useful until an
   * unrelated integration is finished is a feature nobody discovers.
   */
  if (ready && !ready.synthesis) return null;

  /*
   * `ready` is null while the first check is in flight, and the bar renders
   * anyway -- a control that appears a beat after the page is a control
   * people see flicker in. Naming the connected assistants is the only part
   * that has to wait for the answer.
   */
  const who = (ready?.assistants ?? []).map((a) => a.label || a.provider).join(" and ");

  return (
    <section className="space-y-2">
      {/*
        BIG ENOUGH TO BE THE POINT OF THE SCREEN.
        
        This was a 2px-padded strip the height of a form field, sitting above
        a graph, and it read as a filter box -- which is what people treated
        it as. The thing it does is the most valuable thing on the page, and
        a control that looks like chrome gets used like chrome.
      */}
      {/*
        ONE SURFACE, NOT A BOX INSIDE A BOX.
        
        The input carried its own border and background inside an already
        bordered container, so it read as a form field somebody had framed
        -- two nested rectangles where there is one control. The input is
        now transparent and borderless and the container IS the control,
        which is what every assistant input people already use looks like.
        
        A silhouette rather than a sparkle: the star says "AI feature", which
        is a thing to be sold. A face says "ask a person about people", which
        is what this actually does.
      */}
      <div
        className={`flex items-center rounded-2xl border border-[var(--ds-line)] bg-[var(--ds-card)] shadow-[var(--ds-shadow-sm)] transition focus-within:border-[var(--ds-accent)] focus-within:shadow-[0_0_0_4px_var(--ds-accent-soft)] ${
          compact ? "gap-2.5 px-3.5 py-2.5" : "gap-3.5 px-5 py-4"
        }`}
      >
        <span
          className={`grid shrink-0 place-items-center rounded-full bg-[var(--ds-hover)] ${
            compact ? "h-6 w-6" : "h-7 w-7"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
            <circle cx="12" cy="8.5" r="3.6" fill="var(--ds-muted)" />
            <path
              d="M4.6 20.2c0-4 3.3-6.4 7.4-6.4s7.4 2.4 7.4 6.4"
              fill="var(--ds-muted)"
            />
          </svg>
        </span>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void ask();
          }}
          spellCheck={false}
          data-gramm="false"
          data-gramm_editor="false"
          data-enable-grammarly="false"
          placeholder={placeholder ?? "Ask about a person, a firm, or what happened"}
          className={`min-w-0 flex-1 border-0 bg-transparent p-0 text-[var(--ds-ink)] shadow-none outline-none ring-0 placeholder:text-[var(--ds-faint)] focus:outline-none focus:ring-0 ${
            compact ? "text-[13.5px]" : "text-[15.5px]"
          }`}
        />
        {busy ? (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[var(--ds-accent)]" />
        ) : (
          <button
            type="button"
            onClick={() => void ask()}
            disabled={q.trim().length < 2}
            className="shrink-0 rounded-xl bg-[var(--ds-accent)] px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-[var(--ds-accent-hover)] disabled:opacity-30"
            aria-label="Ask"
          >
            <CornerDownLeft className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/*
        THREE REAL QUESTIONS, because an empty box with a placeholder is a
        box nobody types in. These are the three this data can genuinely
        answer well, and pressing one is faster than inventing a question --
        which is the actual barrier, not the typing.
      */}
      {!result && !busy ? (
        <div className="flex flex-wrap gap-1.5 px-0.5">
          {[
            "Who here knows someone at Paychex?",
            "What happened with my last few meetings?",
            "Which relationships are going quiet?",
          ].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setQ(s);
                inputRef.current?.focus();
              }}
              className="rounded-full border border-[var(--ds-line)] px-2.5 py-1 text-[12px] text-[var(--ds-muted)] transition hover:border-[var(--ds-accent)] hover:text-[var(--ds-ink)]"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <p className="px-1 text-[11.5px] leading-relaxed text-[var(--ds-dim)]">
        Answers come from your meetings, email{who ? ` and ${who}` : ""} history — only the parts
        you can see.
      </p>

      {error ? (
        <p className="rounded-lg border border-[var(--ds-line)] bg-[var(--ds-sunk)] px-3 py-2 text-[12.5px] text-[var(--ds-ink)]">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="space-y-3 rounded-2xl border border-[var(--ds-line)] bg-[var(--ds-card)] p-4 shadow-[var(--ds-shadow-sm)]">
          {result.answer ? (
            /*
              WHITESPACE IS PRESERVED because the answer is prose with its own
              line breaks -- "Sagar Tiwari, Stanford - 43 days" on a line of
              its own -- and collapsing them runs a list into one paragraph.
              The server strips the markdown; this keeps the shape that is
              left.
            */
            <AnswerText
              text={result.answer}
              people={result.index?.people ?? []}
              onOpen={(id) => setOpenPerson((cur) => (cur === id ? null : id))}
            />
          ) : result.streaming ? (
            <p className="text-[13px] leading-relaxed text-[var(--ds-muted)]">Reading your graph…</p>
          ) : (
            <p className="text-[13px] leading-relaxed text-[var(--ds-muted)]">
              {result.note ?? "No answer, but these matched."}
            </p>
          )}

          {/*
            EVERYTHING ABOUT THE PERSON YOU JUST PRESSED, in place. Clicking
            a name in an answer and being taken somewhere else loses the
            answer, and the answer is the context the name came from.
          */}
          {openPerson ? (
            <PersonCard personId={openPerson} onClose={() => setOpenPerson(null)} />
          ) : null}

          {/*
            THE FIRM CARD IS THE ANSWER, not a citation.
            
            "Who here knows someone at Paychex" is answered by a list of
            colleagues and how warm each one is. Burying that in a row of
            grey chips under a paragraph makes somebody read the paragraph
            and take its word for it, when the useful thing is the name to
            go and ask.
          */}
          {result.evidence.matchedFirms?.length > 0 ? (
            <div className="space-y-2">
              {result.evidence.matchedFirms.map((f) => (
                <div key={f.name} className="rounded-xl border border-[var(--ds-line)] p-3">
                  <p className="flex flex-wrap items-baseline gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-[var(--ds-ink)]">
                      <Building2 className="h-3.5 w-3.5 text-[var(--ds-muted)]" />
                      {f.name}
                    </span>
                    <span className="text-[12px] text-[var(--ds-muted)]">
                      {f.peopleWeKnow} {f.peopleWeKnow === 1 ? "person" : "people"} we know
                    </span>
                  </p>
                  {f.colleaguesWhoKnowThem.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {f.colleaguesWhoKnowThem.map((k) => (
                        <li
                          key={`${f.name}:${k.name}`}
                          className="flex flex-wrap items-baseline gap-2 text-[12.5px]"
                        >
                          <span className="font-medium text-[var(--ds-ink)]">
                            {k.name ?? "Somebody here"}
                          </span>
                          <span className="text-[var(--ds-muted)]">
                            {k.people} {k.people === 1 ? "contact" : "contacts"} · {k.touches}{" "}
                            {k.touches === 1 ? "touch" : "touches"}
                            {k.lastAt ? ` · last ${new Date(k.lastAt).toLocaleDateString()}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-[12.5px] text-[var(--ds-muted)]">
                      Nobody here has a relationship there yet.
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          {result.evidence.matchedPeople?.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {result.evidence.matchedPeople.slice(0, 10).map((p) => (
                <span
                  key={p.name}
                  className="rounded-full border border-[var(--ds-line)] px-2.5 py-1 text-[12px] text-[var(--ds-muted)]"
                >
                  {p.name}
                  {p.yourTouches ? ` · ${p.yourTouches}` : ""}
                </span>
              ))}
            </div>
          ) : null}

          {result.evidence.timeline?.length > 0 ? (
            <ul className="space-y-1 border-t border-[var(--ds-line)] pt-2.5">
              {result.evidence.timeline.slice(0, 5).map((i, n) => (
                <li key={n} className="flex gap-2.5 text-[12.5px] leading-relaxed">
                  <span className="shrink-0 tabular-nums text-[var(--ds-faint)]">
                    {new Date(i.when).toLocaleDateString()}
                  </span>
                  <span className="min-w-0 flex-1 text-[var(--ds-muted)]">
                    {i.summary ?? i.kind}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {result.evidence.pages?.length > 0 ? (
            <ul className="space-y-1 border-t border-[var(--ds-line)] pt-2.5">
              {result.evidence.pages.map((p) => (
                <li
                  key={p.title}
                  className="flex gap-2 text-[12.5px] leading-relaxed text-[var(--ds-muted)]"
                >
                  <Search className="mt-0.5 h-3 w-3 shrink-0 text-[var(--ds-faint)]" />
                  <span className="min-w-0 truncate">{p.title}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setResult(null);
              setQ("");
              inputRef.current?.focus();
            }}
            className="text-[12px] font-medium text-[var(--ds-accent)] hover:underline"
          >
            Ask something else
          </button>
        </div>
      ) : null}
    </section>
  );
}
