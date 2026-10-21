"use client";

/**
 * WHERE THIS CONTACT CAME FROM.
 *
 * An Amber card is stitched together from an Apple contact, a Google contact,
 * an address somebody has been emailing, a Clay enrichment, and whatever was
 * typed by hand. That stitching is the product. It is also the thing a person
 * has no reason to trust unless they can see it, so this shows the seams:
 * which systems contributed, what each one actually said, and which of them
 * owns each field on the card right now.
 *
 * TRUST IS SHOWN AS A WORD, NOT A NUMBER. The server returns tiers 0 to 3 and
 * a label for each. "You" beats "your accounts" beats "amber" beats
 * "enrichment", and the colour follows the same order, so a field Clay guessed
 * never looks like a field the person typed.
 */

import { useEffect, useState } from "react";
import { getProvenance, type Provenance } from "@/lib/amber";

const TRUST_COLOR: Record<number, string> = {
  3: "var(--amber-300)", // you said it
  2: "var(--amber-400)", // your connected accounts
  1: "var(--amber-500)", // amber worked it out
  0: "var(--muted)", // an enrichment vendor guessed
};

export default function ProvenanceStrip({
  token,
  contactId,
}: {
  token: string;
  contactId: string;
}) {
  const [p, setP] = useState<Provenance | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setP(null);
    setFailed(false);
    setOpen(false);
    getProvenance(token, contactId)
      .then((r) => {
        if (!cancelled) setP(r);
      })
      .catch(() => {
        // A card is still a card without its receipts. Failing here must not
        // blank the panel it sits under.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token, contactId]);

  if (failed || !p) return null;

  return (
    <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--hair)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left text-xs leading-relaxed"
        style={{ color: "var(--muted)" }}
      >
        {p.summary}
        <span className="ml-1 underline">{open ? "hide" : "details"}</span>
      </button>

      {/* The badges are the at-a-glance answer: which systems know this person. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {[...new Map(p.sources.map((s) => [s.source, s])).values()].map((s) => (
          <span
            key={s.source}
            title={`${s.source} — ${s.trustLabel}`}
            className="rounded-full border px-2 py-0.5 text-[11px]"
            style={{ borderColor: "var(--hair)", color: TRUST_COLOR[s.trust] ?? "var(--muted)" }}
          >
            {s.source}
          </span>
        ))}
      </div>

      {open ? (
        <div className="mt-3 space-y-3">
          {p.fields.length > 0 ? (
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Who owns what
              </p>
              {p.fields.map((f) => (
                <p key={f.field} className="text-xs" style={{ color: "var(--ink)" }}>
                  <span style={{ color: "var(--muted)" }}>{f.field}</span>{" "}
                  <span style={{ color: TRUST_COLOR[f.trust] ?? "var(--muted)" }}>
                    {f.source}
                  </span>
                </p>
              ))}
            </div>
          ) : null}

          {p.sources.map((s, i) => {
            const bits = [
              s.contributed.name,
              s.contributed.company,
              ...s.contributed.emails,
              ...s.contributed.phones,
            ].filter(Boolean);
            if (bits.length === 0) return null;
            return (
              <div key={`${s.source}-${i}`}>
                <p className="mb-1 text-[11px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                  {s.source} sent
                </p>
                <p className="text-xs" style={{ color: "var(--ink)" }}>
                  {bits.join(" · ")}
                </p>
              </div>
            );
          })}

          <p className="text-[11px]" style={{ color: "var(--muted)" }}>
            Anchored by {p.identityKeys.email} email
            {p.identityKeys.email === 1 ? "" : "s"} and {p.identityKeys.phone} phone
            {p.identityKeys.phone === 1 ? "" : "s"}.
          </p>
        </div>
      ) : null}
    </div>
  );
}
