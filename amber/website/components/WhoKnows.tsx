"use client";

/**
 * WHO KNOWS ABOUT THIS — the question the whole enterprise side exists to
 * answer, and the one an org chart has never been able to.
 *
 * AN ORG CHART ANSWERS A DIFFERENT QUESTION. It says who reports to whom, which
 * tells you who is accountable and nothing at all about who has actually done
 * the thing you are about to do. In a company past about eighty people those
 * two stop overlapping, and the cost of the gap is somebody spending a week
 * rebuilding work that already exists three desks away.
 *
 * SO THE RANKING IS DERIVED, NOT DECLARED. A self-reported skills field is a
 * record of what somebody believed about themselves in their first fortnight.
 * What is here instead is: who has written the pages on this subject, and whose
 * answers about it were accepted by the person who asked. Both are things they
 * did rather than things they said.
 *
 * AND THE EVIDENCE IS SHOWN WITH THE RANK. "Third" is a number nobody acts on.
 * "Third, because they wrote 6,000 characters of the pricing runbook and had
 * two answers accepted" is a sentence that survives being questioned -- and
 * when the ranking is wrong, which it sometimes will be, the evidence is what
 * lets somebody see that immediately rather than trusting it and being misled.
 */

import { useCallback, useEffect, useState } from "react";
import { AmberError } from "@/lib/amber";
import {
  ago,
  getExperts,
  getPerson,
  initials,
  saveMyProfile,
  type Expert,
  type PageSummary,
} from "@/lib/knowledge";
import { Btn, Card, Err, Input, Tag } from "@/components/Ent";

