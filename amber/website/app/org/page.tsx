"use client";

/**
 * THE COMPANY CONSOLE.
 *
 * Rebuilt on the shell. What was wrong with the version before this was not
 * the colours, though they were wrong too. It was that seven unrelated things
 * were stacked in one centred column of cards, each with its own padding, and
 * the page gave no clue which of them you were meant to be looking at. A
 * console is a place somebody does ONE thing at a time; the rail says which,
 * and the page shows that thing and not the other six.
 *
 * WHAT THE TOKEN IS READ FROM. tokenNow(), at the moment of each call, never
 * component state. Creating a company re-mints the credential, and a component
 * holding the old string is what produced a console full of 403s on every
 * screen after step one.
 *
 * THE PERSONAL NETWORK IS NOT LINKED FROM HERE. A company account and a
 * personal account are different accounts by design; a button in the company's
 * chrome that opens somebody's own relationship graph makes the two look like
 * one workspace with two tabs, which is the impression the whole model exists
 * to avoid. The switcher is how you cross, and it is a switch, not a link.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  BookOpen,
  Building2,
  FolderOpen,
  LayoutGrid,
  Link2,
  MessageSquare,
  Network,
  Plus,
  Search,
  Shield,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { AmberError, apiBase, clearSession, tokenNow } from "@/lib/amber";
import { drop, useCached, warm } from "@/lib/cache";
import { ScreenVisible } from "@/lib/screen";
import LinkPersonalCard from "@/components/LinkPersonalCard";
import {
  CLASSIFICATIONS,
  CLASSIFICATION_HINT,
  CLASSIFICATION_LABEL,
  SCOPE_LABEL,
  SHARE_SCOPES,
  AUDIENCE_LABEL,
  addToGroup,
  createGroup,
  createInvite,
  deleteGroup,
  getGroupMembers,
  getGroups,
  setGroupOrder,
  setGroupPinned,
  getInvites,
  getMembers,
  getOrgContext,
  getOrgShares,
  removeFromGroup,
  removeMember,
  reissueInvite,
  revokeInvite,
  getOrgSetup,
  getAudienceOptions,
  setPolicy,
  updateOrg,
  updateGroup,
  updateMember,
  type Classification,
  type OrgContext,
  type OrgGroup,
  type OrgInvite,
  type OrgMember,
  type OrgPolicy,
  type OrgSetup,
  type OrgShare,
  type ShareScope,
} from "@/lib/org";
import Connections from "@/components/Connections";
import { ago, getKnowledge, markFeedSeen, type KnowledgeStats, type PageSummary, type Post,
  getDrive,
  getFeed,
  getPages,
} from "@/lib/knowledge";
import Knowledge from "@/components/Knowledge";
import Drive from "@/components/Drive";
import Feed from "@/components/Feed";
import { MyProfile, PersonCard, WhoKnows } from "@/components/WhoKnows";
import Credentials from "@/components/Credentials";
import CompanyCanvas from "@/components/CompanyCanvas";
import GroupChat from "@/components/GroupChat";
import GroupAccordion, { NewGroupRow, type GroupView } from "@/components/GroupAccordion";
import TeamCalendar from "@/components/TeamCalendar";
import Pulse from "@/components/Pulse";
import Connectors from "@/components/Connectors";
import CopilotSetup from "@/components/CopilotSetup";
import AskBar from "@/components/AskBar";
import AiImport from "@/components/AiImport";
import Onboarding from "@/components/Onboarding";
import RelationshipOrbit from "@/components/RelationshipOrbit";
import CircleRoom from "@/components/CircleRoom";
import NetworkWorkspace from "@/components/NetworkWorkspace";
import Identity from "@/components/Identity";
import { getConnectors } from "@/lib/connectors";
import ApiAccess from "@/components/ApiAccess";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import { AppShell, PageBody, PageHeader, type NavItem } from "@/components/AppShell";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Empty,
  Field,
  List,
  ListRow,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Modal,
  Panel,
  Section,
  Segmented,
  Spinner,
  Stat,
  TextArea,
  TextField,
} from "@/components/ui";
import { hueFor } from "@/lib/cn";
import RelationshipMemory from "@/components/RelationshipMemory";
import AssistantFlow from "@/components/AssistantFlow";

/**
 * FOUR PLACES TO WORK, AND TWO SETTINGS SCREENS.
 *
 * It was nine. Nine tabs is not nine features, it is one feature split nine
 * ways: Files and Knowledge and Connectors were three doors onto the same
 * question, and the Feed was a company-wide room sitting outside the tab
 * that holds every other room. Somebody looking for a document had three
 * places to try and no way to reason about which.
 *
 * So: Overview for what needs you, Teams for where work happens, Knowledge
 * for everything the company keeps and every assistant that reads it, and
 * Relationships for everyone inside and outside. Sharing policy and Activity
 * stay pinned at the foot, because they are things you configure once rather
 * than places you go.
 */
type Tab =
  | "overview"
  | "teams"
  | "knowledge"
  | "relationships"
  | "policy"
  | "activity";

/** The ones a URL is allowed to name, so a stale link cannot blank the page. */
const TABS = new Set<string>([
  "overview",
  "teams",
  "knowledge",
  "relationships",
  "policy",
  "activity",
]);

/**
 * WHERE A THING ACTUALLY ENDS UP, said in a sentence rather than implied by a
 * dropdown value. This is the most consequential screen an admin ever touches
 * and the old copy made them infer the consequence from the word "org".
 */
const SCOPE_CONSEQUENCE: Record<ShareScope, string> = {
  self: "Stays with the person who wrote it. Nobody else in the company can open it, including you.",
  group: "Everyone in one named group sees it in their feed. Nobody outside that group does.",
  org: "Everyone in the company sees it. It does not leave the company.",
  customer: "Leaves the building. One named customer can open it through a link, without an account.",
  customer_group: "Leaves the building. A named set of customers can open it through a link.",
};

