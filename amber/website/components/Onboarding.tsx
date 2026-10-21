"use client";

/**
 * SETTING UP A COMPANY, IN FOUR STEPS THAT EACH LEAVE SOMETHING BEHIND.
 *
 * THE FAILURE A SETUP FLOW USUALLY HAS is that it collects configuration. You
 * answer six questions, press Finish, and arrive at an empty product that now
 * knows your seat count. Nothing you did made the thing you came for exist.
 *
 * So every step here PRODUCES something, and the product is visibly fuller
 * when it ends than when it began:
 *
 *   YOU        the company, its domain, and what it does -- the domain is the
 *              step that makes colleagues able to arrive at all
 *   MEMORY     connect a calendar, and the relationship graph builds itself
 *              from meetings that already happened
 *   WORK       drop an assistant export, and a year of written work becomes
 *              pages -- private, until you say otherwise
 *   PEOPLE     invite the colleagues the graph already found, because by now
 *              we know who they are
 *
 * THE ORDER IS NOT ARBITRARY. Invitations come last because by then there is
 * something to invite people INTO, and because the graph can tell you who to
 * invite -- it has their addresses from your own calendar. A flow that asks
 * for email addresses first is asking you to remember what it could have told
 * you.
 *
 * EVERY STEP IS SKIPPABLE AND NOTHING IS LOST. Somebody who skips the calendar
 * gets a product that works less well today and is never blocked; the same
 * buttons live on the screens afterwards. A setup flow that cannot be escaped
 * is one people abandon at the step they cannot answer.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  Loader2,
  Mail,
  Sparkles,
  Users,
} from "lucide-react";
import { Badge, Button, Panel, TextField, TextArea } from "@/components/ui";
import { createInvite, updateOrg } from "@/lib/org";
import { listMyCalendars, startRelationshipConnect } from "@/lib/workspace";
import { listPeople, syncMemory, type PersonRow } from "@/lib/memory";
import { tokenNow } from "@/lib/amber";
import AiImport from "@/components/AiImport";

type Step = "you" | "memory" | "work" | "people";

const STEPS: { key: Step; label: string; icon: typeof Building2 }[] = [
  { key: "you", label: "Your company", icon: Building2 },
  { key: "memory", label: "Relationships", icon: CalendarDays },
  { key: "work", label: "Your work", icon: Sparkles },
  { key: "people", label: "Your team", icon: Users },
];

export default function Onboarding({
  org,
  groups = [],
  startAt = null,
  onStep,
  onDone,
}: {
  org: { id: string; name: string; emailDomain?: string | null; description?: string | null };
  groups?: { id: string; name: string }[];
  /** Resume here. The calendar step leaves the page and comes back. */
  startAt?: string | null;
  onStep?: (step: Step) => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<Step>(
    STEPS.some((s) => s.key === startAt) ? (startAt as Step) : "you",
  );
  const index = STEPS.findIndex((s) => s.key === step);

  /*
   * EVERY MOVE IS REMEMBERED, including the first render.
   *
   * The calendar step sends the browser to Google and back through a full
   * reload, so a step held only in React state is a step that does not
   * survive the thing the step itself does. Reporting it on mount as well
   * means somebody who closes the tab on step three reopens on step three.
   */
  useEffect(() => {
    onStep?.(step);
  }, [step, onStep]);

  const go = (next: Step) => setStep(next);
  const advance = () => {
    const n = STEPS[index + 1];
    if (n) setStep(n.key);
    else onDone();
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      {/*
        THE RAIL SHOWS WHERE YOU ARE AND LETS YOU GO BACK. A flow that only
        moves forward makes people answer carefully instead of quickly, which
        is the opposite of what a setup should feel like.
      */}
      <div className="mb-7 flex items-center gap-1.5">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const done = i < index;
          const here = i === index;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => i <= index && go(s.key)}
              disabled={i > index}
              className={`flex flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition ${
                here
                  ? "bg-[var(--ds-accent-soft)] text-[var(--ds-ink)]"
                  : done
                    ? "text-[var(--ds-muted)] hover:bg-[var(--ds-hover)]"
                    : "text-[var(--ds-faint)]"
              }`}
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-md ${
                  done
                    ? "bg-[var(--ds-accent)] text-white"
                    : here
                      ? "bg-[var(--ds-accent)] text-white"
                      : "bg-[var(--ds-hover)] text-[var(--ds-faint)]"
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
              </span>
              <span className="truncate font-medium">{s.label}</span>
            </button>
          );
        })}
      </div>

      {step === "you" ? <You org={org} onNext={advance} /> : null}
      {step === "memory" ? <Memory onNext={advance} /> : null}
      {step === "work" ? <Work groups={groups} onNext={advance} /> : null}
      {step === "people" ? <People domain={org.emailDomain ?? null} onNext={onDone} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ step 1 */

function You({
  org,
  onNext,
}: {
  org: { name: string; emailDomain?: string | null; description?: string | null };
  onNext: () => void;
}) {
  const [name, setName] = useState(org.name ?? "");
  const [domain, setDomain] = useState(org.emailDomain ?? "");
  const [description, setDescription] = useState(org.description ?? "");
  const [linkedin, setLinkedin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateOrg(tokenNow() ?? "", {
        name: name.trim(),
        emailDomain: domain.trim() ? domain.trim().replace(/^@/, "").toLowerCase() : null,
        description: description.trim() || null,
        linkedinUrl: linkedin.trim() || null,
      });
      onNext();
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Could not save that.");
      setBusy(false);
    }
  };

  return (
    <Panel className="p-6">
      <h2 className="text-[17px] font-semibold text-[var(--ds-ink)]">Your company</h2>
      <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-[var(--ds-muted)]">
        Two of these matter. The rest can wait.
      </p>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="text-[12.5px] font-medium text-[var(--ds-ink)]">Company name</span>
          <TextField
            className="mt-1.5"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Blue Modern Advisory"
          />
        </label>

        <label className="block">
          <span className="text-[12.5px] font-medium text-[var(--ds-ink)]">Email domain</span>
          <TextField
            className="mt-1.5"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="bluemodernadvisory.com"
          />
          {/*
            THE CONSEQUENCE, STATED. This is the field that decides whether a
            colleague who signs up lands in this company or in an empty
            product of their own, and that outcome is not guessable from the
            words "email domain".
          */}
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--ds-muted)]">
            {domain.trim() ? (
              <>
                Anyone who signs in with an <strong>@{domain.trim().replace(/^@/, "")}</strong>{" "}
                address joins this company automatically. Without it, colleagues who sign up land
                in an empty workspace of their own and you have to invite each one.
              </>
            ) : (
              "Claim it and colleagues join by signing in. Leave it blank and every person needs an invitation."
            )}
          </p>
        </label>

        <label className="block">
          <span className="text-[12.5px] font-medium text-[var(--ds-ink)]">
            What does this company do?
          </span>
          <TextArea
            className="mt-1.5"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Go-to-market engineering for B2B software companies."
          />
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--ds-muted)]">
            One line. It is what tells Amber whether &ldquo;call with Harris at Para&rdquo; is a
            fundraise, a customer or a candidate.
          </p>
        </label>

        <label className="block">
          <span className="text-[12.5px] font-medium text-[var(--ds-ink)]">
            LinkedIn <span className="text-[var(--ds-faint)]">· optional</span>
          </span>
          <TextField
            className="mt-1.5"
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
            placeholder="linkedin.com/company/…"
          />
        </label>
      </div>

      {error ? <p className="mt-3 text-[12.5px] text-[var(--ds-danger)]">{error}</p> : null}

      <div className="mt-5 flex items-center gap-2">
        <Button tone="primary" busy={busy} onClick={save} disabled={!name.trim()}>
          Continue
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ step 2 */