export function WhoKnows({ onOpenPerson }: { onOpenPerson?: (id: string) => void }) {
  const [topic, setTopic] = useState("");
  const [experts, setExperts] = useState<Expert[] | null>(null);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const t = topic.trim();
    if (t.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const r = await getExperts(t);
      setExperts(r.experts);
      setPages(r.pages);
    } catch (err) {
      setError(err instanceof AmberError ? err.message : "Could not work that out.");
    } finally {
      setBusy(false);
    }
  }

  const top = experts?.[0]?.score ? Number(experts[0].score) : 0;

  return (
    <Card
      title="Who knows about…"
      note="Worked out from what people have written and answered here, not from a skills field. Ask the way you would ask a colleague."
    >
      <Err>{error}</Err>
      <form onSubmit={ask} className="flex flex-wrap gap-2">
        <Input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="pricing · SOC 2 · the Paychex account · onboarding"
          className="min-w-[240px] flex-1"
        />
        <Btn type="submit" disabled={busy || topic.trim().length < 2}>{busy ? "…" : "Find out"}</Btn>
      </form>

      {experts === null ? null : experts.length === 0 ? (
        <p className="mt-5 text-sm" style={{ color: "var(--ent-dim)" }}>
          Nobody here has written or answered anything about that yet. That is itself an answer:
          it is not written down, and the first person to work it out should write the page.
        </p>
      ) : (
        <div className="mt-5 space-y-1">
          {experts.map((x, i) => (
            <button
              key={x.amber_id}
              onClick={() => onOpenPerson?.(x.amber_id)}
              className="ent-row flex w-full flex-wrap items-center gap-3 px-2 py-3 text-left"
            >
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs"
                style={{
                  background: i === 0 ? "var(--ent-accent)" : "var(--ent-accent-soft)",
                  color: i === 0 ? "#fff" : "var(--ent-accent)",
                }}
              >
                {initials(x.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm" style={{ color: "var(--ent-ink)" }}>
                  {x.name ?? "Unknown"}
                  {x.title ? <span style={{ color: "var(--ent-dim)" }}> · {x.title}</span> : null}
                </span>
                {/* The evidence, in the words it is made of. */}
                <span className="block text-xs" style={{ color: "var(--ent-muted)" }}>
                  {x.chars_written
                    ? `wrote ${x.chars_written.toLocaleString()} characters on this`
                    : "has not written about it"}
                  {x.accepted_answers ? ` · ${x.accepted_answers} answer${x.accepted_answers === 1 ? "" : "s"} accepted` : ""}
                  {!x.accepted_answers && x.answers ? ` · ${x.answers} answer${x.answers === 1 ? "" : "s"}` : ""}
                </span>
              </span>
              <span
                className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full"
                style={{ background: "var(--ent-line)" }}
              >
                <span
                  className="block h-full"
                  style={{
                    width: `${top ? Math.max(6, (Number(x.score) / top) * 100) : 0}%`,
                    background: "var(--ent-accent)",
                  }}
                />
              </span>
            </button>
          ))}
        </div>
      )}

      {pages.length ? (
        <div className="mt-6">
          <p className="mb-2 text-xs uppercase tracking-wider" style={{ color: "var(--ent-dim)" }}>
            And it is written down here
          </p>
          {pages.map((p) => (
            <div key={p.id} className="ent-row flex items-baseline justify-between gap-3 px-2 py-2">
              <span className="text-sm" style={{ color: "var(--ent-ink)" }}>{p.title}</span>
              <span className="text-xs" style={{ color: "var(--ent-dim)" }}>{ago(p.updated_at)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * ONE PERSON, AND WHAT THEY HAVE ACTUALLY DONE HERE.
 *
 * The three fields at the top are what they wrote about themselves. Everything
 * below is what the company's own record says. Keeping those visibly apart is
 * the point: the first is a claim and the second is evidence, and a profile
 * that blends them lets the claim borrow the evidence's credibility.
 */
export function PersonCard({ amberId, onClose }: { amberId: string; onClose: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getPerson>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPerson(amberId)
      .then(setData)
      .catch((e) => setError(e instanceof AmberError ? e.message : "Could not open that profile."));
  }, [amberId]);

  if (error) return <Err>{error}</Err>;
  if (!data) return <p style={{ color: "var(--ent-dim)" }}>Loading…</p>;

  const t = data.totals;

  return (
    <Card
      title={data.member.fullName ?? "Someone"}
      note={[data.member.title, data.member.location].filter(Boolean).join(" · ") || undefined}
      action={<Btn tone="quiet" onClick={onClose}>Close</Btn>}
    >
      {data.member.bio ? (
        <p className="mb-5 text-sm leading-relaxed" style={{ color: "var(--ent-muted)" }}>
          {data.member.bio}
        </p>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-6">
        <Fact n={t?.pages_touched ?? 0} label="pages written on" />
        <Fact n={t?.chars_written ?? 0} label="characters contributed" />
        <Fact n={t?.answers ?? 0} label="answers" />
        <Fact n={t?.accepted_answers ?? 0} label="accepted" />
      </div>

      {data.pages.length ? (
        <>
          <p className="mb-1 text-xs uppercase tracking-wider" style={{ color: "var(--ent-dim)" }}>
            Pages
          </p>
          {data.pages.map((p) => (
            <div key={p.id} className="ent-row flex flex-wrap items-baseline justify-between gap-2 px-2 py-2">
              <span className="text-sm" style={{ color: "var(--ent-ink)" }}>{p.title}</span>
              <span className="text-xs" style={{ color: "var(--ent-dim)" }}>
                {p.chars_added.toLocaleString()} chars · {p.edits} edit{p.edits === 1 ? "" : "s"} · {ago(p.last_edit)}
              </span>
            </div>
          ))}
        </>
      ) : null}

      {data.answers.length ? (
        <>
          <p className="mb-1 mt-6 text-xs uppercase tracking-wider" style={{ color: "var(--ent-dim)" }}>
            Answers
          </p>
          {data.answers.map((a) => (
            <div key={a.id} className="ent-row px-2 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm" style={{ color: "var(--ent-ink)" }}>
                  {a.question_title ?? "A question"}
                </span>
                {a.accepted_at ? <Tag on>Accepted</Tag> : null}
              </div>
              <p className="mt-1 line-clamp-2 text-xs" style={{ color: "var(--ent-muted)" }}>{a.body}</p>
            </div>
          ))}
        </>
      ) : null}

      {!data.pages.length && !data.answers.length ? (
        <p className="text-sm" style={{ color: "var(--ent-dim)" }}>
          Nothing contributed here yet.
        </p>
      ) : null}
    </Card>
  );
}

function Fact({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="text-2xl" style={{ color: "var(--ent-ink)" }}>{n.toLocaleString()}</div>
      <div className="text-xs" style={{ color: "var(--ent-dim)" }}>{label}</div>
    </div>
  );
}

/** The three fields somebody writes about themselves. */
export function MyProfile({
  initial,
  onSaved,
}: {
  initial: { title?: string | null; location?: string | null; bio?: string | null };
  onSaved?: () => void;
}) {
  const [title, setTitle] = useState(initial.title ?? "");
  const [location, setLocation] = useState(initial.location ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await saveMyProfile({ title: title.trim() || null, location: location.trim() || null, bio: bio.trim() || null });
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError(e instanceof AmberError ? e.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }, [title, location, bio, onSaved]);

  return (
    <Card
      title="How you appear here"
      note="Three fields, and that is on purpose — a directory with twenty optional fields is a directory where nineteen are empty. What you know is worked out from what you write, not from a list you fill in."
      action={<Btn onClick={save} disabled={busy}>{busy ? "…" : saved ? "Saved" : "Save"}</Btn>}
    >
      <Err>{error}</Err>
      <div className="space-y-3">
        <Input
          value={title}
          onChange={(e) => { setSaved(false); setTitle(e.target.value); }}
          placeholder="Your title, as you would say it"
          className="w-full"
        />
        <Input
          value={location}
          onChange={(e) => { setSaved(false); setLocation(e.target.value); }}
          placeholder="Where you are"
          className="w-full"
        />
        <Input
          value={bio}
          onChange={(e) => { setSaved(false); setBio(e.target.value); }}
          placeholder="One line: what you work on, and what people should come to you for"
          className="w-full"
        />
      </div>
    </Card>
  );
}
