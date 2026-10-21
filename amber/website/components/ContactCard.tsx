"use client";

/**
 * THE CARD, SLIDING IN FROM THE RIGHT.
 *
 * What this replaced rendered `Object.entries(card)` as labelled rows, which is
 * how "summary: 1 phone" ended up on screen looking like a field somebody had
 * filled in. A debug dump is a reasonable thing to build first and a bad thing
 * to leave: this is the one surface where somebody decides whether they trust
 * the record, so it has to read like a card rather than like a table.
 *
 * WHAT IT SHOWS, in the order somebody asks for it: who they are, what you know
 * about them (facts), what you have done together (experiences), how often you
 * are in touch, and last of all where the record came from -- provenance is
 * about the record rather than the person, and it is the least interesting of
 * the five until somebody doubts the other four.
 *
 * IT FLAGS THE FIXTURE. A test double wrote "Product Manager at Globex in New
 * York" onto real people, and a card showing that without comment is asserting
 * something false. See looksLikeStubEnrichment.
 */

import { useEffect, useState } from "react";
import CadenceStrip from "@/components/CadenceStrip";
import DimensionWheel from "@/components/DimensionWheel";
import ProvenanceStrip from "@/components/ProvenanceStrip";
import {
  displayName,
  getCard,
  getExperiences,
  getFacts,
  type Contact,
  type ContactCardPayload,
  type Experience,
  type Fact,
} from "@/lib/amber";
import {
  experienceTitle,
  factText,
  looksLikeStubEnrichment,
  shortDate,
  usableExperiences,
  usableFacts,
} from "@/lib/card";
import { initialsOf } from "@/lib/constellation";

