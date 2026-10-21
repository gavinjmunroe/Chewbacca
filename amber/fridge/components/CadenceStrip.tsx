"use client";

/**
 * HOW OFTEN YOU TWO ARE ACTUALLY IN TOUCH.
 *
 * The companion to ProvenanceStrip: that one says where a card came from, this
 * one says what the relationship behind it looks like. Both read endpoints that
 * compute nothing new -- the rollup already wrote these numbers -- and both
 * show their working rather than asking to be believed.
 *
 * THE SENTENCE LEADS, the numbers follow. "In touch about weekly, mostly over
 * email, across 2 of your accounts" is what a person wants; the per-channel
 * counts are for the moment they want to check it. A card that opened with a
 * grid of counts would be a report, and nobody reads a report about their
 * friend.
 *
 * NO MESSAGE CONTENT REACHES THIS COMPONENT, because none reaches the endpoint.
 * Everything here is a count and a timestamp.
 */

import { useEffect, useState } from "react";
import { getCadence, type Cadence } from "@/lib/amber";

const TREND_MARK: Record<string, string> = {
  warming: "↑",
  cooling: "↓",
  steady: "",
};

const TREND_COLOR: Record<string, string> = {
  warming: "var(--amber-300)",
  cooling: "var(--muted)",
  steady: "var(--muted)",
};

function whenLast(days: number | null): string {
  if (days == null) return "never";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

export default function CadenceStrip({
  token,
  contactId,
}: {
  token: string;
  contactId: string;
}) {
  const [c, setC] = useState<Cadence | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setC(null);
    setFailed(false);
    getCadence(token, contactId)
      .then((r) => live && setC(r))
      // A cadence is an embellishment on a card. If it will not load, the card
      // shows without it rather than showing an error about a thing the person
      // did not ask for.
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [token, contactId]);

  if (failed || !c) return null;
  if (!c.total.countAll) return null;

  return (
    <div style={{ fontSize: 12, lineHeight: 1.5 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "block",
          color: "var(--fg)",
          opacity: 0.85,
        }}
        title="Frequency of contact. Click for the breakdown."
      >
        <span style={{ color: TREND_COLOR[c.rhythm.trend] }}>
          {TREND_MARK[c.rhythm.trend]}
        </span>{" "}
        {c.summary}
      </button>

      {open && (
        <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
          {c.channels.map((ch) => (
            <div
              key={ch.channel}
              style={{ display: "flex", justifyContent: "space-between", opacity: 0.8 }}
            >
              <span>
                {ch.label}
                {ch.accounts > 1 ? ` · ${ch.accounts} accounts` : ""}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {ch.count90d} in 90d · {ch.countAll} all time
              </span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.6 }}>
            <span>last</span>
            <span>{whenLast(c.total.daysSinceLast)}</span>
          </div>
          {c.reciprocity && (
            <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.6 }}>
              <span>you sent / they sent</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {c.reciprocity.outbound} / {c.reciprocity.inbound}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