/**
 * THE STEP THAT MAKES THE PRODUCT EXIST.
 *
 * Everything else in Amber reads the relationship ledger, and the ledger is
 * built from meetings that already happened. Until a calendar is connected
 * there is nothing to read, which is why this is second and not last.
 */
function Memory({ onNext }: { onNext: () => void }) {
  const [phase, setPhase] = useState<"checking" | "connect" | "building" | "done">("checking");
  const [result, setResult] = useState<{ people: number; mine: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const build = useCallback(async () => {
    setPhase("building");
    setError(null);
    try {
      const out = await syncMemory();
      if (!out.ok) {
        setError(out.hint ?? "That source is not available for this company.");
        setPhase("connect");
        return;
      }
      setResult({ people: out.people ?? 0, mine: out.mine ?? 0 });
      setPhase("done");
    } catch {
      setError("The sync did not finish. Try again in a moment.");
      setPhase("connect");
    }
  }, []);

  /*
   * IF A CALENDAR IS ALREADY CONNECTED, BUILD. No button asking somebody to
   * confirm a fact we can read -- including the person who just came back
   * from Google thirty seconds ago.
   */
  useEffect(() => {
    let alive = true;
    listMyCalendars()
      .then((r) => {
        if (!alive) return;
        if ((r?.calendars ?? []).length > 0) void build();
        else setPhase("connect");
      })
      .catch(() => alive && setPhase("connect"));
    return () => {
      alive = false;
    };
  }, [build]);

  const connect = async () => {
    try {
      /*
       * BACK INTO SETUP, not to the console. The return path is what the
       * OAuth callback redirects to, and sending it to /org meant the
       * person came back past the flow they were in the middle of.
       */
      /*
       * CALENDAR AND MAIL IN ONE CONSENT.
       *
       * Onboarding asked for the calendar alone, so everybody arrived with a
       * graph built from guest lists -- and a guest list is addresses. The
       * names live in mail headers. Asking for both here is the difference
       * between a network of people and a network of mailbox strings, and it
       * is one Google screen either way.
       */
      const { authorize_url } = await startRelationshipConnect("/org?setup=1");
      window.location.href = authorize_url;
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Could not start the connection.");
    }
  };

  return (
    <Panel className="p-6">
      <h2 className="text-[17px] font-semibold text-[var(--ds-ink)]">Your relationships</h2>
      <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-[var(--ds-muted)]">
        Connect your calendar and mail and the graph builds itself from what you have already
        done. Nobody types anything in. Mail is read-only and headers only — who you wrote to and
        when, never a subject or a body — and it is where almost every name comes from.
      </p>

      {phase === "checking" || phase === "building" ? (
        <div className="mt-6 flex items-center gap-2.5 text-[13px] text-[var(--ds-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {phase === "building" ? "Reading three years of meetings…" : "Checking…"}
        </div>
      ) : null}

      {phase === "connect" ? (
        <div className="mt-5">
          <Button tone="primary" onClick={connect}>
            <CalendarDays className="h-3.5 w-3.5" />
            Connect Google Calendar
          </Button>
          {error ? <p className="mt-3 text-[12.5px] text-[var(--ds-danger)]">{error}</p> : null}
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--ds-dim)]">
            Read-only. Amber keeps who you met and when, never what a meeting was about, unless you
            publish it.
          </p>
        </div>
      ) : null}

      {phase === "done" && result ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <Stat n={result.people} label="people" />
            <Stat n={result.mine} label="of them yours" />
          </div>
          <p className="mt-3 max-w-prose text-[12.5px] leading-relaxed text-[var(--ds-muted)]">
            {result.people > 0
              ? "That is your network, built from your own calendar. Everyone who joins adds theirs, and the overlap is the part nobody could see before."
              : "Nothing came back — the connected calendar may have no past meetings with other people on them."}
          </p>
        </div>
      ) : null}

      <div className="mt-6 flex items-center gap-2">
        <Button tone={phase === "done" ? "primary" : "quiet"} onClick={onNext}>
          {phase === "done" ? "Continue" : "Skip for now"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </Panel>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[26px] font-semibold tabular-nums text-[var(--ds-ink)]">{n}</span>
      <span className="text-[12.5px] text-[var(--ds-muted)]">{label}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ step 3 */

function Work({ groups, onNext }: { groups: { id: string; name: string }[]; onNext: () => void }) {
  return (
    <Panel className="p-6">
      <h2 className="text-[17px] font-semibold text-[var(--ds-ink)]">Your work</h2>
      <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-[var(--ds-muted)]">
        Drop a Claude or ChatGPT export. Amber finds the documents in it — specs, plans, teardowns
        — and leaves the chat where it is. Everything lands private to you.
      </p>

      <div className="mt-5">
        <AiImport groups={groups} />
      </div>

      <div className="mt-6">
        <Button onClick={onNext}>
          Skip for now
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ step 4 */

/**
 * INVITATIONS LAST, AND PRE-FILLED FROM THE GRAPH.
 *
 * By this point the calendar has told us who this person's colleagues are --
 * the internal people, on the company's own domain, who have not joined yet.
 * Asking them to type addresses they have already given us would be the
 * product failing to use the one thing it just built.
 */
function People({ domain, onNext }: { domain: string | null; onNext: () => void }) {
  const [suggested, setSuggested] = useState<PersonRow[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [sent, setSent] = useState<{ email: string; link: string; emailed: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listPeople({ scope: "internal" })
      .then((rows) => {
        if (!alive) return;
        // Colleagues the graph knows about who have no account here yet.
        setSuggested(rows.filter((p) => !p.member_amber_id));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const invite = async (address: string) => {
    const clean = address.trim().toLowerCase();
    if (!clean) return;
    setBusy(true);
    setError(null);
    try {
      const out = await createInvite(tokenNow() ?? "", clean, role);
      setSent((s) => [...s, { email: clean, link: out.acceptUrl, emailed: out.emailed }]);
      setEmail("");
      setSuggested((s) => s.filter((p) => !nameOf(p).includes(clean)));
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setError(
        err?.code === "already_invited"
          ? "There is already a live invitation to that address."
          : err?.code === "domain_mismatch"
            ? `This company only admits @${domain} addresses.`
            : (err?.message ?? "Could not send that invitation."),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="p-6">
      <h2 className="text-[17px] font-semibold text-[var(--ds-ink)]">Your team</h2>
      <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-[var(--ds-muted)]">
        {domain ? (
          <>
            Anyone with an <strong>@{domain}</strong> address joins by signing in. Invite the rest
            here — each one gets a link that sets them up on their own.
          </>
        ) : (
          <>Each person gets a link that sets them up on their own.</>
        )}
      </p>

      {suggested.length > 0 ? (
        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ds-faint)]">
            Already in your calendar
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggested.slice(0, 12).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void invite(nameOf(p))}
                className="rounded-full border border-[var(--ds-line)] px-2.5 py-1 text-[12px] text-[var(--ds-muted)] transition hover:border-[var(--ds-accent)] hover:text-[var(--ds-ink)]"
              >
                {p.display_name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1">
          <span className="text-[12.5px] font-medium text-[var(--ds-ink)]">Email address</span>
          <TextField
            className="mt-1.5"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void invite(email);
            }}
            placeholder={domain ? `someone@${domain}` : "someone@company.com"}
          />
        </label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "member" | "admin")}
          className="h-8.5 rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] px-2 text-[12.5px] text-[var(--ds-ink)] outline-none"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <Button tone="primary" busy={busy} onClick={() => void invite(email)} disabled={!email.trim()}>
          <Mail className="h-3.5 w-3.5" />
          Invite
        </Button>
      </div>

      {error ? <p className="mt-3 text-[12.5px] text-[var(--ds-danger)]">{error}</p> : null}

      {sent.length > 0 ? (
        <div className="mt-5 space-y-1.5">
          {sent.map((s) => (
            <div
              key={s.email}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--ds-line)] px-3 py-2 text-[12.5px]"
            >
              <Check className="h-3.5 w-3.5 text-[var(--ds-accent)]" />
              <span className="text-[var(--ds-ink)]">{s.email}</span>
              <Badge>{s.emailed ? "Emailed" : "Link only"}</Badge>
              {/*
                THE LINK IS SHOWN WHETHER OR NOT THE MAIL WENT. When the
                sending domain is unverified the email silently does not
                arrive, and a screen that only said "invited" would leave
                somebody waiting on nothing.
              */}
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(s.link).catch(() => {})}
                className="ml-auto text-[12px] font-medium text-[var(--ds-accent)] hover:underline"
              >
                Copy link
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-6 flex items-center gap-2">
        <Button tone="primary" onClick={onNext}>
          {sent.length > 0 ? "Done" : "Skip for now"}
        </Button>
      </div>

      <p className="mt-3 max-w-prose text-[12px] leading-relaxed text-[var(--ds-dim)]">
        Everyone starts seeing only what the company has published. Their own meetings, notes and
        imported work stay private to them until they share a piece of it.
      </p>
    </Panel>
  );
}

/** The address a person row is keyed by, when it has one. */
function nameOf(p: PersonRow) {
  return String(p.display_name ?? "").toLowerCase();
}
