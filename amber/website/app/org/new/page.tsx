"use client";

/**
 * SETTING UP A COMPANY.
 *
 *   1. The company   — nothing else can exist until it does
 *   2. Groups        — who works together, and what each group is FOR
 *   3. The ceiling   — how far each kind of thing may travel
 *   4. The team      — invite people into a company already configured
 *
 * THE COMPANY IS CREATED AT THE END OF STEP ONE, not the end of the wizard, so
 * somebody who closes the tab at step three has a working company with a tight
 * default ceiling rather than a form that evaporated.
 *
 * THE TOKEN IS READ AT THE MOMENT OF EACH CALL, never held in state. Creating
 * the company re-mints the credential — the old one was issued before this
 * person was an admin of anything — and a component holding the stale string is
 * what produced "this session can only read your network and your contacts" on
 * every screen after step one.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AmberError, tokenNow } from "@/lib/amber";
import {
  CLASSIFICATIONS,
  CLASSIFICATION_HINT,
  CLASSIFICATION_LABEL,
  SCOPE_LABEL,
  SHARE_SCOPES,
  createGroup,
  createInvite,
  createOrg,
  getOrgContext,
  setPolicy,
  type Classification,
  type OrgGroup,
  type OrgPolicy,
  type ShareScope,
} from "@/lib/org";
import { Btn, Card, Err, Input, Ladder, Row, Tag } from "@/components/Ent";
import { getWorkspaces } from "@/lib/org";

type Step = 1 | 2 | 3 | 4;

const STEP_TITLES: Record<Step, string> = {
  1: "Your company",
  2: "Groups",
  3: "Sharing policy",
  4: "Your team",
};

const DEFAULT_POLICY: OrgPolicy = {
  public: "customer_group",
  internal: "org",
  customer_safe: "customer_group",
  private: "self",
};

const SCOPE_OPTIONS = SHARE_SCOPES.map((s) => ({ value: s, label: SCOPE_LABEL[s] }));

const SCOPE_CONSEQUENCE: Record<ShareScope, string> = {
  self: "Stays with the person who wrote it. Nobody else in the company can open it, including you.",
  group: "Everyone in one named group sees it in their feed. Nobody outside that group does.",
  org: "Everyone in the company sees it. It does not leave the company.",
  customer: "Leaves the building. One named customer can open it through a link, without an account.",
  customer_group: "Leaves the building. A named set of customers can open it through a link.",
};

export default function NewOrgPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [wrongKind, setWrongKind] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [orgName, setOrgName] = useState("");
  const [groups, setGroups] = useState<OrgGroup[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tokenNow()) {
      router.replace("/login");
      return;
    }
    /*
     * ASK BEFORE RENDERING ANYTHING.
     *
     * This used to paint step one and then bounce to the console a moment later
     * once the lookup came back, which is the flicker that made clicking "for a
     * company" look broken: the setup flow appeared, then vanished.
     */
    Promise.all([
      getOrgContext(tokenNow()!).catch(() => null),
      getWorkspaces(tokenNow()!).catch(() => null),
    ]).then(([c, w]) => {
      if (c?.kind === "org") {
        router.replace("/org");
        return;
      }
      /*
       * A PERSONAL ACCOUNT IS TOLD BEFORE IT FILLS IN A FORM, not after it
       * submits one. The server refuses it either way; finding out at the end
       * of a form is just a worse way to learn it.
       */
      const here = w?.workspaces.find((x) => x.current);
      if (here && here.kind !== "work") setWrongKind(true);
      setReady(true);
    });
  }, [router]);

  if (!ready) {
    return (
      <main data-surface="enterprise" className="px-8 py-16" style={{ color: "var(--ent-dim)" }}>
        Loading…
      </main>
    );
  }

  if (wrongKind) {
    return (
      <main data-surface="enterprise" className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-md">
          <Card title="This is your personal Amber">
            <p className="mb-4 text-sm leading-relaxed" style={{ color: "var(--ent-muted)" }}>
              A company is a separate workspace with its own account — its own contacts, its own
              graph, its own everything. Nothing from here moves into it and nothing from it
              appears here.
            </p>
            <p className="mb-5 text-sm leading-relaxed" style={{ color: "var(--ent-muted)" }}>
              Set it up with your work email. Afterwards you can link this number to that account
              and switch between the two whenever you like.
            </p>
            <Btn onClick={() => router.push("/login/work")} className="w-full">
              Set up with a work email
            </Btn>
            <button
              onClick={() => router.push("/network")}
              className="mt-4 block w-full text-center text-sm"
              style={{ color: "var(--ent-dim)" }}
            >
              Back to my Amber
            </button>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main data-surface="enterprise" className="px-6 py-12 lg:px-10">
      <div className="mx-auto max-w-3xl">
        <nav className="mb-6 flex items-center gap-2">
          {([1, 2, 3, 4] as Step[]).map((n) => (
            <span
              key={n}
              className="h-1 flex-1 rounded-full"
              style={{ background: n <= step ? "var(--ent-accent)" : "var(--ent-line)" }}
            />
          ))}
        </nav>
        <p className="mb-6 text-sm" style={{ color: "var(--ent-dim)" }}>
          Step {step} of 4 · {STEP_TITLES[step]}
        </p>

        <Err>{error}</Err>

        {step === 1 ? (
          <CompanyStep onError={setError} onDone={(n) => { setOrgName(n); setError(null); setStep(2); }} />
        ) : null}
        {step === 2 ? (
          <GroupsStep
            onError={setError}
            onDone={(made) => { setGroups(made); setError(null); setStep(3); }}
          />
        ) : null}
        {step === 3 ? <CeilingStep onError={setError} onDone={() => { setError(null); setStep(4); }} /> : null}
        {step === 4 ? <TeamStep orgName={orgName} groups={groups} onError={setError} /> : null}
      </div>
    </main>
  );
}

