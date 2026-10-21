"use client";

/**
 * ONE PIECE OF WORK, FULL SIZE, WITH SOMEBODY TO TALK TO ABOUT IT.
 *
 * WHY A ROW IN A LIST WAS NOT ENOUGH. An artifact is a thing you use, and a
 * 200px preview inside an accordion inside a tab is a thumbnail of a tool.
 * The slideshow somebody just built is meant to be LOOKED at; the tracker is
 * meant to be clicked around in. Both need the screen.
 *
 * AND THE FIRST VERSION IS NEVER RIGHT. The side chat is the whole point:
 * say what is wrong in a sentence, watch it change, say the next thing. That
 * is a different operation from building again -- building again throws away
 * everything that WAS right and rolls the dice, which is why "regenerate"
 * feels like gambling. Each revision is saved over the same page with the
 * instruction as its change note, so the history reads as the conversation
 * that produced it.
 *
 * THE PREVIEW IS STILL SANDBOXED. Bigger does not mean more trusted: this is
 * markup a colleague's assistant wrote, rendered with a null origin and no
 * access to this page, its storage or its session. Exactly the same frame as
 * the small one.
 */

import { useEffect, useRef, useState } from "react";
import { Code2, Loader2, Play, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui";
import { readArtifact } from "@/components/ArtifactBody";
import { getPage, reviseInCircle } from "@/lib/knowledge";
import ShareLink from "@/components/ShareLink";

type Turn = { from: "you" | "amber"; text: string };

export default function CircleStudio({
  circleId,
  pageId,
  title,
  onClose,
  onChanged,
}: {
  circleId: string;
  pageId: string;
  title: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [body, setBody] = useState<string | null>(null);
  const [showing, setShowing] = useState<"run" | "source">("run");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    getPage(pageId)
      .then((r) => alive && setBody(r.page.body ?? ""))
      .catch(() => alive && setBody(""));
    return () => {
      alive = false;
    };
  }, [pageId]);

  /* Escape closes it, because a full-screen panel that traps you is worse
     than no full-screen panel. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns.length, busy]);

  const art = body === null ? null : readArtifact(body);
  const runnable = art?.language === "html" || art?.language === "svg";

  const send = async () => {
    const text = draft.trim();
    if (text.length < 2 || busy) return;
    setDraft("");
    setTurns((t) => [...t, { from: "you", text }]);
    setBusy(true);
    try {
      const r = await reviseInCircle(circleId, pageId, text);
      setBody(r.page.body ?? "");
      setTurns((t) => [...t, { from: "amber", text: "Changed it. Have a look." }]);
      onChanged?.();
    } catch (e) {
      setTurns((t) => [
        ...t,
        {
          from: "amber",
          text:
            (e as { message?: string })?.message ??
            "That did not work. Try saying the change a different way.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--ds-bg)]">
      {/* ----------------------------------------------------------- head */}
      <div className="flex items-center gap-3 border-b border-[var(--ds-line)] bg-[var(--ds-card)] px-5 py-3">
        <Sparkles className="h-4 w-4 shrink-0 text-[var(--ds-accent)]" />
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--ds-ink)]">
          {title}
        </p>
        {runnable ? (
          <span className="flex gap-1">
            <Button tone={showing === "run" ? "primary" : "ghost"} onClick={() => setShowing("run")}>
              <Play className="h-3.5 w-3.5" />
              Run it
            </Button>
            <Button
              tone={showing === "source" ? "primary" : "ghost"}
              onClick={() => setShowing("source")}
            >
              <Code2 className="h-3.5 w-3.5" />
              Source
            </Button>
          </span>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1.5 text-[var(--ds-muted)] transition hover:text-[var(--ds-ink)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ------------------------------------------------------- the work */}
        <div className="min-w-0 flex-1 overflow-auto bg-[var(--ds-bg-deep,#eceef2)] p-4">
          {body === null ? (
            <p className="flex items-center gap-2 text-[13px] text-[var(--ds-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Opening…
            </p>
          ) : art && runnable && showing === "run" ? (
            <iframe
              /* No allow-same-origin. Bigger is not more trusted. */
              sandbox="allow-scripts allow-forms allow-popups allow-modals"
              srcDoc={art.source}
              title={title}
              className="h-full min-h-[70vh] w-full rounded-xl border border-[var(--ds-line)] bg-white"
            />
          ) : art ? (
            <pre className="rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] p-4 text-[12.5px] leading-relaxed">
              <code>{art.source}</code>
            </pre>
          ) : (
            <div className="mx-auto max-w-[760px] whitespace-pre-wrap rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] p-6 text-[14px] leading-relaxed text-[var(--ds-ink)]">
              {body || "Nothing in this one yet."}
            </div>
          )}
        </div>

        {/* ------------------------------------------------------- the chat */}
        <div className="flex w-[360px] shrink-0 flex-col border-l border-[var(--ds-line)] bg-[var(--ds-card)]">
          {/*
            SHARING SITS WITH THE THING, at the top of the panel where
            somebody has just finished getting it right -- which is the
            moment they want to send it to somebody.
          */}
          <div className="border-b border-[var(--ds-line)] p-3">
            <ShareLink pageId={pageId} />
          </div>

          <div className="border-b border-[var(--ds-line)] px-4 py-3">
            <p className="text-[12.5px] font-semibold text-[var(--ds-ink)]">Change it</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--ds-muted)]">
              Say what is wrong in a sentence. It keeps what works and saves each change over the
              same piece, so the history reads as this conversation.
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
            {turns.length === 0 ? (
              <div className="space-y-1.5">
                {[
                  "Make the headings bigger",
                  "Use our colours instead",
                  "Add a slide about pricing",
                  "Cut it to five points",
                ].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setDraft(s)}
                    className="block w-full rounded-lg border border-[var(--ds-line)] px-2.5 py-1.5 text-left text-[12px] text-[var(--ds-muted)] transition hover:border-[var(--ds-accent)] hover:text-[var(--ds-ink)]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              turns.map((t, i) => (
                <div
                  key={i}
                  className={`rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                    t.from === "you"
                      ? "ml-6 bg-[var(--ds-accent-soft,rgba(232,162,79,.16))] text-[var(--ds-ink)]"
                      : "mr-6 bg-[var(--ds-sunk,rgba(0,0,0,.04))] text-[var(--ds-muted)]"
                  }`}
                >
                  {t.text}
                </div>
              ))
            )}
            {busy ? (
              <p className="flex items-center gap-2 text-[12.5px] text-[var(--ds-muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Rewriting it. A minute is normal.
              </p>
            ) : null}
            <div ref={end} />
          </div>

          <div className="border-t border-[var(--ds-line)] p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                placeholder="What should change?"
                className="min-h-[46px] flex-1 resize-y rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] px-3 py-2 text-[13.5px] leading-relaxed outline-none focus:border-[var(--ds-accent-ring)]"
              />
              <Button tone="primary" busy={busy} disabled={draft.trim().length < 2} onClick={send}>
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