export default function ContactCard({
  token,
  contact,
  onClose,
}: {
  token: string | null;
  contact: Contact;
  onClose: () => void;
}) {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [profile, setProfile] = useState<ContactCardPayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Five is enough to know the shape of what is on file; the rest is one tap
  // away. Reset per contact so opening a second card does not inherit the
  // first one's expansion.
  const [showAllFacts, setShowAllFacts] = useState(false);
  const [showAllExperiences, setShowAllExperiences] = useState(false);

  const id = String(contact.id);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoaded(false);
    setFacts([]);
    setExperiences([]);
    setProfile(null);
    setShowAllFacts(false);
    setShowAllExperiences(false);
    // Any of the three can 403 on an older token minted before the scope
    // widening, and a card missing one section is far better than a card that
    // fails to open.
    Promise.allSettled([getFacts(token, id), getExperiences(token, id), getCard(token, id)]).then(
      ([f, e, p]) => {
        if (cancelled) return;
        if (f.status === "fulfilled") setFacts(f.value.facts ?? []);
        if (e.status === "fulfilled") setExperiences(e.value.experiences ?? []);
        if (p.status === "fulfilled") setProfile(p.value);
        setLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, id]);

  const allFacts = usableFacts(facts);
  const allExperiences = usableExperiences(experiences);
  const shownFacts = showAllFacts ? allFacts : allFacts.slice(0, FIRST_PAGE);
  const shownExperiences = showAllExperiences
    ? allExperiences
    : allExperiences.slice(0, FIRST_PAGE);
  const suspect = looksLikeStubEnrichment(contact);
  const rank = profile?.rank ?? null;

  return (
    <aside
      key={id}
      className="amber-card-in absolute right-0 top-0 z-40 flex h-full w-[22rem] flex-col border-l"
      /*
        THIS PANEL WAS STILL A DARK ROOM.
        
        The page moved to a light ground and the ink moved with it, but this
        one hardcoded brown did not -- so near-black text was being drawn on
        near-black brown. Every word in the card was there and none of it was
        legible, which is worse than a blank panel: it looks like a rendering
        bug rather than a colour one, so nobody goes looking for a colour.
      */
      style={{ background: "var(--ds-card)", borderColor: "var(--ds-line)" }}
      aria-label={`${displayName(contact)} card`}
    >
      <div className="flex items-start gap-3 border-b px-5 py-4" style={{ borderColor: "var(--ds-line)" }}>
        <span
          aria-hidden
          style={{
            flex: "0 0 auto",
            width: 44,
            height: 44,
            borderRadius: 999,
            background: "var(--ds-accent-soft)",
            color: "var(--ds-accent-ink)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          {initialsOf(displayName(contact))}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl" style={{ color: "var(--ds-ink)" }}>
            {displayName(contact)}
          </h2>
          {contact.title || contact.company ? (
            <p className="truncate text-sm" style={{ color: "var(--ds-muted)" }}>
              {[contact.title, contact.company].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        <button onClick={onClose} style={{ color: "var(--ds-muted)" }} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {suspect ? (
          <p
            className="mb-4 rounded-lg px-3 py-2 text-xs"
            style={{ border: "1px solid var(--ds-accent-ring)", background: "var(--ds-accent-soft)", color: "var(--ds-accent-ink)", lineHeight: 1.5 }}
          >
            The job title, company and city on this card match a test fixture
            that was run against your book. Treat them as unverified.
          </p>
        ) : null}

        <Detail label="City" value={contact.city} />
        <Detail label="Email" value={contact.emails?.[0]} />
        <Detail label="Phone" value={contact.phoneNumbers?.[0]} />

        <Section title="Relationship">
          {!loaded ? (
            <Muted>Loading…</Muted>
          ) : (
            <>
              {rank ? (
                <div className="mb-3">
                  <div className="flex items-baseline gap-2">
                    <span style={{ color: "var(--ds-ink)", fontSize: 26, lineHeight: 1 }}>
                      {Math.round((rank.score ?? 0) * 100)}
                    </span>
                    <span style={{ color: "var(--ds-muted)", fontSize: 12 }}>
                      PeopleRank · out of 100
                    </span>
                  </div>
                  {/* What the number is made of, since a bare score invites
                      exactly the question this whole session has been about. */}
                  <div className="mt-1 flex flex-wrap gap-x-3" style={{ fontSize: 11, color: "var(--ds-muted)" }}>
                    <span>warmth {Math.round((rank.warmth ?? 0) * 100)}</span>
                    <span>record {Math.round((rank.completeness ?? 0) * 100)}% complete</span>
                    <span>
                      {rank.observationCount ?? 0}{" "}
                      {(rank.observationCount ?? 0) === 1 ? "fact" : "facts"} on file
                    </span>
                  </div>
                </div>
              ) : null}
              <DimensionWheel
                scores={profile?.dimensions?.scores ?? {}}
                computed={Boolean(profile?.dimensions?.computed)}
              />
            </>
          )}
        </Section>

        <Section title="What you know">
          {!loaded ? (
            <Muted>Loading…</Muted>
          ) : allFacts.length === 0 ? (
            <Muted>Nothing recorded about this person yet.</Muted>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {shownFacts.map((f, i) => (
                  <li key={f.id ?? i} className="text-sm" style={{ color: "var(--ds-ink)", lineHeight: 1.45 }}>
                    {factText(f)}
                    {shortDate(f.observed_at) ? (
                      <span style={{ color: "var(--ds-muted)", fontSize: 11 }}> · {shortDate(f.observed_at)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <More
                total={allFacts.length}
                shown={shownFacts.length}
                expanded={showAllFacts}
                onToggle={() => setShowAllFacts((v) => !v)}
              />
            </>
          )}
        </Section>

        <Section title="Together">
          {!loaded ? (
            <Muted>Loading…</Muted>
          ) : allExperiences.length === 0 ? (
            <Muted>Nothing shared recorded yet.</Muted>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {shownExperiences.map((e, i) => (
                  <li key={e.id ?? i} className="text-sm" style={{ color: "var(--ds-ink)", lineHeight: 1.45 }}>
                    {experienceTitle(e)}
                    {shortDate(e.occurred_at ?? e.starts_at) ? (
                      <span style={{ color: "var(--ds-muted)", fontSize: 11 }}>
                        {" "}
                        · {shortDate(e.occurred_at ?? e.starts_at)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <More
                total={allExperiences.length}
                shown={shownExperiences.length}
                expanded={showAllExperiences}
                onToggle={() => setShowAllExperiences((v) => !v)}
              />
            </>
          )}
        </Section>

        {token ? (
          <div className="mt-5 space-y-4 border-t pt-4" style={{ borderColor: "var(--ds-line)" }}>
            <CadenceStrip token={token} contactId={id} />
            <ProvenanceStrip token={token} contactId={id} />
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/** How many rows a section shows before asking. */
const FIRST_PAGE = 5;

function More({
  total,
  shown,
  expanded,
  onToggle,
}: {
  total: number;
  shown: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (total <= FIRST_PAGE) return null;
  return (
    <button
      onClick={onToggle}
      className="mt-2 text-xs underline"
      style={{ color: "var(--ds-muted)" }}
    >
      {expanded ? "Show fewer" : `Read ${total - shown} more`}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <p className="mb-2 text-xs uppercase tracking-wide" style={{ color: "var(--ds-muted)" }}>
        {title}
      </p>
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm" style={{ color: "var(--ds-muted)" }}>
      {children}
    </p>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <p className="mb-1 text-sm" style={{ color: "var(--ds-ink)" }}>
      <span style={{ color: "var(--ds-muted)" }}>{label}: </span>
      {value}
    </p>
  );
}