export default function OrgPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<OrgContext | null>(null);
  /*
   * THE TAB SURVIVES A RELOAD, AND A TRIP TO GOOGLE.
   *
   * It lived in component state alone, so every refresh -- and every return
   * from an OAuth redirect -- landed on Circles. Somebody connecting a
   * mailbox from the ID screen came back to a different screen entirely and
   * had to find their way back to see whether it had worked, which is the
   * worst possible moment to lose somebody's place.
   *
   * The tab is in the URL, so Back works and a link to a tab is a link to
   * that tab. The hash is used rather than a query string because it changes
   * nothing server-side and costs no navigation.
   */
  const [tab, setTabState] = useState<Tab>("teams");

  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${next}`);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    /* ?tab= is accepted too, because an OAuth return_to cannot carry a hash. */
    const fromQuery = new URLSearchParams(window.location.search).get("tab");
    const fromHash = window.location.hash.replace(/^#/, "");
    /* Set before leaving for an OAuth redirect, which rewrites the query. */
    let stashed: string | null = null;
    try {
      stashed = sessionStorage.getItem("amber.returnTab");
      if (stashed) sessionStorage.removeItem("amber.returnTab");
    } catch {
      stashed = null;
    }
    const wanted = (fromQuery || fromHash || stashed || "") as Tab;
    if (TABS.has(wanted)) setTab(wanted);
  }, [setTab]);
  const [error, setError] = useState<string | null>(null);
  /*
   * THE ONLY NUMBER THE RAIL CARRIES. Everything else it used to show was a
   * total -- how many files exist, how many people -- dressed in the badge
   * every product reserves for "this needs you". See NavItem.unread.
   */
  const [unreadFeed, setUnreadFeed] = useState(0);
  /*
   * The real API address, for the curl commands on the Connectors page.
   * Resolved at runtime through /api/config rather than inlined at build
   * time, for the same reason every other call is: a NEXT_PUBLIC_* value is
   * frozen into the image and silently wrong the moment the API moves.
   */
  const [apiUrl, setApiUrl] = useState("");

  /*
   * ABOVE EVERY EARLY RETURN, and that placement is not style.
   *
   * These sat beside the setup check further down, which is where they read
   * naturally -- and that is two early returns below. React identifies hooks
   * by call ORDER, so a render that bailed at the spinner called five and a
   * render that got through called seven: "rendered fewer hooks than
   * expected", a crash on the first load of every console.
   *
   * It compiled, it type-checked, and the build was green. Nothing but
   * running it or knowing the rule catches this.
   */
  const [setupDone, setSetupDone] = useState(false);
  const [setupStep, setSetupStep] = useState<string | null>(null);
  const [setupOrgId, setSetupOrgId] = useState<string | null>(null);
  useEffect(() => {
    if (!setupOrgId) return;
    try {
      const at = localStorage.getItem(`amber.setup.${setupOrgId}`);
      if (at === "done") setSetupDone(true);
      else if (at) setSetupStep(at);
    } catch {
      /* private window, blocked storage: show setup, which is the safe default */
    }
  }, [setupOrgId]);
  useEffect(() => {
    apiBase().then(setApiUrl).catch(() => setApiUrl(""));
  }, []);

  const load = useCallback(() => {
    const token = tokenNow();
    if (!token) {
      router.replace("/login");
      return;
    }
    getOrgContext(token)
      .then((c) => {
        if (c.kind !== "org") router.replace("/org/new");
        else {
          setCtx(c);
          // The id the setup flag is keyed by. Set here rather than read off
          // ctx inside the effect, so the effect has no dependency on a
          // value that does not exist on the first render.
          setSetupOrgId(c.org.id);
        }
      })
      .catch((e) =>
        setError(e instanceof AmberError ? e.message : "Could not load your organization."),
      );
  }, [router]);

  useEffect(load, [load]);

  // The rail's badges. One pass on mount, because a count that is a minute
  // stale is fine and a count that costs a request per tab is not.
  const orgId = ctx?.kind === "org" ? ctx.org.id : null;
  useEffect(() => {
    const token = tokenNow();
    if (!token || !orgId) return;
    getKnowledge()
      .then((r) => setUnreadFeed(r.unread?.feed ?? 0))
      .catch(() => {});
  }, [orgId]);

  /*
   * WARM EVERY SCREEN BEFORE ANYBODY CLICKS ONE.
   *
   * The module cache made the second visit to a tab instant and did nothing
   * for the first, which is the visit people judge the product on: click
   * Knowledge, watch "Loading…", click Files, watch it again. Caching after
   * the fact cannot remove a wait that has already happened.
   *
   * These are exactly the reads the person was about to make anyway. Doing
   * them here costs one visit to each tab, once, at the moment nothing is
   * competing for attention, instead of five separate waits at the five
   * moments somebody is staring at the screen. Failures are swallowed inside
   * warm(): the screen that actually needs the data will ask again and report
   * its own error.
   */
  useEffect(() => {
    const token = tokenNow();
    if (!token || !orgId) return;
    warm([
      { key: "feed:all:any", load: () => getFeed({}) },
      { key: "knowledge", load: () => getKnowledge() },
      { key: "pages:all", load: () => getPages() },
      { key: "drive:all:all:", load: () => getDrive({}) },
      { key: "connectors", load: () => getConnectors() },
      { key: "org:groups", load: () => getGroups(token) },
      {
        key: "groups:all",
        load: async () => {
          const [g, m, opts] = await Promise.all([
            getGroups(token),
            getMembers(token),
            getAudienceOptions(token),
          ]);
          return {
            groups: g.groups,
            members: m.members,
            web: opts.groups.map((gr) => [gr.id, gr.memberIds] as [string, string[]]),
          };
        },
      },
    ]);
  }, [orgId]);

  const isAdmin = ctx?.kind === "org" && ctx.role === "admin";

  if (error) {
    return (
      <main data-surface="enterprise" className="grid min-h-screen place-items-center px-6">
        <Panel className="w-full max-w-md px-6 py-6">
          <Alert>{error}</Alert>
          <Button
            onClick={() => {
              clearSession();
              router.replace("/login");
            }}
          >
            Sign in again
          </Button>
        </Panel>
      </main>
    );
  }

  if (!ctx || ctx.kind !== "org") {
    return (
      <main data-surface="enterprise" className="grid min-h-screen place-items-center">
        <Spinner />
      </main>
    );
  }

  /*
   * ORDERED BY HOW OFTEN SOMEBODY OPENS IT, NOT BY WHEN IT WAS BUILT.
   *
   * Groups sat sixth, below Files and People, which is backwards: a team is
   * where the work happens and it is the thing people navigate to. Feed and
   * Groups are the daily screens, so they lead. Connections is its own item
   * rather than a tab buried inside one group, because the company's places
   * are not one team's business.
   */
  /*
   * TWO PLACES YOU GO, and the rest pinned at the foot as things you set once.
   *
   * Overview and Relationships are gone as destinations rather than as
   * features. Overview was a summary of the other screens, which is a screen
   * somebody passes THROUGH -- and a landing page that is only a summary is a
   * click between a person and the thing they came for. Relationships was the
   * graph, which belongs in Circles: a circle IS a set of relationships, and
   * keeping the people in one tab and the rooms they are in in another made
   * you hold both in your head to use either.
   *
   * What is left is the product in two sentences: who you know (Circles),
   * and what you know (Knowledge).
   */
  /*
   * A NEW WORKSPACE OPENS INTO SETUP, NOT INTO AN EMPTY CONSOLE.
   *
   * "Has this company been set up" is answered by whether anybody ever said
   * what it does -- a field only the setup flow writes. It is a better
   * signal than member count or age: a one-person company that has filled it
   * in is set up, and a week-old one that has not is somebody who bounced
   * off an empty screen and never came back.
   *
   * DISMISSIBLE AND REMEMBERED PER WORKSPACE. Somebody who skips setup is
   * not asked again on every load, and somebody in a second workspace gets
   * asked for that one. Browser storage is the right place for this: it is a
   * per-person convenience, and if it comes back empty the worst outcome is
   * seeing the setup screen once more with a Skip button on it.
   */
  /*
   * SETUP IS DONE WHEN SOMEBODY SAYS IT IS, NOT WHEN STEP ONE SAVES.
   *
   * THE BUG THIS FIXES, watched on a recording. `needsSetup` was
   * `!org.description` -- so pressing Continue on the FIRST step, which
   * saves the description, closed the gate. The next render had a
   * description, decided setup had happened, and dropped the person into the
   * console. They never saw the calendar step, the import step or the invite
   * step, and reported, correctly, that there was nowhere to import their
   * Claude history.
   *
   * It is worse than it sounds, because the calendar step REDIRECTS to
   * Google and comes back: any "has it been done" test that the first step
   * satisfies will always lose the rest of the flow on the return trip.
   *
   * So the flag is explicit and per workspace, written only by the last step
   * or by Skip, and the description is used only to decide whether to OFFER
   * setup to somebody who has never been through it.
   */
  const neverSetUp = !ctx.org.description;

  /*
   * MID-FLIGHT COUNTS. Somebody who is on step two has a description -- step
   * one wrote it -- so `neverSetUp` is false for them, and the calendar step
   * sends the browser to Google and back through a full reload. Without the
   * saved step, every person who connected a calendar during setup landed in
   * the console having skipped the import and the invitations.
   */
  const needsSetup = isAdmin && !setupDone && (neverSetUp || Boolean(setupStep));

  if (needsSetup) {
    return (
      <Onboarding
        org={ctx.org}
        groups={ctx.groups}
        startAt={setupStep}
        onStep={(step) => {
          try {
            localStorage.setItem(`amber.setup.${ctx.org.id}`, step);
          } catch {
            /* the flag is a convenience; losing it costs one extra screen */
          }
          setSetupStep(step);
        }}
        onDone={() => {
          try {
            localStorage.setItem(`amber.setup.${ctx.org.id}`, "done");
          } catch {
            /* same -- worst case somebody sees setup once more, with Skip on it */
          }
          setSetupDone(true);
          void load();
        }}
      />
    );
  }

  const nav: NavItem<Tab>[] = [
    { key: "relationships", label: "Network", icon: <Network className="h-4 w-4" /> },
    { key: "teams", label: "Circles", icon: <MessageSquare className="h-4 w-4" /> },
    { key: "knowledge", label: "Knowledge", icon: <BookOpen className="h-4 w-4" /> },
    { key: "policy", label: "Sharing policy", icon: <Shield className="h-4 w-4" />, foot: true },
    ...(isAdmin
      ? ([{ key: "activity", label: "Activity", icon: <Activity className="h-4 w-4" />, foot: true }] as NavItem<Tab>[])
      : []),
  ];

  return (
    <AppShell
      product={ctx.org.name}
      subtitle={ctx.role === "admin" ? "Admin" : "Member"}
      nav={nav}
      active={tab}
      onNavigate={setTab}
      workspace={<WorkspaceSwitcher />}
      account={{ name: ctx.org.name, detail: ctx.profile?.title ?? (ctx.role === "admin" ? "Admin" : "Member") }}
    >
      {/*
        EVERY SCREEN STAYS MOUNTED. THIS IS THE LAG.
        
        These were `{tab === "files" ? <Drive/> : null}`, which does not hide a
        screen -- it DESTROYS it. React unmounts the component, throws away its
        state, its scroll position and its rendered tree, and clicking back
        builds the whole thing again from nothing. Caching the data made that
        rebuild quieter without making it stop happening: the request was
        instant and the work was still a full remount of a few hundred nodes,
        a fresh layout, every effect re-running, every list re-keyed. That is
        the delay, and it is paid on every single click.
        
        `Keep` renders a screen once and then hides it with CSS. Clicking a tab
        becomes a style change on two divs: no unmount, no remount, no
        reflow of anything but visibility. The scroll position in Files is
        where you left it, the search box in Knowledge still has your text in
        it, and the chat you were reading has not jumped back to the bottom.
        
        It is mounted LAZILY -- `Keep` renders nothing until the tab has been
        opened once -- so the first paint of the console is still one screen,
        not nine. After that a tab is only ever shown or hidden.
        
        The cost is honest: nine mounted screens hold more memory than one, and
        a hidden screen's timers keep running. That is why GroupChat's poll
        checks document.visibilityState, and why this is worth it -- a console
        people click around in all day is judged on exactly this.
      */}
      {/*
        CIRCLES: every room, and everyone this company knows.
        
        The relationship graph moved in here and the Relationships tab is
        GONE rather than hidden. A tab that is unreachable but still mounted
        is not dead code with no cost: RelationshipMemory would have been
        mounted twice, making every request on this screen twice, which is
        exactly the lag somebody reports as "it feels slow" and nobody can
        find in a profiler because both copies look correct.
      */}
      <Keep on={tab === "relationships"}>
        <NetworkTab ctx={ctx} />
      </Keep>

      <Keep on={tab === "teams"}>
        <CirclesTab ctx={ctx} isAdmin={!!isAdmin} />
      </Keep>

      {/*
        KNOWLEDGE: what the company keeps, and everything that reads it.
        
        Files, pages and connectors were three tabs asking one question. An
        assistant reading this material is not a separate concern from the
        material, so it lives beside it.
      */}
      <Keep on={tab === "knowledge"}>
        <KnowledgeTab ctx={ctx} isAdmin={!!isAdmin} apiUrl={apiUrl} />
      </Keep>

      <Keep on={tab === "policy"}>
        <PolicyTab isAdmin={!!isAdmin} initial={ctx.policy} org={ctx.org} onSaved={load} />
      </Keep>

      {isAdmin ? (
        <Keep on={tab === "activity"}>
          <ActivityTab />
        </Keep>
      ) : null}
    </AppShell>
  );
}

/* ──────────────────────────────────────────────────────────── merged tabs */

/**
 * THE SECOND LEVEL OF NAVIGATION, AS NAVIGATION.
 *
 * It was a Segmented control in the top right corner of a header, which is
 * where a product puts a setting -- a density toggle, a sort order. Putting
 * the choice between two halves of a screen there reads as an option on what
 * you are looking at rather than a choice of what to look at, and people do
 * not find it.
 *
 * So it sits under the title, left aligned, at the size of something you
 * click, with the underline carrying the state. Nothing clever; it is the
 * shape every document-shaped product uses because it is the one people
 * already know how to read.
 */
function SubNav<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    /*
      ALIGNED WITH THE TITLE ABOVE IT, which it was not.
      
      PageHeader centres its contents in a 1240px column with 32px of
      padding on a wide screen; this row had neither, so the tabs sat flush
      against the window while the title started an inch to the right. Two
      things that belong to each other, visibly not lining up -- the kind of
      wrongness everybody sees and nobody can name.
    */
    <div className="border-b border-[var(--ds-line)]">
      <div className="mx-auto flex max-w-[1240px] gap-1 px-6 lg:px-8">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              className={`relative px-3 py-2.5 text-[13.5px] font-medium transition-colors ${
                on
                  ? "text-[var(--ds-ink)]"
                  : "text-[var(--ds-muted)] hover:text-[var(--ds-ink)]"
              }`}
            >
              {o.label}
              {typeof o.count === "number" ? (
                <span className="tnum ml-1.5 text-[12px] text-[var(--ds-faint)]">{o.count}</span>
              ) : null}
              {on ? (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--ds-accent)]" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}


/**
 * TEAMS: every room in the company, including the one that belongs to all of it.
 *
 * The company feed was its own tab, which put the single room everybody
 * shares outside the screen that holds every other room. Somebody wanting to
 * say something to the whole company went to a different place than somebody
 * wanting to say it to one team, for no reason a user could have guessed.
 */
/**
 * CIRCLES: every room in the company.
 *
 * NO SUB-TABS AND NO SECOND HEADER. It had a Teams/Everyone switch and two
 * stacked titles saying almost the same word, which is three pieces of
 * furniture in front of the thing somebody came for. The company-wide feed
 * was the only reason for the switch, and anything in it that actually needs
 * a person now surfaces on Overview, where unread things belong.
 */
/**
 * NETWORK: everyone this company knows, as a picture.
 *
 * ITS OWN DESTINATION NOW, and it should always have been. It was a sub-tab
 * of Circles, which put two unrelated questions behind one label: "who do we
 * know" and "what is my team talking about". People looking for one had to
 * know the other existed to find it, and the graph -- the thing somebody
 * connects a calendar to SEE -- was two clicks from the front door.
 */
function NetworkTab({ ctx }: { ctx: Extract<OrgContext, { kind: "org" }> }) {
  return (
    <>
      <PageHeader
        title="Network"
        note="Everyone this company knows, drawn from the calendars and inboxes people already have. Nobody enters anything."
      />
      <PageBody className="max-w-[1680px]">
        <NetworkWorkspace meId={ctx.amberId} />
      </PageBody>
    </>
  );
}

/**
 * CIRCLES: the rooms, and what is in them.
 *
 * NO CANVAS. The old screen drew circles as nodes you could drag -- a
 * picture of which teams exist, which is an org chart. An org chart tells
 * you a room EXISTS and gives you nothing to do in it. This is the room:
 * rooms down the left, the one you are in on the right, and inside it the
 * conversation, the work people have shared in, the files, the links, who is
 * here and what these people have been in a room for.
 */
function CirclesTab({
  ctx,
  isAdmin,
}: {
  ctx: Extract<OrgContext, { kind: "org" }>;
  isAdmin: boolean;
}) {
  return (
    <>
      <PageHeader
        title="Circles"
        note="Your rooms. Each one holds its own conversation, the projects and artifacts people have shared into it, its files, its links and its calendar."
      />
      <PageBody className="max-w-[1680px]">
        <CircleRoom
          meId={ctx.amberId}
          groups={ctx.groups.map((g) => ({ id: g.id, name: g.name }))}
          isAdmin={isAdmin}
        />
      </PageBody>
    </>
  );
}

/**
 * KNOWLEDGE: everything the company keeps, and everything that reads it.
 *
 * TWO PLACES, NOT THREE. Files and pages were separate tabs asking one
 * question -- where is the thing I am looking for -- so they are one Library
 * now. They are still two lists underneath, and a single search across both
 * is the next piece of work rather than something this commit pretends to
 * have done.
 *
 * The assistants sit beside the material rather than in a settings screen,
 * because "what can Copilot see" is a question about this shelf.
 */
function KnowledgeTab({
  ctx,
  isAdmin,
  apiUrl,
}: {
  ctx: Extract<OrgContext, { kind: "org" }>;
  isAdmin: boolean;
  apiUrl: string;
}) {
  /*
   * THREE PLACES, NOT FOUR, AND THE NAMES SAY WHAT THEY HOLD.
   *
   * FILES is everything the company keeps and everything that puts
   * something there: the four counts, the uploader, the search, the import,
   * and the pages themselves -- readable, which is the only thing the old
   * Library gave that the Files tab did not.
   *
   * WHY THOSE WERE EVER SEPARATE is not a good reason: a page and a file
   * are the same thing to the person looking for it, and Import was a
   * destination because it is the first thing somebody does -- which is an
   * argument for putting it at the top of Files, not in a tab of its own
   * that is empty forever afterwards.
   *
   * ID is what this company is plugged into, in two halves: the personal
   * side and the working side. AGENTS is the assistants themselves.
   */
  const [view, setView] = useState<"files" | "id" | "agents">("files");

  return (
    <>
      <PageHeader
        title="Knowledge"
        note="Everything this company keeps, and everything that fills it. What is yours stays yours until you share it, one piece at a time."
      />
      <SubNav
        value={view}
        onChange={setView}
        options={[
          { value: "files" as const, label: "Files" },
          { value: "id" as const, label: "ID" },
          { value: "agents" as const, label: "Agents" },
        ]}
      />

      <Keep on={view === "files"}>
        <PageBody>
          <div className="space-y-6">
            {/*
              ASKING COMES FIRST, AND STAYS.
              
              It was under the counts and the uploader, which is the order
              somebody BUILDS a page in and not the order they use one:
              nobody arrives at a knowledge base wanting to look at how many
              megabytes are stored. The question is the reason they came, so
              it is the first thing on the page -- and it stays pinned while
              they scroll, because the answer usually prompts a second
              question and scrolling back up to ask it is how people stop
              asking.
            */}
            {/*
              IT STICKS BELOW THE TITLE, NOT OVER IT.
              
              `top-0` put it at the top of the SCROLLING viewport, which is
              where PageHeader already is -- so scrolling slid the ask bar up
              and over the word Knowledge and its own chips covered the tabs.
              A sticky element inside a page that already has a sticky header
              has to start below that header and sit beneath it in the stack,
              or the two fight over the same strip of screen.
            */}
            <div className="sticky top-[78px] z-10 -mx-6 bg-[var(--ds-bg)]/95 px-6 pb-3 pt-3 backdrop-blur-md lg:-mx-8 lg:px-8">
              <AskBar placeholder="Ask about anything in here — a document, a decision, who wrote what" />
            </div>

            {/*
              THE COUNTS AND THE UPLOADER LEAD, unchanged: how many files,
              how much is stored, how many we can read the text inside, how
              many tags. Then search, which looks inside the files and not
              only at their names.
            */}
            <Drive groups={ctx.groups} isAdmin={isAdmin} meId={ctx.amberId} />

            {/*
              IMPORT MOVED HERE FROM A TAB OF ITS OWN. It is the thing that
              fills this page, so it belongs on it -- and a tab somebody
              visits once and never again is a tab that costs every other
              visit a wrong guess.
            */}
            <Section
              title="Bring in an assistant's work"
              note="A Claude or ChatGPT export, a folder of skills, an Obsidian vault, or a single artifact you built. Every part of the archive is read — projects, skills, artifacts, notes and records — and you choose who gets each piece before anything is kept."
            >
              <div className="px-4 pb-4">
                <AiImport groups={ctx.groups} />
              </div>
            </Section>

            {/*
              AND THE PAGES, READABLE, which is what the Library was for.
              Same component, same search, same opening -- it is simply
              here now, where somebody looking for something looks.
            */}
            <Knowledge groups={ctx.groups} isAdmin={isAdmin} meId={ctx.amberId} />
          </div>
        </PageBody>
      </Keep>

      <Keep on={view === "id"}>
        <PageBody>
          <Identity
            onGoToFiles={() => setView("files")}
            onGoToAgents={() => setView("agents")}
          />
        </PageBody>
      </Keep>

      {/*
        FOUR THINGS CONNECT, AND THE DIRECTORY IS GONE.
        
        Copilot, Claude, ChatGPT and the calendar. The connector catalogue
        under it listed every product a company might use, none of which
        does anything here, and all of which made the four that matter look
        like entries in a list rather than the point of the screen.
      */}
      <Keep on={view === "agents"}>
        <PageBody>
          <AssistantFlow apiBase={apiUrl} />
        </PageBody>
      </Keep>
    </>
  );
}


/**
 * RELATIONSHIPS: external and internal.
 *
 * Colleagues and customers were two tabs, and the question that matters --
 * who here knows this person -- spans both by definition.
 */
function RelationshipsTab({
  ctx,
  isAdmin,
}: {
  ctx: Extract<OrgContext, { kind: "org" }>;
  isAdmin: boolean;
}) {
  const [view, setView] = useState<"external" | "internal">("external");

  return (
    <>
      <PageHeader
        title="Relationships"
        note="Everyone this company deals with, built from the work people and agents already do. Nobody enters anything."
      />
      <SubNav
        value={view}
        onChange={setView}
        options={[
          { value: "external" as const, label: "External" },
          { value: "internal" as const, label: "Internal" },
        ]}
      />
      <Keep on={view === "external"}>
        <PageBody className="max-w-[1560px]">
          {/*
            HERE TOO, because this is where the question usually is. "What
            happened with Harris" is asked while looking at the graph, not
            while browsing the library, and sending somebody to another tab
            to ask about what is on this screen is the kind of thing that
            makes a feature go unused.
          */}
          <div className="mb-4">
            <AskBar placeholder="Ask about anyone here — what happened, who knows them, what is going quiet" />
          </div>
          <RelationshipMemory meId={ctx.amberId} scope="external" />
        </PageBody>
      </Keep>
      {/*
        THE SAME SCREEN FOR COLLEAGUES. A colleague is a relationship with
        the same shape as a customer -- met on a date, somebody knows them
        better than you, can go quiet -- and a thinner screen for them would
        say otherwise. The roster of accounts and invitations is below it,
        because that is administration rather than a relationship.
      */}
      <Keep on={view === "internal"}>
        <PageBody className="max-w-[1560px]">
          <RelationshipMemory meId={ctx.amberId} scope="internal" />
        </PageBody>
        <PeopleTab isAdmin={isAdmin} ctx={ctx} />
      </Keep>
    </>
  );
}

/* ───────────────────────────────────────────────────────────────── overview */

/**
 * The front page: what is in here, what needs a person today, what changed.
 *
 * Numbers first, because they are the fastest answer to "is this thing alive".
 * Then the two things somebody can act on. The ceiling is not here any more --
 * it got its own place in the rail, which is what it deserved all along, and
 * folding it into the overview only ever made the overview longer.
 */
/**
 * THE WHOLE COMPANY ON ONE SCREEN.
 *
 * This was four counters and two lists, which answers "how many pages are
 * there" -- a question nobody has. The question somebody opening a workspace
 * actually has is harder and more useful: is this place alive, who is in it,
 * what is each team doing, what is waiting on me, and what have we not set up
 * yet. Every panel below answers one of those and nothing below answers none
 * of them.
 *
 * IT READS THROUGH THE SAME CACHE KEYS THE OTHER SCREENS USE, which is the
 * reason it can afford to be this dense. The console warms `feed:all:any`,
 * `drive:all:all:`, `pages:all` and `groups:all` the moment it knows who you
 * are, so this page is assembled from answers that have already arrived
 * rather than from six new requests -- and clicking through to Feed or Files
 * afterwards is instant for the same reason. Adding detail here costs
 * nothing; it is the same data, arranged for a different question.
 *
 * EMPTY PANELS DO NOT RENDER. A workspace on day one should show a short page
 * about getting started, not nine boxes explaining that they are empty. A
 * dashboard where half the panels always say "nothing yet" is one people
 * learn to skim, and they skim the full ones too.
 */
/**
 * A SCREEN THAT IS HIDDEN RATHER THAN DESTROYED.
 *
 * `{on ? <Screen/> : null}` is the default way to switch tabs in React and it
 * is the reason this console felt slow. It does not hide a screen, it
 * unmounts it: state gone, scroll position gone, rendered tree gone, every
 * effect torn down. Clicking back pays for all of it again. No amount of
 * caching the DATA removes that, because the data was never the expensive
 * part once it was cached -- the remount was.
 *
 * So: render it once, then toggle `hidden`. A tab click becomes a CSS change.
 *
 * LAZY, so the console's first paint is one screen rather than nine. `seen`
 * flips the first time a tab is opened and never flips back, which is the
 * whole state machine.
 *
 * `hidden` rather than `display: none` in a class: it is the attribute that
 * means this, it takes the content out of the accessibility tree and out of
 * tab order, and a stray `display: flex` in a child cannot override it the
 * way it can override a utility class.
 */
function Keep({ on, children }: { on: boolean; children: React.ReactNode }) {
  const [seen, setSeen] = useState(on);
  useEffect(() => {
    if (on) setSeen(true);
  }, [on]);
  if (!seen) return null;
  /*
   * The visibility is published to the subtree, because a kept screen is
   * mounted and therefore its timers are still running. A chat polling every
   * twenty seconds behind four other tabs is work nobody is looking at, and
   * it is the one real cost of not unmounting -- so the screens that poll
   * read this and stop. A screen with no timers can ignore it entirely.
   */
  return (
    <ScreenVisible.Provider value={on}>
      <div hidden={!on}>{children}</div>
    </ScreenVisible.Provider>
  );
}

function Overview({
  ctx,
  isAdmin,
  go,
}: {
  ctx: Extract<OrgContext, { kind: "org" }>;
  isAdmin: boolean;
  go: (t: Tab) => void;
}) {
  const [shares, setShares] = useState<{ count: number; blocked: number } | null>(null);
  const [invites, setInvites] = useState<OrgInvite[]>([]);

  /* The four warmed keys, read rather than refetched. */
  const { data: roster } = useCached("groups:all", async () => {
    const token = tokenNow();
    if (!token) return { groups: [] as OrgGroup[], members: [] as OrgMember[], web: [] as [string, string[]][] };
    const [g, m, opts] = await Promise.all([
      getGroups(token),
      getMembers(token),
      getAudienceOptions(token),
    ]);
    return {
      groups: g.groups,
      members: m.members,
      web: opts.groups.map((gr) => [gr.id, gr.memberIds] as [string, string[]]),
    };
  });
  const { data: feed } = useCached("feed:all:any", () => getFeed({}));
  const { data: drive } = useCached("drive:all:all:", () => getDrive({}));
  const { data: wiki } = useCached("knowledge", () => getKnowledge());

  const members = useMemo(() => roster?.members ?? [], [roster]);
  const groups = useMemo(() => roster?.groups ?? [], [roster]);
  const web = useMemo(() => new Map(roster?.web ?? []), [roster]);
  const posts = useMemo(() => feed?.posts ?? [], [feed]);
  const files = useMemo(() => drive?.files ?? [], [drive]);

  const stats = wiki?.stats ?? null;
  const recent = useMemo(() => wiki?.recent ?? [], [wiki]);
  const open = useMemo(() => wiki?.openQuestions ?? [], [wiki]);

  useEffect(() => {
    const token = tokenNow();
    if (!token || !isAdmin) return;
    getOrgShares(token).then((r) => setShares({ count: r.count, blocked: r.blocked })).catch(() => {});
    getInvites(token).then((r) => setInvites(r.invites)).catch(() => {});
  }, [isAdmin]);

  /*
   * COUNTED BY THE DATABASE, NOT BY THIS PAGE.
   *
   * `posts` is the feed's page — sixty rows — so filtering it for "this week"
   * is accurate right up until the company posts more than sixty times, and
   * then it quietly undercounts forever. The totals come down with the pulse.
   */
  const pulse = wiki?.pulse ?? [];
  const thisWeek = wiki?.posts?.week ?? 0;
  const fortnight = wiki?.posts?.fortnight ?? 0;

  /*
   * A PAGE UNTOUCHED IN NINETY DAYS IS NOT NECESSARILY WRONG -- but it is the
   * only thing a wiki can honestly flag, and a wiki that flags nothing is one
   * people stop trusting all at once rather than page by page.
   */
  const stale = useMemo(
    () => recent.filter((p) => Date.now() - new Date(p.updated_at).getTime() > 90 * 864e5),
    [recent],
  );

  /** Last message per group, so a team can be seen to have gone quiet. */
  const lastByGroup = useMemo(() => {
    const m = new Map<string, Post>();
    for (const p of posts) {
      if (!p.group_id) continue;
      const have = m.get(p.group_id);
      if (!have || p.created_at > have.created_at) m.set(p.group_id, p);
    }
    return m;
  }, [posts]);

  /*
   * WHO HAS NOT SAID ANYTHING.
   *
   * Not a performance metric and not presented as one -- it is the honest
   * read on whether a workspace has actually been adopted or whether three
   * people are talking to each other while eleven never signed in. That is
   * the single most useful thing an owner can know in the first month, and it
   * is invisible from a page count.
   */
  const spoke = useMemo(
    () => new Set(posts.map((p) => p.author_id).filter(Boolean) as string[]),
    [posts],
  );
  const quiet = members.filter((m) => !spoke.has(m.amberId));

  /** What this workspace has not set up. Only the unfinished parts show. */
  const todo = [
    {
      done: members.length > 1,
      title: "Invite the rest of the team",
      note: "A workspace with one person in it is a notebook.",
      tab: "people" as Tab,
    },
    {
      done: groups.length > 0,
      title: "Make the groups that already exist",
      note: "The two or three names people say in meetings. They become who a thing can be shared with.",
      tab: "groups" as Tab,
    },
    {
      done: posts.length > 0,
      title: "Say something",
      note: "An empty feed is the thing that decides whether anybody comes back.",
      tab: "feed" as Tab,
    },
    {
      done: (stats?.pages ?? 0) > 0,
      title: "Write down the thing you explain twice a week",
      note: "This is the part of the company that outlives the people in it.",
      tab: "knowledge" as Tab,
    },
    {
      done: files.length > 0,
      title: "Put the files somewhere everyone can find them",
      note: "Searchable by what is inside them, not only by filename.",
      tab: "files" as Tab,
    },
  ].filter((t) => !t.done);

  return (
    <>
      <PageHeader
        title="Overview"
        note={
          posts.length === 0 && members.length <= 1
            ? "Nothing has happened here yet. The list below is the short version of getting started."
            : `${members.length} ${members.length === 1 ? "person" : "people"}, ${groups.length} ${
                groups.length === 1 ? "group" : "groups"
              }, ${thisWeek} ${thisWeek === 1 ? "message" : "messages"} this week.`
        }
        actions={
          <>
            <Button tone="quiet" onClick={() => go("teams")}>
              <MessageSquare className="h-3.5 w-3.5" />
              Post an update
            </Button>
            <Button tone="primary" onClick={() => go("knowledge")}>
              <Plus className="h-3.5 w-3.5" />
              Write a page
            </Button>
          </>
        }
      />

      <PageBody className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            value={members.length}
            label="People"
            icon={<Users className="h-3.5 w-3.5" />}
            hint={
              quiet.length
                ? `${quiet.length} ${quiet.length === 1 ? "has" : "have"} not posted yet`
                : "everybody has posted"
            }
          />
          <Stat
            value={thisWeek}
            label="Messages this week"
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            hint={`${fortnight} in the last fortnight`}
          />
          <Stat
            value={stats?.open_questions ?? "—"}
            label="Open questions"
            tone={stats?.open_questions ? "accent" : undefined}
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            hint={stats?.open_questions ? "nobody has answered these" : "all answered"}
          />
          <Stat
            value={(stats?.pages ?? 0) + files.length}
            label="Pages and files"
            icon={<BookOpen className="h-3.5 w-3.5" />}
            hint={`${stats?.pages ?? 0} written, ${files.length} uploaded`}
          />
        </div>

        {/* IS THIS PLACE ALIVE. One strip answers it; no counter does. */}
        {fortnight > 0 ? (
          <Section title="Activity" note="Every message in the company, by day.">
            <Pulse buckets={pulse} />
          </Section>
        ) : null}

        {todo.length > 0 ? (
          <Section
            title="Not set up yet"
            note="Each of these takes a minute and changes what the workspace is worth to somebody who opens it next week."
            bodyClassName="p-0"
          >
            <List>
              {todo.map((t) => (
                <ListRow key={t.title} onClick={() => go(t.tab)}>
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-dashed border-[var(--ds-line-strong)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-[var(--ds-ink)]">
                      {t.title}
                    </span>
                    <span className="block truncate text-[12px] text-[var(--ds-dim)]">
                      {t.note}
                    </span>
                  </span>
                </ListRow>
              ))}
            </List>
          </Section>
        ) : null}

        <LinkPersonalCard />

        {/*
          WHAT NEEDS A PERSON TODAY. Neither panel renders when it is empty --
          an empty "needs attention" box is one people learn to skip, which is
          how the full one gets skipped too.
        */}
        {open.length || stale.length ? (
          <div className="grid gap-5 lg:grid-cols-2">
            {open.length ? (
              <Section
                title="Nobody has answered these"
                note="A question with no answer is the one thing here worth putting in front of somebody who did not come looking."
                action={<Button tone="ghost" onClick={() => go("teams")}>Open feed</Button>}
                bodyClassName="p-0"
              >
                <List>
                  {open.slice(0, 5).map((q) => (
                    <ListRow key={q.id} onClick={() => go("teams")}>
                      <Avatar name={q.author_name} size={24} />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ds-ink)]">
                        {q.title ?? q.body.slice(0, 80)}
                      </span>
                      <span className="shrink-0 text-[12px] text-[var(--ds-dim)]">
                        {ago(q.created_at)}
                      </span>
                    </ListRow>
                  ))}
                </List>
              </Section>
            ) : null}

            {stale.length ? (
              <Section
                title="Not touched in a season"
                note="Still true, probably. Worth the ninety seconds it takes somebody to confirm that."
                action={<Button tone="ghost" onClick={() => go("knowledge")}>Open wiki</Button>}
                bodyClassName="p-0"
              >
                <List>
                  {stale.slice(0, 5).map((p) => (
                    <ListRow key={p.id} onClick={() => go("knowledge")}>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ds-ink)]">
                        {p.title}
                      </span>
                      <span className="shrink-0 text-[12px] text-[var(--ds-dim)]">
                        {ago(p.updated_at)}
                      </span>
                    </ListRow>
                  ))}
                </List>
              </Section>
            ) : null}
          </div>
        ) : null}

        {/*
          EVERY TEAM, AND WHETHER IT IS STILL RUNNING.

          The member count alone says a group exists. The last message says
          whether anybody is in it -- which is the difference between an org
          chart and a picture of the company.
        */}
        {groups.length > 0 ? (
          <Section
            title="Every group"
            note="Who is in each one, and when it last said anything."
            action={<Button tone="ghost" onClick={() => go("teams")}>Open groups</Button>}
            bodyClassName="p-0"
          >
            <List>
              {groups.map((g) => {
                const ids = new Set(web.get(g.id) ?? []);
                const faces = members.filter((m) => ids.has(m.amberId)).slice(0, 5);
                const last = lastByGroup.get(g.id);
                return (
                  <ListRow key={g.id} onClick={() => go("teams")}>
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: hueFor(g.name) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-[var(--ds-ink)]">
                        {g.name}
                      </span>
                      <span className="block truncate text-[12px] text-[var(--ds-dim)]">
                        {last
                          ? `${last.author_name ?? "Someone"}: ${last.body.slice(0, 60)}`
                          : g.purpose || "Nothing said here yet"}
                      </span>
                    </span>
                    <span className="hidden shrink-0 -space-x-1.5 sm:flex">
                      {faces.map((m) => (
                        <Avatar key={m.amberId} name={m.fullName || m.email} size={22} />
                      ))}
                    </span>
                    <span className="shrink-0 text-[12px] text-[var(--ds-dim)]">
                      {last ? ago(last.created_at) : `${g.memberCount}`}
                    </span>
                  </ListRow>
                );
              })}
            </List>
          </Section>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          <Section
            title="Latest"
            note="The last thing said, across every group you can see."
            action={<Button tone="ghost" onClick={() => go("teams")}>Open feed</Button>}
            bodyClassName="p-0"
          >
            {posts.length === 0 ? (
              <Empty
                icon={<MessageSquare className="h-4 w-4" />}
                title="Nothing said yet"
                note="A company feed is only useful once somebody starts it. Post the update you were about to put in an email."
                action={
                  <Button tone="primary" onClick={() => go("teams")}>
                    Post the first message
                  </Button>
                }
              />
            ) : (
              <List>
                {posts.slice(0, 6).map((p) => (
                  <ListRow key={p.id} onClick={() => go("teams")}>
                    <Avatar name={p.author_name} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-[var(--ds-ink)]">
                        {p.title ?? p.body.slice(0, 90)}
                      </span>
                      <span className="block truncate text-[12px] text-[var(--ds-dim)]">
                        {p.author_name ?? "Someone"}
                        {p.group_name ? ` in ${p.group_name}` : ""}
                        {p.answers ? ` · ${p.answers} ${p.answers === 1 ? "reply" : "replies"}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] text-[var(--ds-dim)]">
                      {ago(p.created_at)}
                    </span>
                  </ListRow>
                ))}
              </List>
            )}
          </Section>

          <div className="space-y-5">
            {recent.length > 0 ? (
              <Section
                title="Recently written"
                action={<Button tone="ghost" onClick={() => go("knowledge")}>All pages</Button>}
                bodyClassName="p-0"
              >
                <List>
                  {recent.slice(0, 4).map((p) => (
                    <ListRow key={p.id} onClick={() => go("knowledge")}>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ds-ink)]">
                        {p.title}
                      </span>
                      <span className="shrink-0 text-[12px] text-[var(--ds-dim)]">
                        {ago(p.updated_at)}
                      </span>
                    </ListRow>
                  ))}
                </List>
              </Section>
            ) : null}

            <Section title="You" note="What this account is inside the company.">
              <dl className="space-y-3 text-[13px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--ds-muted)]">Role</dt>
                  <dd className="text-[var(--ds-ink)]">{ctx.role}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--ds-muted)]">Groups</dt>
                  <dd className="text-right text-[var(--ds-ink)]">
                    {ctx.groups.length ? ctx.groups.map((g) => g.name).join(", ") : "none yet"}
                  </dd>
                </div>
                {isAdmin ? (
                  <>
                    <div className="flex justify-between gap-3">
                      <dt className="text-[var(--ds-muted)]">Invitations out</dt>
                      <dd className="tnum text-[var(--ds-ink)]">{invites.length}</dd>
                    </div>
                    {shares ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-[var(--ds-muted)]">Shared outside</dt>
                        <dd className="tnum text-right text-[var(--ds-ink)]">
                          {shares.count}
                          {shares.blocked ? (
                            <span className="ml-1 text-[var(--ds-dim)]">
                              · {shares.blocked} blocked
                            </span>
                          ) : null}
                        </dd>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </dl>
              <p className="mt-4 border-t border-[var(--ds-line)] pt-4 text-[12px] leading-relaxed text-[var(--ds-dim)]">
                This is your company account. Anything you keep in a personal Amber is a
                separate account with separate data. Nothing crosses between them.
              </p>
            </Section>
          </div>
        </div>

        {/*
          WHO IS HERE, AND WHO HAS NOT SPOKEN.

          Admin-only and framed carefully: it is a read on whether the
          workspace has been adopted, not a leaderboard. "Has not posted" is a
          fact about this tool, not about a colleague, and the wording has to
          keep saying so or it becomes something it should not be.
        */}
        {isAdmin && members.length > 1 ? (
          <Section
            title="Who is here"
            note={
              quiet.length
                ? `${quiet.length} of ${members.length} have not posted yet — usually a sign they have not been shown what this is for.`
                : "Everybody in the company has posted at least once."
            }
            action={<Button tone="ghost" onClick={() => go("relationships")}>Open people</Button>}
            bodyClassName="p-0"
          >
            <List>
              {members.slice(0, 8).map((m) => (
                <ListRow key={m.amberId} onClick={() => go("relationships")}>
                  <Avatar name={m.fullName || m.email} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-[var(--ds-ink)]">
                      {m.fullName || m.email || "Unnamed"}
                    </span>
                    {m.title ? (
                      <span className="block truncate text-[12px] text-[var(--ds-dim)]">
                        {m.title}
                      </span>
                    ) : null}
                  </span>
                  {m.role === "admin" ? <Badge tone="accent">admin</Badge> : null}
                  {spoke.has(m.amberId) ? null : <Badge>not posted</Badge>}
                </ListRow>
              ))}
            </List>
          </Section>
        ) : null}
      </PageBody>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────── people */

function PeopleTab({
  isAdmin,
  ctx,
}: {
  isAdmin: boolean;
  ctx: Extract<OrgContext, { kind: "org" }>;
}) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [groups, setGroups] = useState<OrgGroup[]>([]);
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [reissuing, setReissuing] = useState<OrgInvite | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const token = tokenNow();
    if (!token) return;
    getMembers(token).then((r) => setMembers(r.members)).catch(() => {});
    getGroups(token).then((r) => setGroups(r.groups)).catch(() => {});
    if (isAdmin) getInvites(token).then((r) => setInvites(r.invites)).catch(() => {});
  }, [isAdmin]);

  useEffect(load, [load]);

  async function act(fn: (t: string) => Promise<unknown>) {
    const token = tokenNow();
    if (!token) return;
    setError(null);
    try {
      await fn(token);
      load();
    } catch (e) {
      setError(e instanceof AmberError ? e.message : "That did not work.");
    }
  }

  const shown = useMemo(() => {
    const text = q.trim().toLowerCase();
    if (!text) return members;
    return members.filter((m) =>
      [m.fullName, m.email, m.title, m.bio].some((v) => String(v ?? "").toLowerCase().includes(text)),
    );
  }, [members, q]);

  return (
    <>
      <PageHeader
        title="People"
        note={`${members.length} ${members.length === 1 ? "person" : "people"} in this company`}
        actions={
          isAdmin ? (
            <Button tone="primary" onClick={() => setInviting(true)}>
              <UserPlus className="h-3.5 w-3.5" />
              Invite
            </Button>
          ) : null
        }
      />

      <PageBody className="space-y-5">
        {openPerson ? (
          <PersonCard amberId={openPerson} onClose={() => setOpenPerson(null)} />
        ) : (
          <>
            {/*
              THE SEARCH COMES BEFORE THE ROSTER, because the roster answers
              "who is here" and almost nobody opens this page to ask that. They
              open it to find the one person who has done the thing they are
              about to do.
            */}
            <WhoKnows onOpenPerson={setOpenPerson} />

            <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
              <Section
                title="Everyone"
                action={
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ds-dim)]" />
                    <TextField
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Filter"
                      className="h-8 w-44 pl-8"
                    />
                  </div>
                }
                bodyClassName="p-0"
              >
                {error ? <div className="px-5 pt-4"><Alert>{error}</Alert></div> : null}
                <List>
                  {shown.map((m) => (
                    <ListRow key={m.amberId}>
                      <button
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        onClick={() => setOpenPerson(m.amberId)}
                      >
                        <Avatar name={m.fullName || m.email} size={30} />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-[var(--ds-ink)]">
                            {m.fullName || m.email || m.phone || "Unnamed"}
                            {m.title ? (
                              <span className="font-normal text-[var(--ds-dim)]"> · {m.title}</span>
                            ) : null}
                          </span>
                          <span className="block truncate text-[12px] text-[var(--ds-dim)]">
                            {m.bio || m.email || m.phone || "no address on file"}
                          </span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        {m.role === "admin" ? <Badge tone="accent">admin</Badge> : null}
                        {m.status === "suspended" ? <Badge tone="danger">suspended</Badge> : null}
                        {isAdmin ? (
                          <Menu>
                            <MenuTrigger asChild>
                              <Button tone="ghost" size="sm">···</Button>
                            </MenuTrigger>
                            <MenuContent>
                              <MenuItem
                                onSelect={() =>
                                  act((t) =>
                                    updateMember(t, m.amberId, {
                                      role: m.role === "admin" ? "member" : "admin",
                                    }),
                                  )
                                }
                              >
                                {m.role === "admin" ? "Make member" : "Make admin"}
                              </MenuItem>
                              <MenuItem
                                onSelect={() =>
                                  act((t) =>
                                    updateMember(t, m.amberId, {
                                      status: m.status === "active" ? "suspended" : "active",
                                    }),
                                  )
                                }
                              >
                                {m.status === "active" ? "Suspend" : "Restore"}
                              </MenuItem>
                              <MenuItem danger onSelect={() => act((t) => removeMember(t, m.amberId))}>
                                <Trash2 className="h-3.5 w-3.5" />
                                Remove from company
                              </MenuItem>
                            </MenuContent>
                          </Menu>
                        ) : null}
                      </div>
                    </ListRow>
                  ))}
                  {shown.length === 0 ? <Empty title={`Nobody matches “${q.trim()}”`} /> : null}
                </List>
                {isAdmin ? (
                  <p className="border-t border-[var(--ds-line)] px-5 py-3 text-[12px] leading-relaxed text-[var(--ds-dim)]">
                    Suspending stops someone reading the company&rsquo;s feed on their next request,
                    and stops them sharing into it. Removing takes them off the roster. Neither
                    touches their account or anything in it.
                  </p>
                ) : null}
              </Section>

              <div className="space-y-5">
                <MyProfile initial={ctx.profile ?? {}} />
                <Credentials />

                {isAdmin && invites.length ? (
                  <Section
                    title="Invitations out"
                    note="Nobody on this list is in the company yet. Get the link to send it yourself."
                    bodyClassName="p-0"
                  >
                    <List>
                      {invites.map((i) => (
                        <ListRow key={i.id}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-[var(--ds-ink)]">{i.email}</span>
                            <span className="block text-[12px] text-[var(--ds-dim)]">
                              {i.role} · expires{" "}
                              {i.expiresAt ? new Date(i.expiresAt).toLocaleDateString() : "—"}
                            </span>
                          </span>
                          <Button tone="quiet" size="sm" onClick={() => setReissuing(i)}>
                            Get link
                          </Button>
                          <Button tone="ghost" size="sm" onClick={() => act((t) => revokeInvite(t, i.id))}>
                            Revoke
                          </Button>
                        </ListRow>
                      ))}
                    </List>
                  </Section>
                ) : null}
              </div>
            </div>
          </>
        )}
      </PageBody>

      <InviteModal open={inviting} onOpenChange={setInviting} groups={groups} onDone={load} />
      <ReissueModal invite={reissuing} onClose={() => setReissuing(null)} onDone={load} />
    </>
  );
}

