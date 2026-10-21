"use client";

/**
 * SOMEBODY'S ARTIFACT, RUNNING, FOR SOMEBODY ELSE.
 *
 * WHAT THIS IS FOR. A person builds a thing in Claude -- a deal-desk
 * calculator, a territory map, a pricing sheet -- and uses it every day. The
 * thing their team needs is THE THING, able to run. A page showing four
 * hundred lines of markup is a description of a tool, which is not a tool.
 *
 * IT RUNS IN A SANDBOX, AND THAT IS NOT OPTIONAL. This markup was written by
 * a colleague and imported from a file; rendering it in the app's own origin
 * would let anything in it read the session and act as whoever opened the
 * page. A sandboxed iframe with `srcDoc` gives it a null origin and no
 * access to this document, its storage or its cookies -- scripts run, and
 * they run in a box with nothing in it. allow-scripts is granted because an
 * artifact that cannot run is not an artifact; allow-same-origin is NOT,
 * because the two together re-open exactly the hole the sandbox closes.
 *
 * SOURCE IS ONE CLICK AWAY, and copy beside it, because "package it and use
 * it" means taking the file somewhere else -- back into Claude, into a repo,
 * into their own account -- and a thing you can only look at cannot be
 * taken.
 *
 * JSX IS SHOWN, NOT RUN. A React component needs a build step that does not
 * belong in a page viewer, and a half-rendered component would be worse than
 * honest source. The copy button is the feature there.
 */

import { useMemo, useState } from "react";
import { Check, Code2, Copy, Play } from "lucide-react";

/** The one fenced block an imported artifact's body is. */
export function readArtifact(body: string) {
  const m = String(body ?? "").match(/^```(html|svg|jsx|tsx)\n([\s\S]*?)\n```\s*$/);
  if (!m) return null;
  return { language: m[1], source: m[2] };
}

export default function ArtifactBody({ body }: { body: string }) {
  const art = useMemo(() => readArtifact(body), [body]);
  const runnable = art?.language === "html" || art?.language === "svg";
  const [showing, setShowing] = useState<"run" | "source">(runnable ? "run" : "source");
  const [copied, setCopied] = useState(false);

  if (!art) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(art.source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* a browser that refuses the clipboard is not an error worth a dialog */
    }
  };

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-2">
        {runnable ? (
          <>
            <button
              type="button"
              onClick={() => setShowing("run")}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] transition ${
                showing === "run"
                  ? "border-[var(--ds-accent)] text-[var(--ds-ink)]"
                  : "border-[var(--ds-line)] text-[var(--ds-muted)] hover:text-[var(--ds-ink)]"
              }`}
            >
              <Play className="h-3.5 w-3.5" />
              Run it
            </button>
            <button
              type="button"
              onClick={() => setShowing("source")}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] transition ${
                showing === "source"
                  ? "border-[var(--ds-accent)] text-[var(--ds-ink)]"
                  : "border-[var(--ds-line)] text-[var(--ds-muted)] hover:text-[var(--ds-ink)]"
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />
              Source
            </button>
          </>
        ) : (
          <span className="text-[12.5px] text-[var(--ds-muted)]">
            A {art.language.toUpperCase()} component. Copy it to use it where it builds.
          </span>
        )}

        <button
          type="button"
          onClick={copy}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--ds-line)] px-3 py-1 text-[12.5px] text-[var(--ds-muted)] transition hover:text-[var(--ds-ink)]"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy the file"}
        </button>
      </div>

      {showing === "run" && runnable ? (
        <iframe
          /*
           * NO allow-same-origin. With it, scripts inside could reach back
           * into this app as the person reading the page, which is the whole
           * risk of running a file somebody else wrote. Without it the frame
           * has a null origin: it draws, it runs, it reaches nothing here.
           */
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          srcDoc={art.source}
          title="Artifact"
          className="h-[640px] w-full rounded-xl border border-[var(--ds-line)] bg-white"
        />
      ) : (
        <pre className="max-h-[640px] overflow-auto rounded-xl border border-[var(--ds-line)] bg-[var(--ds-sunken,#faf8f5)] p-4 text-[12.5px] leading-relaxed">
          <code>{art.source}</code>
        </pre>
      )}
    </div>
  );
}