function CompanyStep({
  onDone,
  onError,
}: {
  onDone: (name: string) => void;
  onError: (e: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [restrict, setRestrict] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = tokenNow();
    if (!token) return;
    setBusy(true);
    onError(null);
    try {
      // createOrg stores the re-minted token the server returns, so by the time
      // the next step calls anything, tokenNow() is the admin credential.
      await createOrg(token, {
        name: name.trim(),
        emailDomain: domain.trim() || undefined,
        // A restriction with no domain to restrict against would refuse every
        // invitation, so the two travel together.
        restrictDomain: Boolean(domain.trim()) && restrict,
      });
      onDone(name.trim());
    } catch (err) {
      /*
       * A PERSONAL ACCOUNT IS REFUSED, AND THE ANSWER IS NEVER "WE WILL CONVERT
       * YOURS". That is what used to happen: enrolling a company took whatever
       * account was signed in, so a personal Amber -- somebody's own address
       * book and graph -- simply became a company's. A work Amber is a second,
       * separate account, and this says where to get one.
       */
      onError(
        err instanceof AmberError && err.code === "personal_account"
          ? "This is your personal Amber. A company is a separate workspace — set it up with your work email and you will be able to switch between the two."
          : err instanceof AmberError && err.code === "slug_taken"
            ? "A company with that name already exists here. Try a longer or more specific name."
            : err instanceof AmberError
              ? err.message
              : "Could not create that organization.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Name your company" note="You become its first admin. Everything created inside it belongs to the company — a separate account from any personal Amber you keep, with no crossover.">
      <form onSubmit={submit} className="space-y-3">
        <Input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" className="w-full" />
        <Input
          value={domain}
          onChange={(e) => setDomain(e.target.value.trim().replace(/^@/, "").toLowerCase())}
          placeholder="Work email domain, optional — paychex.com"
          className="w-full"
        />
        {domain.trim() ? (
          <label
            className="flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5"
            style={{ borderColor: "var(--ent-line)", background: "var(--ent-raised)" }}
          >
            <input
              type="checkbox"
              checked={restrict}
              onChange={(e) => setRestrict(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm" style={{ color: "var(--ent-ink)" }}>
                Only allow @{domain.trim()} addresses
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed" style={{ color: "var(--ent-dim)" }}>
                Invitations to any other address are refused. Turn this off if you work with
                contractors or agencies on their own addresses — you can change it later.
              </span>
            </span>
          </label>
        ) : null}
        <p className="text-xs" style={{ color: "var(--ent-dim)" }}>
          A matching domain never admits anybody on its own. An invitation is still the only way in,
          and this only narrows which addresses may be sent one.
        </p>
        <Btn type="submit" disabled={busy || !name.trim()} className="w-full">
          {busy ? "…" : "Create company"}
        </Btn>
      </form>
    </Card>
  );
}

/**
 * GROUPS, WITH A PURPOSE, BEFORE INVITES AND BEFORE THE CEILING.
 *
 * The ceiling has a `group` rung that means nothing in a company with no groups
 * in it, so this comes first. And a group with only a name is useless two
 * months later: "Sales" and "Sales 2" are indistinguishable, and the question
 * somebody actually has at the moment of sharing — what is this group FOR —
 * has no answer. The purpose line is what a share picker shows.
 */
function GroupsStep({
  onDone,
  onError,
}: {
  onDone: (groups: OrgGroup[]) => void;
  onError: (e: string | null) => void;
}) {
  const [draft, setDraft] = useState({ name: "", purpose: "", description: "" });
  const [planned, setPlanned] = useState<{ name: string; purpose: string; description: string }[]>([]);
  const [busy, setBusy] = useState(false);

  function add(e: React.FormEvent) {
    e.preventDefault();
    const name = draft.name.trim();
    if (!name || planned.some((p) => p.name.toLowerCase() === name.toLowerCase())) return;
    setPlanned([...planned, { ...draft, name }]);
    setDraft({ name: "", purpose: "", description: "" });
  }

  async function finish() {
    const token = tokenNow();
    if (!token) return;
    setBusy(true);
    onError(null);
    try {
      const made: OrgGroup[] = [];
      for (const p of planned) {
        const r = await createGroup(token, {
          name: p.name,
          purpose: p.purpose || undefined,
          description: p.description || undefined,
        });
        made.push(r.group);
      }
      onDone(made);
    } catch (err) {
      onError(err instanceof AmberError ? err.message : "Could not create those groups.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Who works together?"
      note="Teams, regions, deal pods. A group is the audience between “just me” and “everyone here”, and it is what an admin can restrict the relationship graph to. You can add more at any time — skipping now costs nothing."
    >
      <form onSubmit={add} className="space-y-3">
        <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name — Sales" className="w-full" />
        <Input
          value={draft.purpose}
          onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
          placeholder="What it is for — “everything client-facing in the East region”"
          className="w-full"
        />
        <Input
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="Longer description, optional"
          className="w-full"
        />
        <p className="text-xs" style={{ color: "var(--ent-dim)" }}>
          The purpose line is what somebody reads when they are choosing who to send something
          to, so write it for that moment.
        </p>
        <Btn type="submit" tone="quiet" disabled={!draft.name.trim()} className="w-full">Add group</Btn>
      </form>

      {planned.length ? (
        <div className="mt-5">
          {planned.map((p) => (
            <Row key={p.name}>
              <div className="min-w-0">
                <div style={{ color: "var(--ent-ink)" }}>{p.name}</div>
                {p.purpose ? <div className="text-sm" style={{ color: "var(--ent-muted)" }}>{p.purpose}</div> : null}
              </div>
              <Btn tone="danger" onClick={() => setPlanned(planned.filter((x) => x.name !== p.name))}>Remove</Btn>
            </Row>
          ))}
        </div>
      ) : (
        <p className="mt-5 text-sm" style={{ color: "var(--ent-dim)" }}>
          None yet. Plenty of teams are one group — you can skip this and do it per person later.
        </p>
      )}

      <Btn onClick={finish} disabled={busy} className="mt-5 w-full">
        {busy ? "…" : planned.length ? `Create ${planned.length} and continue` : "Skip for now"}
      </Btn>
    </Card>
  );
}

function CeilingStep({ onDone, onError }: { onDone: () => void; onError: (e: string | null) => void }) {
  const [policy, setPolicyState] = useState<OrgPolicy>(DEFAULT_POLICY);
  const [busy, setBusy] = useState(false);

  async function save() {
    const token = tokenNow();
    if (!token) return;
    setBusy(true);
    onError(null);
    try {
      await setPolicy(token, policy);
      onDone();
    } catch (err) {
      onError(err instanceof AmberError ? err.message : "Could not save that policy.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="How far can things travel?"
      note="These are limits, not defaults. You are not choosing what your team shares — you are choosing the widest audience each kind of thing is allowed to reach, and everyone picks freely below your line. Moving a line later applies to what is already shared, not only to what comes next."
    >
      {CLASSIFICATIONS.map((c: Classification) => (
        <div key={c} className="ent-row px-2 py-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg" style={{ color: "var(--ent-ink)" }}>{CLASSIFICATION_LABEL[c]}</h3>
            <span className="text-sm" style={{ color: "var(--ent-dim)" }}>{CLASSIFICATION_HINT[c]}</span>
          </div>
          <Ladder options={SCOPE_OPTIONS} value={policy[c]} onChange={(v) => setPolicyState({ ...policy, [c]: v })} />
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--ent-muted)" }}>
            {SCOPE_CONSEQUENCE[policy[c]]}
          </p>
        </div>
      ))}

      <p className="my-5 text-xs leading-relaxed" style={{ color: "var(--ent-dim)" }}>
        Ordered by blast radius, not headcount — one named customer sits further out than your
        whole company, because once something has left the building it has left. The limit is
        checked when something is shared and again every time somebody tries to read it.
      </p>

      <Btn onClick={save} disabled={busy} className="w-full">{busy ? "…" : "Save and continue"}</Btn>
    </Card>
  );
}

function TeamStep({
  orgName,
  groups,
  onError,
}: {
  orgName: string;
  groups: OrgGroup[];
  onError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [groupId, setGroupId] = useState("");
  const [sent, setSent] = useState<{ email: string; url: string; emailed: boolean; group: string }[]>([]);
  const [busy, setBusy] = useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const token = tokenNow();
    if (!token) return;
    setBusy(true);
    onError(null);
    try {
      const r = await createInvite(token, email.trim(), role, groupId || null);
      setSent([
        {
          email: r.invite.email,
          url: r.acceptUrl,
          emailed: r.emailed,
          group: groups.find((g) => g.id === groupId)?.name ?? "",
        },
        ...sent,
      ]);
      setEmail("");
    } catch (err) {
      onError(err instanceof AmberError ? err.message : "Could not create that invite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={`Bring in ${orgName || "your team"}`}
      note="Invite by work email, straight into a group if you have one. Each link works once and expires in seven days."
    >
      <form className="space-y-3" onSubmit={invite}>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className="w-full" required />
        <Ladder
          options={[{ value: "member", label: "Member" }, { value: "admin", label: "Admin" }]}
          value={role}
          onChange={(v) => setRole(v)}
        />
        {groups.length ? (
          <Ladder
            options={[{ value: "", label: "No group" }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
            value={groupId}
            onChange={(v) => setGroupId(v)}
          />
        ) : null}
        <Btn type="submit" disabled={busy || !email.trim()} className="w-full">{busy ? "…" : "Send invitation"}</Btn>
      </form>

      {sent.map((s) => (
        <div key={s.url} className="ent-raised mt-3 rounded-xl p-3">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-sm" style={{ color: "var(--ent-ink)" }}>
            {s.email}
            {s.group ? <Tag on>{s.group}</Tag> : null}
            <span style={{ color: "var(--ent-dim)" }}>{s.emailed ? "emailed" : "send this link yourself"}</span>
          </div>
          <code className="block break-all text-xs" style={{ color: "var(--ent-accent)" }}>{s.url}</code>
          <Btn tone="quiet" className="mt-2" onClick={() => navigator.clipboard?.writeText(s.url)}>Copy</Btn>
        </div>
      ))}

      <div className="ent-raised mt-6 rounded-xl p-4">
        <p className="text-sm leading-relaxed" style={{ color: "var(--ent-muted)" }}>
          One thing a browser cannot do is read an address book. The relationship graph fills in
          as people connect their accounts — contacts, calendar and mail sync live in the iOS
          app, and anybody can bring a .vcf or .csv export in from the web in the meantime.
        </p>
      </div>

      <Btn onClick={() => router.push("/org")} className="mt-6 w-full">Open the console</Btn>
    </Card>
  );
}
