"use client";

/**
 * ID — WHAT THIS COMPANY IS PLUGGED INTO, IN TWO HALVES.
 *
 * WHY TWO HALVES AND NOT ONE LIST. A connector directory sorted
 * alphabetically treats Apple Photos and Salesforce as the same kind of
 * decision, and they are not remotely. One is somebody's life and the other
 * is somebody's job, and the question a person asks before connecting each
 * one is different: "who sees my photos" versus "does this write back to our
 * CRM". Splitting them is not decoration -- it is the shape of the consent
 * question.
 *
 *   HEART   the personal side. Photos, messages, the people you actually
 *           know. Highest sensitivity, so nothing here is ever company-wide
 *           by default and the page says so above the list rather than in a
 *           tooltip under it.
 *
 *   BRAIN   the working side. CRM, chat, mail, calendar -- the systems a
 *           company already runs on and already treats as shared.
 *
 * EVERY CARD SAYS WHAT STATE IT IS IN, AND THAT IS THE LOAD-BEARING PART.
 * Some of these move data today and most do not. A directory that implies
 * uniform capability is one a buyer disproves in the first week and then
 * stops believing anything else on the page -- so "Not built yet" is written
 * on the card in the same voice as "Live", and the ones that work are the
 * ones with a button.
 */

import { useCallback, useEffect, useState } from "react";
import { Brain, Heart, Loader2 } from "lucide-react";
import { Badge, Button, Panel, Section } from "@/components/ui";
import CalendarHub from "@/components/CalendarHub";
import {
  grantMemorySource,
  listMemorySources,
  startRelationshipConnect,
  syncMemoryNow,
} from "@/lib/workspace";

type State = "live" | "connected" | "not-connected" | "needs-setup" | "file-only" | "planned";

const STATE: Record<State, { label: string; tone?: "accent" | "danger" }> = {
  live: { label: "Live", tone: "accent" },
  /*
   * CONNECTED is about THIS account, where Live is about the product. A row
   * that said "Live" told somebody the integration exists, which is not the
   * question they were asking; they wanted to know whether the thing they
   * just authorized had landed.
   */
  connected: { label: "Connected", tone: "accent" },
  "not-connected": { label: "Not connected" },
  "needs-setup": { label: "Needs admin setup" },
  "file-only": { label: "Import a file" },
  planned: { label: "Not built yet" },
};

type Connector = {
  id: string;
  name: string;
  state: State;
  /** What it would bring in. Written as the thing, not as a category. */
  what: string;
  /** Only on the ones that actually do something. */
  action?: { label: string; go: () => void };
  /**
   * THE SERVICE'S OWN SITE, used to show the service's own icon.
   *
   * Not an icon I drew. A row of hand-made approximations of other
   * companies' marks looks worse than letters and is somebody else's
   * trademark badly copied; the real favicon, served from the real domain,
   * is the thing people recognize and it is theirs. When it does not load
   * -- offline, blocked, a company that changed its icon -- the tile falls
   * back to a monogram, which is why the monogram is drawn first and the
   * image sits on top of it.
   */
  domain: string;
  /** The tint behind the monogram when there is no icon. */
  tint: string;
};