/**
 * THE LINK AGAIN, WHICH MEANS A NEW ONE.
 *
 * Only the hash of a token is stored, so the original genuinely cannot be
 * produced twice. The dialog says that before it does it rather than after,
 * because the previous link stops working -- which is the right behavior and
 * not one to discover from somebody else's confusion.
 */
function ReissueModal({
  invite,
  onClose,
  onDone,
}: {
  invite: OrgInvite | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [result, setResult] = useState<{
    url: string;
    emailed: boolean;
    reason: string | null;
    detail: string | null;
    domain: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [invite?.id]);

  async function go() {
    const token = tokenNow();
    if (!token || !invite) return;
    setBusy(true);
    setError(null);
    try {
      const r = await reissueInvite(token, invite.id);
      setResult({
        url: r.acceptUrl,
        emailed: r.emailed,
        reason: r.deliveryReason,
        detail: r.deliveryDetail,
        domain: r.sendingDomain ?? null,
      });
      onDone();
    } catch (e) {
      setError(e instanceof AmberError ? e.message : "Could not reissue that invitation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!invite}
      onOpenChange={(v) => !v && onClose()}
      title={`Invitation for ${invite?.email ?? ""}`}
      note="We only ever store a hash of the link, so this issues a new one. Any link already sent to this address stops working."
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button tone="ghost" onClick={onClose}>Cancel</Button>
            <Button tone="primary" busy={busy} onClick={go}>
              Issue a new link
            </Button>
          </>
        )
      }
    >
      <Alert>{error}</Alert>
      {result ? (
        <div className="space-y-3">
          <p className="text-[13px] text-[var(--ds-muted)]">
            {result.emailed
              ? `Emailed ${invite?.email}. The link, in case you want to send it yourself:`
              : result.reason === "not_configured"
                ? "No mail provider is configured, so nothing was sent. Send this link yourself:"
                : `The mail provider refused it${
                    result.detail ? ` (${result.detail})` : ""
                  }.${
                    result.domain
                      ? ` Verify ${result.domain} at resend.com/domains and this stops happening.`
                      : ""
                  } Send this link yourself:`}
          </p>
          <code className="block break-all rounded-lg border border-[var(--ds-line)] bg-[var(--ds-hover)] px-3 py-2 text-[12px] text-[var(--ds-accent-ink)]">
            {result.url}
          </code>
          <Button tone="quiet" onClick={() => navigator.clipboard?.writeText(result.url)}>
            Copy link
          </Button>
        </div>
      ) : (
        <p className="text-[13px] text-[var(--ds-muted)]">
          {invite?.role === "admin"
            ? "They will join as an admin, able to invite people and set the sharing policy."
            : "They will join as a member, able to read and write everything except the roster and the policy."}
        </p>
      )}
    </Modal>
  );
}

function InviteModal({
  open,
  onOpenChange,
  groups,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groups: OrgGroup[];
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{
    email: string;
    url: string;
    emailed: boolean;
    reason: string | null;
    detail: string | null;
    domain: string | null;
  } | null>(null);

  async function send() {
    const token = tokenNow();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createInvite(token, email.trim(), role, groupId || null);
      setIssued({
        email: r.invite.email,
        url: r.acceptUrl,
        emailed: r.emailed,
        reason: r.deliveryReason,
        detail: r.deliveryDetail,
        domain: r.sendingDomain ?? null,
      });
      setEmail("");
      onDone();
    } catch (e) {
      setError(e instanceof AmberError ? e.message : "Could not create that invite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setIssued(null);
      }}
      title="Invite somebody"
      note="A work email is how somebody gets in. The link works once and expires in seven days."
      footer={
        issued ? (
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        ) : (
          <>
            <Button tone="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button tone="primary" busy={busy} disabled={!email.trim()} onClick={send}>
              Send invitation
            </Button>
          </>
        )
      }
    >
      <Alert>{error}</Alert>
      {issued ? (
        <div className="space-y-3">
          {/*
            WHY IT WAS NOT SENT, when it was not. This said "email is not
            configured here yet" for every failure, including a correctly
            configured provider rejecting the send -- which sends somebody to
            check an environment variable that is already right.
          */}
          <p className="text-[13px] text-[var(--ds-muted)]">
            {issued.emailed
              ? `Emailed ${issued.email}. The link, in case you want to send it yourself:`
              : issued.reason === "not_configured"
                ? "No mail provider is configured on this server, so nothing was sent. The link works regardless:"
                : `The invitation was created, but the mail provider refused it${
                    issued.detail ? ` (${issued.detail})` : ""
                  }.${
                    issued.domain
                      ? ` Verify ${issued.domain} at resend.com/domains and this stops happening.`
                      : ""
                  } Send this link yourself:`}
          </p>
          <code className="block break-all rounded-lg border border-[var(--ds-line)] bg-[var(--ds-hover)] px-3 py-2 text-[12px] text-[var(--ds-accent-ink)]">
            {issued.url}
          </code>
          <Button tone="quiet" onClick={() => navigator.clipboard?.writeText(issued.url)}>
            Copy link
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Work email">
            <TextField
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </Field>
          <Field label="Role">
            <Segmented
              value={role}
              onChange={setRole}
              options={[
                { value: "member", label: "Member" },
                { value: "admin", label: "Admin" },
              ]}
            />
          </Field>
          {groups.length ? (
            <Field
              label="Group"
              hint="Putting them straight into a group means they see that group's work on day one."
            >
              <div className="flex flex-wrap gap-1.5">
                <button className="ent-choice" data-on={groupId === ""} onClick={() => setGroupId("")}>
                  No group
                </button>
                {groups.map((g) => (
                  <button
                    key={g.id}
                    className="ent-choice"
                    data-on={groupId === g.id}
                    onClick={() => setGroupId(g.id)}
                  >
                    {g.name}
                  </button>
                ))}
              </div>
            </Field>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────────── groups */

/**
 * GROUPS, AND THEY CAN ACTUALLY BE MADE AND UNMADE NOW.
 *
 * Creating one was a two-field form at the bottom of a right-hand column with
 * no heading on it, and deleting one was not there at all. Both are now where
 * somebody would look for them: a button in the page header, and a menu on the
 * row.
 *
 * DELETING ASKS FIRST, and the question names what else goes with it. A group
 * is an audience, so removing it is not only removing a label -- anything
 * addressed to it loses its audience. That is a sentence somebody should read
 * before they confirm rather than discover afterwards.
 */
/**
 * Who is in a group, and the two buttons that change that.
 *
 * Lifted out of the page's JSX because the accordion renders it per group
 * rather than once, and a hundred lines of membership list inlined five
 * levels deep in a render prop is a thing nobody can find again.
 */
function GroupPeople({
  group,
  members,
  inGroup,
  isAdmin,
  onAct,
}: {
  group: OrgGroup;
  members: OrgMember[];
  inGroup: Set<string>;
  isAdmin: boolean;
  onAct: (fn: (t: string) => Promise<unknown>, refresh?: string) => void;
}) {
  if (members.length === 0) {
    return (
      <Empty
        title="Nobody in the company yet"
        note="Invite people first, then add them to this group."
      />
    );
  }
  return (
    <List>
      {members.map((m) => {
        const on = inGroup.has(m.amberId);
        return (
          <ListRow key={m.amberId}>
            <Avatar name={m.fullName || m.email} size={26} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-[var(--ds-ink)]">
                {m.fullName || m.email || "Unnamed"}
              </span>
              {m.title ? (
                <span className="block truncate text-[12px] text-[var(--ds-dim)]">
                  {m.title}
                </span>
              ) : null}
            </span>
            {isAdmin ? (
              <Button
                tone={on ? "quiet" : "ghost"}
                size="sm"
                onClick={() =>
                  onAct(
                    (t) =>
                      on
                        ? removeFromGroup(t, group.id, m.amberId)
                        : addToGroup(t, group.id, m.amberId),
                    group.id,
                  )
                }
              >
                {on ? "Remove" : "Add"}
              </Button>
            ) : on ? (
              <Badge tone="accent">in this group</Badge>
            ) : null}
          </ListRow>
        );
      })}
    </List>
  );
}

function GroupsTab({
  isAdmin,
  orgName,
  meId,
}: {
  isAdmin: boolean;
  orgName: string;
  meId: string | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [inGroup, setInGroup] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<OrgGroup | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<OrgGroup | null>(null);
  /*
    MESSAGES FIRST, NOT PEOPLE.
    
    Opening a group landed on its membership list, which is the thing you
    change twice a year, in front of the thing you came for. A channel opens
    on its conversation.
  */
  const [groupView, setGroupView] = useState<GroupView>("feed");

  /*
   * ONE REQUEST, NOT ONE PER GROUP -- AND CACHED ACROSS TAB SWITCHES.
   *
   * Two separate costs were being paid here. The first was a member list per
   * group: six groups meant seven round trips. That is now three, in
   * parallel, which getAudienceOptions already returns in one shape.
   *
   * The second was worse and survived the first fix. The console renders its
   * tabs as `{tab === "groups" ? <GroupsTab/> : null}`, so every click
   * UNMOUNTED this component and the next mount started from nothing:
   * spinner, three round trips, content. Clicking Feed and back meant doing
   * it all again for data four seconds old. Going through the module cache
   * means a remount renders the previous answer on its first frame and
   * revalidates behind it -- which is the whole of why the console felt slow
   * rather than anything about the queries themselves.
   */
  const { data, loading, error: loadError, revalidate } = useCached(
    "groups:all",
    async () => {
      const token = tokenNow();
      if (!token) return { groups: [] as OrgGroup[], members: [] as OrgMember[], web: [] as [string, string[]][] };
      const [g, m, opts] = await Promise.all([
        getGroups(token),
        getMembers(token),
        getAudienceOptions(token),
      ]);
      return {
        groups: g.groups,
        members: m.members,
        // A Map is not structurally cloneable through the cache in any way
        // worth relying on, so the entries go in and the Map is rebuilt.
        web: opts.groups.map((gr) => [gr.id, gr.memberIds] as [string, string[]]),
      };
    },
  );

  const groups = useMemo(() => data?.groups ?? [], [data]);
  const members = useMemo(() => data?.members ?? [], [data]);
  const web = useMemo(() => new Map(data?.web ?? []), [data]);

  const load = useCallback(() => {
    drop("groups");
    void revalidate();
  }, [revalidate]);

  async function act(fn: (t: string) => Promise<unknown>, refresh?: string) {
    const token = tokenNow();
    if (!token) return;
    setError(null);
    try {
      await fn(token);
      load();
      if (refresh) {
        const r = await getGroupMembers(token, refresh).catch(() => ({ members: [] }));
        setInGroup(new Set(r.members.map((x) => x.amberId)));
      }
    } catch (e) {
      setError(e instanceof AmberError ? e.message : "That did not work.");
    }
  }

  async function openGroup(id: string | null) {
    if (id === null) {
      setOpen(null);
      return;
    }
    /*
     * Selecting the open group again keeps it open.
     *
     * Toggling made sense when the panel was an expanding row underneath the
     * list. Beside the canvas it is a pane, and clicking the highlighted node
     * to make the pane go blank is not something anybody meant to do.
     */
    setOpen(id);
    if (open === id) return;
    const token = tokenNow();
    if (!token) return;
    const r = await getGroupMembers(token, id).catch(() => ({ members: [] }));
    setInGroup(new Set(r.members.map((x) => x.amberId)));
  }

  /*
   * THE LAST THING SAID IN EACH GROUP, AND WHETHER IT IS NEW.
   *
   * Both come off the company feed, which is already loaded and already
   * carries group_id on every post -- so a list of six teams showing their
   * most recent line costs no extra requests. A per-group endpoint would be
   * the obvious implementation and six round trips.
   *
   * "Unread" is measured against the feed watermark the rail badge already
   * uses. It is per person and approximate at the edges (a message posted in
   * the same second you last looked may or may not count), which is the right
   * amount of precision for a badge whose job is to be noticed.
   */
  const { data: feedAll } = useCached("feed:all:any", () => getFeed({}));
  const { data: wiki } = useCached("knowledge", () => getKnowledge());
  const seenAt = wiki?.unread?.seenAt ?? null;
  const lastByGroup = useMemo(() => {
    const m = new Map<string, Post>();
    for (const p of feedAll?.posts ?? []) {
      if (!p.group_id) continue;
      const have = m.get(p.group_id);
      if (!have || p.created_at > have.created_at) m.set(p.group_id, p);
    }
    return m;
  }, [feedAll]);

  const unreadByGroup = useMemo(() => {
    const m = new Map<string, number>();
    const since = seenAt;
    if (!since) return m;
    for (const p of feedAll?.posts ?? []) {
      if (!p.group_id) continue;
      if (p.author_id === meId) continue; // your own words are not news
      if (p.created_at <= since) continue;
      m.set(p.group_id, (m.get(p.group_id) ?? 0) + 1);
    }
    return m;
  }, [feedAll, seenAt, meId]);

  return (
    <>
      <PageHeader
        title="Circles"
        note="The audience between “just me” and “everyone here”, and how the company is arranged."
        actions={
          isAdmin ? (
            <Button tone="primary" onClick={() => setEditing("new")}>
              <Plus className="h-3.5 w-3.5" />
              New group
            </Button>
          ) : null
        }
      />

      {/*
        WIDER THAN THE REST OF THE CONSOLE, deliberately. Every other screen
        is a column of text and 1240px is the right measure for reading. This
        one is a list beside a diagram, and the diagram was being squeezed
        into a third of a column where the group labels overlapped their own
        edges. Two things side by side need the room that two things need.
      */}
      <PageBody className="max-w-[1560px] space-y-5">
        <Alert>
          {error ??
            (loadError instanceof AmberError
              ? loadError.message
              : loadError
                ? "Could not load groups."
                : null)}
        </Alert>

        {/*
          THE LIST IS THE SCREEN. THE PICTURE IS REFERENCE.
          
          This was a list on one side and a detail panel on the other, which
          is a file browser -- the right shape when the list is long and you
          are picking one of many. A company has six teams, you are in three,
          and the question is never "which one" but "what is happening in any
          of them". A detail panel answers that one team at a time and hides
          the rest behind a click each.
          
          So every group is a row, collapsed, carrying the last thing said in
          it and a badge if something is unread; opening one unfolds it where
          it sits and pushes the others down. The list never leaves the
          screen, which is the whole point: you can see Sales has three
          unread while you are reading Engineering.
        */}
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(380px,0.78fr)_minmax(0,1fr)]">
          <div className="space-y-1.5 xl:order-1">
            {loading ? (
              <Section><Spinner /></Section>
            ) : (
              <>
                <GroupAccordion
                  groups={groups}
                  members={members}
                  membership={web}
                  lastByGroup={lastByGroup}
                  unreadByGroup={unreadByGroup}
                  openId={open}
                  view={groupView}
                  isAdmin={isAdmin}
                  onOpen={openGroup}
                  onView={setGroupView}
                  onEdit={(g) => setEditing(g)}
                  onDelete={(g) => setConfirmDelete(g)}
                  onNew={() => setEditing("new")}
                  /*
                   * Both save and then refresh, rather than refetching to
                   * find out what we just asked for. The list on screen has
                   * already moved -- the accordion holds the order during
                   * the drag -- so this is the write, not the read.
                   */
                  onReorder={(ids) =>
                    act((t) => setGroupOrder(t, ids))
                  }
                  onPin={(id, pinned) =>
                    act((t) => setGroupPinned(t, id, pinned))
                  }
                  renderPanel={(g, v) => (
                    /*
                      Every view is mounted together and hidden, so flicking
                      between Messages and Files keeps the conversation's
                      scroll position and the half-typed message in the box.
                      Keyed on the group, because a different group is a
                      genuinely different conversation.
                    */
                    <div key={g.id}>
                      <Keep on={v === "feed"}>
                        <GroupChat
                          groupId={g.id}
                          groupName={g.name}
                          meId={meId}
                          meName={members.find((m) => m.amberId === meId)?.fullName ?? null}
                          isAdmin={isAdmin}
                        />
                      </Keep>

                      <Keep on={v === "calendar"}>
                        <TeamCalendar
                          groupId={g.id}
                          groupName={g.name}
                          meId={meId}
                          isAdmin={isAdmin}
                        />
                      </Keep>

                      <Keep on={v === "files"}>
                        <Drive
                          groups={[{ id: g.id, name: g.name }]}
                          isAdmin={isAdmin}
                          meId={meId}
                          compact
                          fixedGroup={g.id}
                        />
                      </Keep>

                      <Keep on={v === "links"}>
                        <div className="px-4 py-3">
                          <Connections
                            groupId={g.id}
                            groupName={g.name}
                            meId={meId}
                            isAdmin={isAdmin}
                            headless
                          />
                        </div>
                      </Keep>

                      <Keep on={v === "people"}>
                        <GroupPeople
                          group={g}
                          members={members}
                          inGroup={inGroup}
                          isAdmin={isAdmin}
                          onAct={act}
                        />
                      </Keep>
                    </div>
                  )}
                />
                {isAdmin ? <NewGroupRow onNew={() => setEditing("new")} /> : null}
              </>
            )}
          </div>

          {groups.length > 0 ? (
            <Section
              className="xl:order-2 xl:sticky xl:top-4"
              title="How the company is arranged"
              note="Drag a group to move it. Connect two to say what runs between them."
            >
              <CompanyCanvas
                orgName={orgName}
                groups={groups}
                members={members}
                membership={web}
                activeGroup={open}
                onPick={(id) => openGroup(id)}
                onChanged={load}
                height={620}
              />
            </Section>
          ) : null}
        </div>
      </PageBody>

      <GroupModal
        value={editing}
        onClose={() => setEditing(null)}
        onSave={async (body, id) => {
          await act((t) => (id ? updateGroup(t, id, body) : createGroup(t, body)));
          setEditing(null);
        }}
      />

      <Modal
        open={!!confirmDelete}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
        title={`Delete ${confirmDelete?.name ?? "this group"}?`}
        note="A group is an audience. Anything shared to this one loses its audience, and anybody in it stops seeing that work. Nobody is removed from the company and nothing else is deleted, and any connections drawn to it on the canvas go with it."
        footer={
          <>
            <Button tone="ghost" onClick={() => setConfirmDelete(null)}>Keep it</Button>
            <Button
              tone="danger"
              onClick={async () => {
                const g = confirmDelete;
                setConfirmDelete(null);
                if (!g) return;
                if (open === g.id) setOpen(null);
                await act((t) => deleteGroup(t, g.id));
              }}
            >
              Delete group
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-[var(--ds-muted)]">
          {confirmDelete?.memberCount
            ? `${confirmDelete.memberCount} ${confirmDelete.memberCount === 1 ? "person is" : "people are"} in it.`
            : "Nobody is in it."}
        </p>
      </Modal>
    </>
  );
}

function GroupModal({
  value,
  onClose,
  onSave,
}: {
  value: OrgGroup | "new" | null;
  onClose: () => void;
  onSave: (body: { name: string; purpose?: string; description?: string }, id?: string) => Promise<void>;
}) {
  const existing = value && value !== "new" ? value : null;
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const seedId = existing?.id ?? "";
  useEffect(() => {
    setName(existing?.name ?? "");
    setPurpose(existing?.purpose ?? "");
    setDescription(existing?.description ?? "");
  }, [seedId, existing?.name, existing?.purpose, existing?.description]);

  return (
    <Modal
      open={!!value}
      onOpenChange={(v) => !v && onClose()}
      title={existing ? `Edit ${existing.name}` : "New group"}
      note="The purpose is the line somebody reads at the moment they are choosing an audience, so write it for that moment."
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>Cancel</Button>
          <Button
            tone="primary"
            busy={busy}
            disabled={!name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(
                  { name: name.trim(), purpose: purpose.trim(), description: description.trim() },
                  existing?.id,
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {existing ? "Save" : "Create group"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <TextField
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enterprise Sales"
          />
        </Field>
        <Field label="Purpose" hint="One line, shown beside the name wherever an audience is chosen.">
          <TextField
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Deals over $50k and the accounts behind them"
          />
        </Field>
        <Field label="Description" hint="The longer version, for this page.">
          <TextArea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional."
          />
        </Field>
      </div>
    </Modal>
  );
}

/* ─────────────────────────────────────────────────────────────────── policy */

/**
 * THE CEILING EDITOR. The most consequential screen in the product, so it says
 * out loud where a thing ends up rather than making somebody infer it from the
 * word in a dropdown.
 */
function PolicyTab({
  isAdmin,
  initial,
  org,
  onSaved,
}: {
  isAdmin: boolean;
  initial: OrgPolicy;
  org: { name: string; emailDomain?: string | null; restrictDomain?: boolean };
  onSaved: () => void;
}) {
  const [policy, setPolicyState] = useState<OrgPolicy>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = useMemo(() => CLASSIFICATIONS.some((c) => policy[c] !== initial[c]), [policy, initial]);

  async function save() {
    const token = tokenNow();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const r = await setPolicy(token, policy);
      setPolicyState(r.policy);
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof AmberError ? e.message : "Could not save the policy.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Sharing policy"
        note="A ceiling, not a default. Everyone picks their own audience below your line."
        actions={
          isAdmin ? (
            <Button tone="primary" busy={busy} disabled={!dirty} onClick={save}>
              Save policy
            </Button>
          ) : null
        }
      />

      <PageBody className="space-y-5">
        <Alert>{error}</Alert>
        {saved && !dirty ? <Alert tone="info">Saved. It is in force now.</Alert> : null}

        <Section
          title="How far each kind of thing may travel"
          note="You are not choosing what anyone shares. You are choosing the widest audience each kind of thing is allowed to reach. Moving a line applies to what is already shared, not only to what comes next."
          bodyClassName="p-0"
        >
          <div className="divide-y divide-[var(--ds-line)]">
            {CLASSIFICATIONS.map((c: Classification) => (
              <div key={c} className="px-5 py-5">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[14px] font-semibold text-[var(--ds-ink)]">
                    {CLASSIFICATION_LABEL[c]}
                  </h3>
                  <span className="text-[12px] text-[var(--ds-dim)]">{CLASSIFICATION_HINT[c]}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SHARE_SCOPES.map((s) => (
                    <button
                      key={s}
                      disabled={!isAdmin}
                      className="ent-choice"
                      data-on={policy[c] === s}
                      onClick={() => {
                        setSaved(false);
                        setPolicyState({ ...policy, [c]: s });
                      }}
                    >
                      {SCOPE_LABEL[s]}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-[var(--ds-muted)]">
                  {SCOPE_CONSEQUENCE[policy[c]]}
                </p>
              </div>
            ))}
          </div>
        </Section>

        {/*
          WHO IS ALLOWED TO BE INVITED, which is a different question from how
          far a shared thing travels and is here because this is the screen
          admins already open to answer "what are the rules in this company".
        */}
        <DomainRule isAdmin={isAdmin} org={org} onSaved={onSaved} />

        {isAdmin ? <ServerSetup /> : null}

        <Section title="Why the order is what it is">
          <p className="text-[13px] leading-relaxed text-[var(--ds-muted)]">
            The scale runs by blast radius, not by headcount. One named customer sits further out
            than your entire company, because once something leaves the building it has left, and
            an admin who caps something at &ldquo;everyone here&rdquo; means exactly that it does
            not go to customers. A scale ordered by how many people are on the far end would get
            that backwards.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--ds-muted)]">
            The limit is checked when something is shared and again every time somebody tries to
            read it. That is why tightening a line takes effect immediately on things shared last
            month, and why loosening one brings them back.
          </p>
        </Section>
      </PageBody>
    </>
  );
}

/* ───────────────────────────────────────────────────────────────── activity */

function ActivityTab() {
  const [shares, setShares] = useState<OrgShare[]>([]);
  const [blocked, setBlocked] = useState(0);
  const [loading, setLoading] = useState(true);
  const [only, setOnly] = useState<"all" | "blocked">("all");

  useEffect(() => {
    const token = tokenNow();
    if (!token) return;
    getOrgShares(token)
      .then((r) => {
        setShares(r.shares);
        setBlocked(r.blocked);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const shown = only === "blocked" ? shares.filter((s) => !s.permitted) : shares;

  return (
    <>
      <PageHeader
        title="Activity"
        note="Everything shared into this company, and whether the ceiling let it through."
      />
      <PageBody className="space-y-5">
        <Segmented
          value={only}
          onChange={setOnly}
          options={[
            { value: "all", label: "Everything", count: shares.length },
            { value: "blocked", label: "Over the ceiling", count: blocked },
          ]}
        />
        <Section bodyClassName="p-0">
          {loading ? (
            <Spinner />
          ) : shown.length === 0 ? (
            <Empty
              icon={<Sparkles className="h-4 w-4" />}
              title={only === "blocked" ? "Nothing is over the ceiling" : "Nothing shared yet"}
              note={
                only === "blocked"
                  ? "Every share in this company is within the limits you set."
                  : "This fills in as people share work into the company."
              }
            />
          ) : (
            <List>
              {shown.map((s) => (
                <ListRow key={s.id}>
                  <Avatar name={s.author} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-[var(--ds-ink)]">
                      {s.author ?? "Someone"} shared a {s.itemType.replace(/_/g, " ")}
                    </span>
                    <span className="block truncate text-[12px] text-[var(--ds-dim)]">
                      {AUDIENCE_LABEL[s.scopeType] ?? s.scopeType}
                      {s.groupName ? ` · ${s.groupName}` : ""} · {CLASSIFICATION_LABEL[s.classification]}
                    </span>
                  </span>
                  {!s.permitted ? <Badge tone="danger">over the ceiling</Badge> : null}
                </ListRow>
              ))}
            </List>
          )}
        </Section>
      </PageBody>
    </>
  );
}

/**
 * Marks the feed read when the tab is opened, and only then.
 *
 * Deliberately not a side effect of loading the feed: the overview screen also
 * loads it, and opening the overview should not clear a badge for posts
 * nobody has looked at.
 */
function FeedSeen({ onSeen }: { onSeen: () => void }) {
  useEffect(() => {
    markFeedSeen().then(onSeen).catch(() => {});
    // Once per mount. The tab unmounts when you leave it, so coming back marks
    // whatever arrived while you were elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/**
 * THE COMPANY'S EMAIL DOMAIN, AND WHETHER IT IS A RULE.
 *
 * Two separate facts, because both sentences are wanted: a company can BE
 * paychex.com for labelling and for the join screen without refusing the one
 * contractor on their own address. Collapsing them would force a company to
 * delete its own domain in order to invite somebody.
 *
 * It is never an auto-join. A matching address admits nobody — an invitation
 * is still the only way in, and this only narrows which addresses may be sent
 * one. A domain that let anybody in would make every ex-employee's lingering
 * Google account a live key.
 */
function DomainRule({
  isAdmin,
  org,
  onSaved,
}: {
  isAdmin: boolean;
  org: { emailDomain?: string | null; restrictDomain?: boolean };
  onSaved: () => void;
}) {
  const [domain, setDomain] = useState(org.emailDomain ?? "");
  const [restrict, setRestrict] = useState(org.restrictDomain === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = domain !== (org.emailDomain ?? "") || restrict !== (org.restrictDomain === true);

  async function save() {
    const token = tokenNow();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const clean = domain.trim().toLowerCase().replace(/^@/, "");
      await updateOrg(token, {
        emailDomain: clean || null,
        restrictDomain: Boolean(clean) && restrict,
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof AmberError ? e.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Who can be invited"
      note="An invitation is the only way anybody joins. This decides which addresses may be sent one."
    >
      <Alert>{error}</Alert>
      {saved && !dirty ? <Alert tone="info">Saved.</Alert> : null}

      <div className="space-y-3">
        <Field label="Company email domain" hint="Leave it empty if people join on all sorts of addresses.">
          <TextField
            disabled={!isAdmin}
            value={domain}
            onChange={(e) => {
              setSaved(false);
              setDomain(e.target.value.trim().replace(/^@/, "").toLowerCase());
            }}
            placeholder="paychex.com"
          />
        </Field>

        {domain.trim() ? (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--ds-line)] bg-[var(--ds-hover)] px-3 py-2.5">
            <input
              type="checkbox"
              disabled={!isAdmin}
              checked={restrict}
              onChange={(e) => {
                setSaved(false);
                setRestrict(e.target.checked);
              }}
              className="mt-0.5"
            />
            <span>
              <span className="block text-[13px] text-[var(--ds-ink)]">
                Only allow @{domain.trim()} addresses
              </span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-[var(--ds-muted)]">
                Invitations to any other address are refused. Turn this off if you work with
                contractors or agencies on their own addresses.
              </span>
            </span>
          </label>
        ) : null}

        {isAdmin ? (
          <Button tone="primary" busy={busy} disabled={!dirty} onClick={save}>
            Save
          </Button>
        ) : null}
      </div>
    </Section>
  );
}

/**
 * WHAT THIS DEPLOYMENT CAN ACTUALLY DO.
 *
 * Both of the doors a company needs fail SILENTLY by design: the Google
 * button hides itself rather than leading somebody to "not configured", and
 * an invitation is created and then quietly not delivered. Each is right for
 * the person signing in and a dead end for the person who has to turn it on —
 * "I still do not see Continue with Google" had no answer anywhere in the
 * product, which is how an afternoon goes.
 *
 * It names variables, never values, and it is admin-only.
 */
function ServerSetup() {
  const [setup, setSetup] = useState<OrgSetup | null>(null);

  useEffect(() => {
    const token = tokenNow();
    if (!token) return;
    getOrgSetup(token).then(setSetup).catch(() => {});
  }, []);

  if (!setup) return null;
  if (setup.google.ready && setup.email.ready) return null;

  return (
    <Section
      title="Server setup"
      note="Two things this deployment needs, and what is missing. Only admins see this."
      bodyClassName="p-0"
    >
      <div className="divide-y divide-[var(--ds-line)]">
        <SetupRow
          label="Continue with Google"
          ready={setup.google.ready}
          whenReady={
            setup.google.callbackUrl
              ? `On. Google must have ${setup.google.callbackUrl} registered as an authorized redirect URI.`
              : "On."
          }
          whenMissing={
            <>
              The button does not render until these are set on the API:{" "}
              <Vars names={setup.google.missing} />. These are not the{" "}
              <code className="text-[12px]">GOOGLE_CLIENT_ID</code> /{" "}
              <code className="text-[12px]">GOOGLE_CLIENT_SECRET</code> another service uses — different
              variables, different purpose. Then register{" "}
              <code className="text-[12px]">&lt;AMBER_API_BASE_URL&gt;/v1/org/auth/google/callback</code>{" "}
              in Google Cloud Console as an authorized redirect URI.
            </>
          }
        />
        <SetupRow
          label="Invitation emails"
          ready={setup.email.ready}
          whenReady={
            setup.email.sendingDomain
              ? `On, sending from ${setup.email.sendingDomain}. A 403 validation_error means that domain is not verified at resend.com/domains yet — the invitation is still created and the link still works.`
              : "On."
          }
          whenMissing={
            <>
              Invitations are created but never sent. Set <Vars names={setup.email.missing} /> on the API.
              The link in the invite dialog works either way.
            </>
          }
        />
      </div>
    </Section>
  );
}

function SetupRow({
  label,
  ready,
  whenReady,
  whenMissing,
}: {
  label: string;
  ready: boolean;
  whenReady: React.ReactNode;
  whenMissing: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-[14px] font-semibold text-[var(--ds-ink)]">{label}</h3>
        <Badge tone={ready ? "accent" : "danger"}>{ready ? "On" : "Off"}</Badge>
      </div>
      <p className="text-[13px] leading-relaxed text-[var(--ds-muted)]">
        {ready ? whenReady : whenMissing}
      </p>
    </div>
  );
}

function Vars({ names }: { names: string[] }) {
  return (
    <>
      {names.map((n, i) => (
        <span key={n}>
          {i > 0 ? ", " : ""}
          <code className="rounded bg-[var(--ds-hover)] px-1 py-0.5 text-[12px] text-[var(--ds-accent-ink)]">
            {n}
          </code>
        </span>
      ))}
    </>
  );
}

/**
 * THE GROUP'S OWN HEADER — two fixed rows, so every group looks the same.
 *
 * This used to be Section's title/note/action, and that header is
 * `flex flex-wrap justify-between`: a group with a short purpose kept its tab
 * strip on the right, and one with a long purpose pushed the strip onto its
 * own line. Same screen, two layouts, decided by how much somebody typed into
 * a description field.
 *
 * Identity on row one, tabs on row two, always.
 */
function GroupHeader({
  group,
  members,
  view,
  onView,
}: {
  group: { id: string; name: string; purpose?: string | null };
  members: number;
  view: "people" | "feed" | "files" | "calendar" | "links";
  onView: (v: "people" | "feed" | "files" | "calendar" | "links") => void;
}) {
  const TABS: { key: typeof view; label: string }[] = [
    { key: "feed", label: "Messages" },
    { key: "files", label: "Files" },
    { key: "calendar", label: "Calendar" },
    { key: "links", label: "Links" },
    { key: "people", label: `People · ${members}` },
  ];

  return (
    <div className="border-b border-[var(--ds-line)] px-5 py-3.5">
      <div className="flex items-center gap-2.5">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[12px] font-semibold"
          style={{ background: "var(--ds-accent-soft)", color: "var(--ds-accent-ink)" }}
        >
          {group.name.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-[var(--ds-ink)]">{group.name}</h2>
          <p className="truncate text-[12px] text-[var(--ds-muted)]">
            {group.purpose || "No purpose written"}
          </p>
        </div>
      </div>

      <div className="mt-3 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => onView(t.key)}
            className={
              "whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all " +
              (view === t.key
                ? "bg-[var(--ds-accent-soft)] text-[var(--ds-ink)]"
                : "text-[var(--ds-muted)] hover:bg-[var(--ds-hover)] hover:text-[var(--ds-ink)]")
            }
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * HOW DATA GETS IN AND OUT OF HERE, ON ONE SCREEN.
 *
 * Three things that are all the same question asked at different depths, and
 * they belong in one place because somebody onboarding a company asks all
 * three in the same five minutes:
 *
 *   Directory  — the products we know about, added with one click.
 *   Links      — the URLs this company keeps re-finding. No tokens, no sync.
 *   API        — a key, and the one curl that gets everything back out.
 *
 * WHY SUB-VIEWS AND NOT ONE LONG SCROLL. The directory alone is thirty-nine
 * tiles. Put the link map and the key list under it and the two things an
 * admin actually came for are four screens down, which is how a page that
 * contains everything ends up used for nothing.
 */
function ConnectionsTab({
  meId,
  isAdmin,
  apiBaseUrl,
}: {
  meId: string | null;
  isAdmin: boolean;
  apiBaseUrl: string;
}) {
  const [view, setView] = useState<"directory" | "links" | "api">("directory");

  /*
   * ALL THE COMPANY'S GROUPS, NOT THE VIEWER'S OWN.
   *
   * This read `ctx.groups`, which comes from listGroupsForMember -- the
   * groups the signed-in person belongs to. On a page whose whole purpose is
   * "every place this company works in", an admin in none of the four groups
   * was shown "No groups yet" above four groups that plainly exist on the
   * Groups page. The page is about the company, so it asks for the company's
   * groups.
   */
  const { data: groupData } = useCached("org:groups", () => {
    const token = tokenNow();
    if (!token) return Promise.resolve({ groups: [] as OrgGroup[], count: 0 });
    return getGroups(token);
  });
  const groups = groupData?.groups ?? [];

  return (
    <div className="space-y-5">
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: "directory", label: "Directory" },
          { value: "links", label: "Links", count: undefined },
          { value: "api", label: "API" },
        ]}
      />

      {view === "directory" ? (
        <Connectors isAdmin={isAdmin} apiBase={apiBaseUrl} onGoToApi={() => setView("api")} />
      ) : view === "api" ? (
        <div className="space-y-5">
          <ApiAccess isAdmin={isAdmin} apiBase={apiBaseUrl} />
          {/* The named integration a client asked for by name, with the two
              values they have to paste and nothing between them and it. */}
          <CopilotSetup apiBase={apiBaseUrl} />
        </div>
      ) : (
        <div className="space-y-5">
          <Section
            title="Company-wide"
            note="Every team sees these. The drive, the CRM, the handbook — whatever is everybody's."
          >
            {/* headless: this Section's header already said what the list is,
                and printing the same sentence again under it was the doubled
                header on every one of these panels. */}
            <Connections
              groupId={null}
              groupName={null}
              meId={meId}
              isAdmin={isAdmin}
              headless
            />
          </Section>

          {groups.length === 0 ? (
            <Section title="By team">
              <Empty
                title="No groups yet"
                note="Teams get their own links — the repo, the board, the shared sheet. Make a group first."
              />
            </Section>
          ) : (
            groups.map((g) => (
              <Section key={g.id} title={g.name} note={g.purpose || "No purpose written"}>
                <Connections
                  groupId={g.id}
                  groupName={g.name}
                  meId={meId}
                  isAdmin={isAdmin}
                  hideShared
                  headless
                />
              </Section>
            ))
          )}
        </div>
      )}
    </div>
  );
}