export default function Identity({
  onGoToFiles,
  onGoToAgents,
}: {
  onGoToFiles?: () => void;
  onGoToAgents?: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /*
   * WHAT IS ACTUALLY CONNECTED, asked rather than assumed.
   *
   * Every row said "Connect" forever, including after somebody had just
   * finished the Google flow -- so the honest conclusion from the screen was
   * that it had not worked. The grant rows are what the server reads before
   * it syncs anything, so they are what this shows.
   */
  const [live, setLive] = useState<Set<string> | null>(null);

  const refresh = useCallback(() => {
    listMemorySources()
      .then((r) =>
        setLive(
          new Set(
            (r.sources ?? [])
              .filter((x) => !x.revoked_at)
              .map((x) => String(x.source)),
          ),
        ),
      )
      .catch(() => setLive(new Set()));
  }, []);

  useEffect(refresh, [refresh]);

  const [settling, setSettling] = useState<string | null>(null);

  /*
   * FINISH THE CONNECTION HERE, WHERE THE ORG IS KNOWN FOR CERTAIN.
   *
   * The OAuth callback tried to record the consent and found no membership
   * for that account -- it logged orgs=0 and wrote nothing, so Google had
   * approved a mailbox that the graph was never told about. That lookup runs
   * with no session and no tenant, which is exactly the context where "which
   * company is this person in" is hardest to answer.
   *
   * This runs in the signed-in session instead. The org and the member are
   * not inferred: they are the ones this request is authenticated as. Then it
   * pulls immediately, so coming back from Google and seeing the same graph
   * is not a thing that can happen.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("google") !== "connected") return;

    /* Once per return, not once per render. */
    q.delete("google");
    q.delete("reason");
    const rest = q.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`,
    );

    let alive = true;
    (async () => {
      setSettling("Recording what you just allowed…");
      await Promise.all([
        grantMemorySource("calendar").catch(() => null),
        grantMemorySource("mail").catch(() => null),
      ]);
      if (!alive) return;
      refresh();
      setSettling("Reading your calendar and mailbox. This takes a minute the first time…");
      const r = await syncMemoryNow().catch(() => null);
      if (!alive) return;
      setSettling(
        r
          ? `Done. ${r.named ?? 0} named, ${r.mergedPeople ?? 0} merged into one person.`
          : "That did not finish. It will run again within the hour.",
      );
      refresh();
      setTimeout(() => alive && setSettling(null), 8000);
    })();

    return () => {
      alive = false;
    };
  }, [refresh]);

  /*
   * ONE CONSENT FOR THE WHOLE GRAPH.
   *
   * Calendar and mail were separate ideas on this screen and only one of
   * them was ever connectable, which is how somebody ends up having
   * "connected Google" and still having no mail read. They ride one Google
   * authorization, so they are one button, and it says exactly what it asks
   * for.
   */
  const connectGoogle = async () => {
    setProblem(null);
    setConnecting(true);
    try {
      /*
       * REMEMBER WHERE WE WERE, IN A PLACE A REDIRECT CANNOT MANGLE.
       *
       * The return path carries ?tab=knowledge, and that is still the primary
       * mechanism -- but it passes through an OAuth callback that builds its
       * own query, and when that went wrong the symptom was landing on a
       * different screen with no way to tell whether the connection worked.
       * sessionStorage survives the round trip untouched and is cleared the
       * moment it is used.
       */
      try {
        sessionStorage.setItem("amber.returnTab", "knowledge");
      } catch {
        /* Private mode. The query parameter still carries it. */
      }
      const { authorize_url } = await startRelationshipConnect("/org?tab=knowledge");
      window.location.href = authorize_url;
    } catch (e) {
      setConnecting(false);
      setProblem(
        (e as { message?: string })?.message ?? "Google could not be reached just now.",
      );
    }
  };
  const heart: Connector[] = [
    {
      id: "apple-photos",
      name: "Apple Photos",
      domain: "apple.com",
      tint: "#8e8e93",
      state: "planned",
      what: "Who you are actually with, and how often — the part of a relationship a calendar never sees.",
    },
    {
      id: "google-photos",
      name: "Google Photos",
      domain: "photos.google.com",
      tint: "#4285f4",
      state: "planned",
      what: "The same, from the other library.",
    },
    {
      id: "whatsapp",
      name: "WhatsApp",
      domain: "whatsapp.com",
      tint: "#25d366",
      state: "planned",
      what: "Who you talk to when it is not work, and how recently.",
    },
    {
      id: "instagram",
      name: "Instagram",
      domain: "instagram.com",
      tint: "#d6249f",
      state: "planned",
      what: "The people around you that no work system has ever heard of.",
    },
    {
      id: "linkedin",
      name: "LinkedIn",
      domain: "linkedin.com",
      tint: "#0a66c2",
      state: "planned",
      what: "Titles, moves and where somebody went — the thing that is stale everywhere else.",
    },
  ];

  const brain: Connector[] = [
    {
      id: "calendar",
      name: "Google Calendar",
      domain: "calendar.google.com",
      tint: "#1a73e8",
      what: "Every meeting and everybody on it. This is what builds the network in the first place — connect as many as you have, below.",
      state: live === null ? "live" : live.has("calendar") ? "connected" : "not-connected",
      action: live?.has("calendar")
        ? { label: "Reconnect", go: connectGoogle }
        : { label: connecting ? "Opening Google…" : "Connect", go: connectGoogle },
    },
    {
      id: "gmail",
      name: "Gmail",
      domain: "mail.google.com",
      tint: "#ea4335",
      what: "Who you are actually corresponding with, and where almost every name comes from — a mail header says \u201cIpsha Pandey\u201d where an invite says only an address. Read-only, headers only: who and when, never a subject or a body.",
      state: live === null ? "live" : live.has("mail") ? "connected" : "not-connected",
      action: live?.has("mail")
        ? { label: "Reconnect", go: connectGoogle }
        : { label: connecting ? "Opening Google…" : "Connect", go: connectGoogle },
    },
    {
      id: "copilot",
      name: "Microsoft Copilot",
      domain: "microsoft.com",
      tint: "#0078d4",
      state: "needs-setup",
      what: "Your Copilot work, and the ability to ask Amber from inside Copilot.",
      action: onGoToAgents ? { label: "Set it up", go: onGoToAgents } : undefined,
    },
    {
      id: "claude",
      name: "Claude",
      domain: "claude.ai",
      tint: "#d97757",
      state: "file-only",
      what: "Projects, skills and artifacts out of an export. Drop the zip and every part of it comes through.",
      action: onGoToFiles ? { label: "Import a file", go: onGoToFiles } : undefined,
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      domain: "openai.com",
      tint: "#10a37f",
      state: "file-only",
      what: "The same, from an OpenAI export.",
      action: onGoToFiles ? { label: "Import a file", go: onGoToFiles } : undefined,
    },
    {
      id: "slack",
      name: "Slack",
      domain: "slack.com",
      tint: "#4a154b",
      state: "planned",
      what: "What your team is actually working on, in the place they say it.",
    },
    {
      id: "salesforce",
      name: "Salesforce",
      domain: "salesforce.com",
      tint: "#00a1e0",
      state: "planned",
      what: "Accounts and owners, so a firm here is the same firm there.",
    },
    {
      id: "hubspot",
      name: "HubSpot",
      domain: "hubspot.com",
      tint: "#ff7a59",
      state: "planned",
      what: "The same, for companies that run on HubSpot instead.",
    },
  ];

  return (
    <div className="space-y-5">
      {problem ? (
        <Panel className="px-4 py-3 text-[13px] text-[var(--ds-ink)]">{problem}</Panel>
      ) : null}
      {settling ? (
        <Panel className="flex items-center gap-2.5 px-4 py-3 text-[13px] text-[var(--ds-ink)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--ds-accent)]" />
          {settling}
        </Panel>
      ) : null}

      <Section
        title={
          <span className="flex items-center gap-2">
            <Heart className="h-4 w-4 text-[var(--ds-accent)]" />
            Heart
          </span>
        }
        note="Your life, not your job. Nothing here is ever company-wide by default — it lands private to you and you share one piece at a time, the same way everything else here works."
      >
        <List items={heart} />
      </Section>

      <Section
        title={
          <span className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-[var(--ds-accent)]" />
            Brain
          </span>
        }
        note="The systems the company already runs on. These are the ones that fill the network and the knowledge base without anybody typing anything in."
      >
        <List items={brain} />
      </Section>

      {/*
        THE CALENDAR GETS THE WHOLE SECTION, not a row, because it is the one
        that does the work: it is what the entire network is built out of,
        and it is the one somebody has more than one of. A card that only
        says "Live" cannot answer "which calendars, pulled when, and what is
        on them" -- which is the question that kept coming back as "I don't
        see my calendar anywhere".
      */}
      <CalendarHub />
    </div>
  );
}

function List({ items }: { items: Connector[] }) {
  return (
    <div className="space-y-2 px-4 pb-4">
      {items.map((c) => {
        const state = STATE[c.state];
        return (
          <Panel key={c.id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
            <Logo name={c.name} domain={c.domain} tint={c.tint} />
            <span className="min-w-[200px] flex-1">
              <span className="flex items-center gap-2">
                <span className="text-[13.5px] font-semibold text-[var(--ds-ink)]">{c.name}</span>
                <Badge tone={state.tone}>{state.label}</Badge>
              </span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--ds-dim)]">
                {c.what}
              </span>
            </span>
            {c.action ? (
              <Button tone="ghost" onClick={c.action.go}>
                {c.action.label}
              </Button>
            ) : null}
          </Panel>
        );
      })}
    </div>
  );
}

/**
 * The service's own icon, with a monogram underneath it.
 *
 * The monogram is not a placeholder that gets replaced -- it is painted
 * first and the icon sits on top, so a blocked request, an offline machine
 * or a dead favicon leaves something deliberate rather than a broken-image
 * glyph. onError hides the image and the tile is simply the letter.
 */
function Logo({ name, domain, tint }: { name: string; domain: string; tint: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl"
      style={{ backgroundColor: `${tint}1f` }}
      aria-hidden
    >
      <span className="text-[14px] font-semibold" style={{ color: tint }}>
        {name.slice(0, 1)}
      </span>
      {broken ? null : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={`https://www.google.com/s2/favicons?sz=64&domain=${domain}`}
          alt=""
          width={20}
          height={20}
          loading="lazy"
          onError={() => setBroken(true)}
          className="absolute h-5 w-5 rounded"
        />
      )}
    </span>
  );
}
