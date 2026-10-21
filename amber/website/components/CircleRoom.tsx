"use client";

/**
 * A CIRCLE IS A ROOM, AND THIS IS THE ROOM.
 *
 * WHAT IT REPLACES AND WHY. A circle used to be a node on a canvas: a
 * picture of who is in which team, which is an org chart. An org chart tells
 * you a circle EXISTS. It gives you nothing to do in one. Meanwhile the
 * things a circle is actually made of -- the conversation, the work people
 * share into it, the files, the links somebody pasted, the meetings these
 * people were in -- were scattered across four other screens, each a
 * separate destination with its own filter.
 *
 * SO: THE LEFT IS THE ROOMS, THE RIGHT IS THE ROOM. The shape everybody
 * already knows from a chat tool, for the reason that shape won: the list of
 * places is always visible, switching costs one click and loses nothing, and
 * the thing you are in occupies the screen.
 *
 * THE TABS ARE WHAT A ROOM CONTAINS, NOT WHAT THE APP CAN DO. Messages, the
 * work, files, links, people, calendar. Each is the same room seen another
 * way, which is why they are tabs inside it rather than screens beside it --
 * and why the room is fetched once, whole, instead of six times.
 *
 * THE POINT OF THE WORK TAB, which is the part that is not a chat tool: a
 * project, a skill or an artifact somebody built privately can be addressed
 * to a circle, and then it is the room's. A colleague opens the artifact and
 * RUNS it. That is the thing Jason described -- collaborating on a Claude
 * project inside a team chat -- and it works here because sharing is an
 * audience on an existing object rather than a copy of it: the same page,
 * now addressed to these people, with its history intact.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  FileText,
  Link2,
  Loader2,
  MessageSquare,
  Paperclip,
  Check,
  ChevronDown,
  Copy,
  AtSign,
  Maximize2,
  Paperclip as Clip,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Send,
  Trash2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { Button, Empty, Panel } from "@/components/ui";
import ArtifactBody, { readArtifact } from "@/components/ArtifactBody";
import CircleStudio from "@/components/CircleStudio";
import CircleCalendar from "@/components/CircleCalendar";
import Reactions from "@/components/Reactions";
import MessageText from "@/components/MessageText";
import Popover, { PopoverItem } from "@/components/Popover";
import ShareIntoCircle from "@/components/ShareIntoCircle";
import {
  answer as postReply,
  askAmberInCircle,
  uploadToDrive,
  buildInCircle,
  getCircle,
  getCircles,
  getPage,
  post as postMessage,
  type CircleRoom as Room,
  type CircleRow,
} from "@/lib/knowledge";
import { ago } from "@/lib/memory";
import { tokenNow } from "@/lib/amber";
import {
  addToGroup,
  createGroup,
  deleteGroup,
  getMembers,
  createInvite,
  removeFromGroup,
  setGroupPinned,
  updateGroup,
} from "@/lib/org";

type Pane = "messages" | "work" | "files" | "links" | "people" | "calendar";

const WORK_LABEL: Record<string, string> = {
  project: "Project",
  skill: "Skill",
  artifact: "Artifact",
  record: "Record",
  page: "Page",
};

export default function CircleRoom({
  meId,
  groups,
  isAdmin,
}: {
  meId: string;
  groups: { id: string; name: string }[];
  isAdmin: boolean;
}) {
  const [circles, setCircles] = useState<CircleRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(false);
  const [pane, setPane] = useState<Pane>("messages");
  const [making, setMaking] = useState(false);
  /** A piece of work a message linked to, waiting for the Work tab to open it. */
  const [openWork, setOpenWork] = useState<string | null>(null);

  const pinned = (circles ?? []).filter((c) => c.pinnedAt);
  const rest = (circles ?? []).filter((c) => !c.pinnedAt);

  const loadList = useCallback(() => {
    getCircles()
      .then((r) => setCircles(r.circles))
      .catch(() => setCircles([]));
  }, []);

  useEffect(loadList, [loadList]);

  /* The first room opens itself: an empty right pane is a screen that looks
     broken to somebody who has circles. */
  useEffect(() => {
    if (!openId && circles && circles.length > 0) setOpenId(circles[0].id);
  }, [circles, openId]);

  const loadRoom = useCallback(() => {
    if (!openId) return;
    setLoading(true);
    getCircle(openId)
      .then(setRoom)
      .catch(() => setRoom(null))
      .finally(() => setLoading(false));
  }, [openId]);

  /*
   * AFTER SENDING, ONLY THE CHAT CHANGED.
   *
   * Reloading the whole room on every message meant every send waited on the
   * files list, the work list, the member list and a calendar query across
   * everybody in the circle. The messages come back on their own now, and
   * the links are recomputed from them, since a link is something somebody
   * said. Everything else is refetched when a tab that shows it is opened.
   */
  const loadMessages = useCallback(() => {
    if (!openId) return;
    getCircle(openId, { only: "messages" })
      .then((fresh) =>
        setRoom((prev) =>
          prev
            ? { ...prev, messages: fresh.messages, links: fresh.links }
            : fresh,
        ),
      )
      .catch(() => null);
  }, [openId]);

  useEffect(loadRoom, [loadRoom]);

  return (
    <div className="flex h-[calc(100vh-190px)] min-h-[620px] gap-3">
      {/* ------------------------------------------------------- the rail */}
      <Panel className="flex w-[300px] shrink-0 flex-col overflow-hidden rounded-2xl p-0">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <p className="flex items-baseline gap-2">
            <span className="text-[19px] font-semibold text-[var(--ds-ink)]">Circles</span>
            <span className="text-[12.5px] text-[var(--ds-faint)]">{circles?.length ?? 0}</span>
          </p>
          <span className="flex items-center gap-1.5">
            {isAdmin ? (
              <button
                type="button"
                onClick={() => setMaking(true)}
                aria-label="New circle"
                title="New circle"
                className="grid h-7 w-7 place-items-center rounded-lg bg-[#eaf0fb] text-[#2d4675] transition hover:brightness-95"
              >
                <Plus className="h-4 w-4" />
              </button>
            ) : null}
          </span>
        </div>

        {/*
          MAKING A ROOM BELONGS WHERE THE ROOMS ARE. It used to live on the
          canvas screen, which this replaced -- and a product you cannot make
          a second circle in is a demo.
        */}
        {making ? (
          <NewCircle
            onClose={() => setMaking(false)}
            onMade={(id) => {
              setMaking(false);
              loadList();
              setOpenId(id);
            }}
          />
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {circles === null ? (
            <p className="flex items-center gap-2 px-3.5 py-4 text-[12.5px] text-[var(--ds-muted)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </p>
          ) : circles.length === 0 ? (
            <p className="px-3.5 py-4 text-[12.5px] leading-relaxed text-[var(--ds-muted)]">
              No circles yet. {isAdmin ? "Make one and invite people into it." : "An admin can make one."}
            </p>
          ) : (
            <>
              {/*
                PINNED SITS ABOVE, AND ONLY JUST.

                Not a second list with its own heading and its own scroll --
                that is two places to look for a circle, and somebody who
                pins four of six has made the thing harder to use. A faint
                label and a hairline under the group: enough to say "these
                are the ones that matter", not enough to be a separate
                region. Unpinning drops a row down the list and nothing else
                moves.
              */}
              {pinned.length > 0 ? (
                <p className="flex items-center gap-1.5 px-4 pb-1 pt-2 text-[10.5px] uppercase tracking-wide text-[var(--ds-faint)]">
                  <Pin className="h-3 w-3" />
                  Pinned
                </p>
              ) : null}
              {pinned.map((c) => (
                <Row
                  key={c.id}
                  circle={c}
                  open={openId === c.id}
                  isAdmin={isAdmin}
                  onOpen={() => {
                    setOpenId(c.id);
                    setPane("messages");
                  }}
                  onChanged={loadList}
                  onDeleted={() => {
                    if (openId === c.id) setOpenId(null);
                    loadList();
                  }}
                />
              ))}
              {pinned.length > 0 && rest.length > 0 ? (
                <div className="mx-3.5 my-1 border-t border-[var(--ds-line)]" />
              ) : null}
              {rest.map((c) => (
                <Row
                  key={c.id}
                  circle={c}
                  open={openId === c.id}
                  isAdmin={isAdmin}
                  onOpen={() => {
                    setOpenId(c.id);
                    setPane("messages");
                  }}
                  onChanged={loadList}
                  onDeleted={() => {
                    if (openId === c.id) setOpenId(null);
                    loadList();
                  }}
                />
              ))}
            </>
          )}
        </div>
      </Panel>

      {/* ------------------------------------------------------- the room */}
      <Panel className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl p-0">
        {!openId ? (
          <div className="grid flex-1 place-items-center">
            <Empty title="Pick a circle" note="Everything that circle holds opens here." />
          </div>
        ) : !room ? (
          <div className="grid flex-1 place-items-center">
            <span className="flex items-center gap-2 text-[13px] text-[var(--ds-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Opening…
            </span>
          </div>
        ) : (
          <>
            <RoomHeader room={room} pane={pane} onPane={setPane} busy={loading} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {pane === "messages" ? (
                <Messages
                  room={room}
                  meId={meId}
                  onPosted={() => {
                    loadMessages();
                  }}
                  onOpenWork={(pageId) => {
                    /* Straight to the thing, in the tab that holds it. */
                    setPane("work");
                    setOpenWork(pageId);
                  }}
                  onOpenFiles={() => setPane("files")}
                />
              ) : pane === "work" ? (
                <Work
                  room={room}
                  groups={groups}
                  meId={meId}
                  onChanged={loadRoom}
                  openStudio={openWork}
                  onStudioClosed={() => setOpenWork(null)}
                />
              ) : pane === "files" ? (
                <Files room={room} />
              ) : pane === "links" ? (
                <Links room={room} />
              ) : pane === "people" ? (
                <People room={room} isAdmin={isAdmin} onChanged={loadRoom} />
              ) : (
                <CircleCalendar events={[...room.calendar.past, ...room.calendar.upcoming]} />
              )}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

/**
 * ONE ROW, AND THE THREE DOTS THAT ACT ON IT.
 *
 * WHY A MENU AND NOT BUTTONS. Pin, rename and delete on every row is three
 * controls times thirty circles, all competing with the thing the row is
 * actually for, which is being clicked. They live behind the dots, and the
 * dots appear on hover -- except on the open row, where they stay, since
 * that is the one somebody is most likely to be acting on.
 *
 * DELETE ASKS, AND SAYS WHAT GOES. A circle holds a conversation and is an
 * audience for work people shared into it. Those are not the same fate --
 * the conversation goes and the work stays in Knowledge -- so the question
 * says which is which. "Are you sure?" with nothing after it is not a
 * question anybody can answer.
 */
function Row({
  circle,
  open,
  isAdmin,
  onOpen,
  onChanged,
  onDeleted,
}: {
  circle: CircleRow;
  open: boolean;
  isAdmin: boolean;
  onOpen: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(circle.name);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const act = async (fn: (token: string) => Promise<unknown>) => {
    const token = tokenNow();
    if (!token || busy) return;
    setBusy(true);
    try {
      await fn(token);
    } finally {
      setBusy(false);
    }
  };

  if (renaming) {
    return (
      <div className="px-3.5 py-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === "Escape") {
              setName(circle.name);
              setRenaming(false);
            }
            if (e.key === "Enter" && name.trim()) {
              await act((t) => updateGroup(t, circle.id, { name: name.trim() }));
              setRenaming(false);
              onChanged();
            }
          }}
          onBlur={() => {
            setName(circle.name);
            setRenaming(false);
          }}
          className="w-full rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--ds-accent-ring)]"
        />
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="space-y-2 border-l-2 border-transparent px-3.5 py-2.5">
        <p className="text-[12.5px] leading-relaxed text-[var(--ds-ink)]">
          Delete {circle.name}? Its conversation goes with it. Anything shared into it stays in
          Knowledge and simply stops reaching this circle.
        </p>
        <div className="flex gap-2">
          <Button
            tone="ghost"
            busy={busy}
            onClick={async () => {
              await act((t) => deleteGroup(t, circle.id));
              setConfirming(false);
              onDeleted();
            }}
          >
            Delete it
          </Button>
          <Button tone="ghost" onClick={() => setConfirming(false)}>
            Keep it
          </Button>
        </div>
      </div>
    );
  }

  return (
    /*
      A CARD PER ROOM, not a row in a table. The icon tile gives the eye
      something to land on in a column of names, and the whole card lifts
      when it is the open one -- which is how somebody knows where they are
      without reading.
    */
    <div
      className={`group/row mx-2 mb-1 rounded-xl transition ${
        open ? "bg-[#eaf0fb]" : "hover:bg-[var(--ds-sunk,rgba(0,0,0,.03))]"
      }`}
    >
      <div className="flex items-start gap-2.5 pl-2.5 pr-1.5">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 gap-2.5 py-2.5 text-left">
          <span
            className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
              open ? "bg-white text-[#2d4675]" : "bg-[var(--ds-sunk,rgba(0,0,0,.04))] text-[var(--ds-muted)]"
            }`}
          >
            <Users className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            {circle.pinnedAt ? (
              <Pin className="h-3 w-3 shrink-0 translate-y-[1px] text-[#c89b52]" />
            ) : null}
            <span className="truncate text-[13.5px] font-semibold text-[var(--ds-ink)]">
              {circle.name}
            </span>
            {circle.last ? (
              <span className="shrink-0 text-[10.5px] text-[var(--ds-faint)]">
                {ago(circle.last.at)}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-[var(--ds-muted)]">
            {circle.last
              ? `${circle.last.by ? `${circle.last.by.split(" ")[0]}: ` : ""}${circle.last.preview}`
              : `${circle.memberCount} ${circle.memberCount === 1 ? "person" : "people"}`}
          </span>
          </span>
        </button>

        {/* A circle you are not in is still listed, and marked. */}
        {!circle.mine ? (
          <span className="mt-3 shrink-0 rounded-full bg-[var(--ds-sunk,rgba(0,0,0,.05))] px-1.5 text-[10px] text-[var(--ds-faint)]">
            open
          </span>
        ) : null}

        <button
          type="button"
          aria-label="More"
          onClick={(e) => setMenu((cur) => (cur ? null : e.currentTarget))}
          className={`mt-3 shrink-0 rounded-md p-1 text-[var(--ds-faint)] transition hover:text-[var(--ds-ink)] ${
            menu || open ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"
          }`}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      {/*
        A MENU PINNED TO THE BUTTON, FLOATING ABOVE EVERYTHING.
        
        It expanded the row before, which never clips but pushes every circle
        below it down -- the page appears to jump under the cursor. Fixed
        positioning taken from the button's own rectangle floats clear of the
        scrolling rail, so it cannot be cut off and nothing else moves.
      */}
      {menu ? (
        <Popover anchor={menu} onClose={() => setMenu(null)} width={184}>
          <PopoverItem
            icon={
              circle.pinnedAt ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />
            }
            label={circle.pinnedAt ? "Unpin" : "Pin to the top"}
            onClick={async () => {
              setMenu(null);
              await act((t) => setGroupPinned(t, circle.id, !circle.pinnedAt));
              onChanged();
            }}
          />
          {isAdmin ? (
            <PopoverItem
              icon={<Pencil className="h-3.5 w-3.5" />}
              label="Rename"
              onClick={() => {
                setMenu(null);
                setRenaming(true);
              }}
            />
          ) : null}
          {isAdmin ? (
            <PopoverItem
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label="Delete"
              tone="danger"
              onClick={() => {
                setMenu(null);
                setConfirming(true);
              }}
            />
          ) : null}
        </Popover>
      ) : null}
    </div>
  );
}


/* ----------------------------------------------------------------- head */

function RoomHeader({
  room,
  pane,
  onPane,
  busy,
}: {
  room: Room;
  pane: Pane;
  onPane: (p: Pane) => void;
  busy: boolean;
}) {
  const tabs: { key: Pane; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: "messages", label: "Messages", icon: <MessageSquare className="h-3.5 w-3.5" />, count: room.messages.length },
    { key: "work", label: "Work", icon: <Sparkles className="h-3.5 w-3.5" />, count: room.work.length },
    { key: "files", label: "Files", icon: <Paperclip className="h-3.5 w-3.5" />, count: room.files.length },
    { key: "links", label: "Links", icon: <Link2 className="h-3.5 w-3.5" />, count: room.links.length },
    { key: "people", label: "People", icon: <Users className="h-3.5 w-3.5" />, count: room.people.length },
    { key: "calendar", label: "Calendar", icon: <CalendarDays className="h-3.5 w-3.5" />, count: room.calendar.past.length + room.calendar.upcoming.length },
  ];

  return (
    <div className="border-b border-[var(--ds-line)] px-5 pt-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eaf0fb] text-[#2d4675]">
          <Users className="h-5 w-5" />
        </span>
        <h2 className="text-[19px] font-semibold text-[var(--ds-ink)]">{room.circle.name}</h2>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ds-faint)]" /> : null}
        <span className="text-[12px] text-[var(--ds-muted)]">
          {room.circle.memberCount} {room.circle.memberCount === 1 ? "person" : "people"}
        </span>
      </div>
      {room.circle.purpose ? (
        <p className="mt-0.5 text-[12.5px] text-[var(--ds-muted)]">{room.circle.purpose}</p>
      ) : null}

      {/*
        PILLS, NOT AN UNDERLINE. An underlined tab row is the chrome of a
        document viewer; a filled pill is what a person reads as "you are
        here" without having to find a 2px line. The count sits inside the
        pill so the row is one object per tab rather than two.
      */}
      <div className="mt-3.5 flex flex-wrap gap-1 pb-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onPane(t.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] transition ${
              pane === t.key
                ? "bg-[#eaf0fb] font-medium text-[#2d4675]"
                : "text-[var(--ds-muted)] hover:bg-[var(--ds-sunk,rgba(0,0,0,.03))] hover:text-[var(--ds-ink)]"
            }`}
          >
            {t.icon}
            {t.label}
            {t.count ? (
              <span
                className={`rounded-full px-1.5 text-[11px] ${
                  pane === t.key ? "bg-white/70 text-[#2d4675]" : "text-[var(--ds-faint)]"
                }`}
              >
                {t.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- messages */

/**
 * A STABLE COLOUR PER PERSON.
 *
 * Hashed from the name rather than handed out in order, so the same
 * colleague is the same colour in every room and on every reload -- an
 * assignment by position reshuffles the moment somebody new posts, and a
 * colour people have learned is worse when it moves.
 *
 * These are the tints a messaging app uses, not the ones a dashboard uses:
 * a pale wash behind dark text, chosen so a column of them reads as a
 * conversation rather than as rows of coloured data.
 */
const TONES = [
  { avatar: "#b9ccec", ink: "#2d4675", bubble: "#eaf0fb" },
  { avatar: "#c9d9c0", ink: "#3b5733", bubble: "#eef4ea" },
  { avatar: "#e6c9a8", ink: "#6b4a23", bubble: "#fbf1e6" },
  { avatar: "#d6bde0", ink: "#55356a", bubble: "#f5eef8" },
  { avatar: "#eec2c5", ink: "#73383f", bubble: "#fbeff0" },
  { avatar: "#aed4d6", ink: "#27595c", bubble: "#e9f4f4" },
];

const AMBER_TONE = { avatar: "#d9a441", ink: "#6b4a12", bubble: "#fdf1de" };

function toneFor(name: string | null | undefined) {
  const key = String(name ?? "?");
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

const initials = (name: string | null | undefined) =>
  String(name ?? "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

/** "@amber do the thing" -> "do the thing". Null when it was not tagged. */
export function amberCommand(body: string) {
  const m = String(body ?? "").match(/@amber\b[,:]?\s*([\s\S]+)/i);
  const cmd = m ? m[1].trim() : "";
  return cmd.length >= 2 ? cmd : null;
}

/** The day something was said, for the hairline between days. */
function dayKey(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toDateString();
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/**
 * THE CONVERSATION, SHAPED LIKE A CONVERSATION.
 *
 * WHAT WAS WRONG WITH IT. Bordered cards with a coloured rail down one edge,
 * a monospace-ish density, everything the same width as the window. It read
 * as a log viewer -- correct, legible, and clearly built by somebody who
 * looks at logs. Nobody talks to their team in a log viewer.
 *
 * SO: BUBBLES. An avatar, a name, a soft tinted bubble sized to its own
 * text, days separated by a hairline with the day written on it. The shape
 * everybody already knows from the messaging app on their phone, for the
 * reason that shape won -- the eye follows a column of bubbles without being
 * told how, and a bubble that ends where its sentence ends tells you how
 * long the message is before you read a word.
 *
 * REPLIES HANG UNDER THEIR PARENT on a curved connector rather than inside a
 * nested box. A box inside a box is a tree somebody has to parse; a line
 * from one avatar to the next is a thing people already read as "this came
 * after that, about that".
 */
function Messages({
  room,
  meId,
  onPosted,
  onOpenWork,
  onOpenFiles,
}: {
  room: Room;
  /** Whose messages these are, so an unsent one can wear the right name. */
  meId: string;
  onPosted: () => void;
  /** Open a piece of work full size, from a link inside a message. */
  onOpenWork: (pageId: string) => void;
  /** Jump to the Files tab from an attachment in a message. */
  onOpenFiles?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [amberSteps, setAmberSteps] = useState<AmberStep[] | null>(null);
  const [amberOpen, setAmberOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  /*
   * FILES ATTACHED TO A MESSAGE ARE FILED THE MOMENT THEY ARE PICKED.
   *
   * They upload to this circle's Files as real drive rows -- tagged to the
   * circle, visible on the Files tab -- and the message carries their ids.
   * There is no second copy and nothing to "save to files" afterwards:
   * something somebody dropped in a room IS one of the room's files, and
   * making that a separate step is how a chat becomes a place where
   * everything is lost.
   */
  const [pending, setPending] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(0);
  /*
   * WHAT YOU JUST SAID, BEFORE THE SERVER AGREES.
   *
   * Pressing send used to hold the words in the box until a round trip AND a
   * full reload of the room had finished, which is two requests of staring at
   * your own unsent sentence. The message now appears the instant you send
   * it, greyed until the reload brings back the real one, and the box is
   * empty immediately because that is the part that makes it feel sent.
   */
  const [sending, setSending] = useState<
    { id: string; body: string; files: string[]; at: string }[]
  >([]);

  /* The room already knows everybody in it, including whoever is typing. */
  const meName = room.people.find((p) => p.amberId === meId)?.fullName ?? null;

  /* The reload landed, so the real rows are on screen and the ghosts can go. */
  useEffect(() => {
    setSending([]);
  }, [room.messages.length]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [room.messages.length, sending.length]);

  const runAmber = async (command: string, parentId: string | null) => {
    const started = Date.now();
    const trail: AmberStep[] = [
      { label: "Reading the room", at: started, done: false },
      { label: "Working out what you want", at: 0, done: false },
      { label: "Making it", at: 0, done: false },
      { label: "Filing it in Work", at: 0, done: false },
    ];
    setAmberSteps([...trail]);

    /*
     * The first two phases happen inside one request, so their timings are
     * honest about being estimates -- they advance on a clock rather than on
     * a server event, and the last two are marked by the actual reply.
     */
    const t1 = setTimeout(() => {
      trail[0].done = true;
      trail[1].at = Date.now();
      setAmberSteps([...trail]);
    }, 900);
    const t2 = setTimeout(() => {
      trail[1].done = true;
      trail[2].at = Date.now();
      setAmberSteps([...trail]);
    }, 2600);

    try {
      const r = await askAmberInCircle(room.circle.id, command, parentId);
      clearTimeout(t1);
      clearTimeout(t2);
      trail.forEach((x) => {
        x.done = true;
      });
      trail[3].at = Date.now();
      trail[3].label =
        r.did === "answered" ? "Answered in the room" : `Filed "${r.page?.title ?? "it"}" in Work`;
      setAmberSteps([...trail]);
      setTimeout(() => setAmberSteps(null), 2500);
    } catch (e) {
      clearTimeout(t1);
      clearTimeout(t2);
      trail[2].done = true;
      trail[3].at = Date.now();
      trail[3].done = true;
      trail[3].label =
        (e as { message?: string })?.message ?? "That did not work. Try saying it differently.";
      setAmberSteps([...trail]);
      setTimeout(() => setAmberSteps(null), 6000);
    } finally {
      onPosted();
    }
  };

  const send = async () => {
    const text = draft.trim();
    /*
     * A FILE ON ITS OWN IS A MESSAGE. Requiring words to go with it is a
     * rule the product invented: somebody drops the deck in and has nothing
     * to say about it, and being made to type "here" is the kind of small
     * indignity people notice.
     */
    if (!text && pending.length === 0) return;

    const attached = [...pending];
    const body = text || (attached.length === 1 ? attached[0].name : `${attached.length} files`);
    const ghost = `tmp-${Date.now()}`;

    /* Empty the box first. Everything after this is the network's problem. */
    setDraft("");
    setPending([]);
    setSending((xs) => [
      ...xs,
      { id: ghost, body, files: attached.map((f) => f.name), at: new Date().toISOString() },
    ]);
    setBusy(true);

    try {
      const posted = await postMessage({
        body,
        groupId: room.circle.id,
        audience: { everyone: false, groups: [room.circle.id], people: [] },
        fileIds: attached.map((f) => f.id),
      });
      onPosted();
      const command = amberCommand(text);
      if (command) await runAmber(command, posted?.post?.id ?? null);
    } catch {
      /* Give them their words back rather than swallowing them. */
      setSending((xs) => xs.filter((x) => x.id !== ghost));
      setPending(attached);
      setDraft(text);
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async (postId: string) => {
    const text = replyDraft.trim();
    if (!text) return;

    /* Same rule as sending: the box empties first, the network catches up. */
    setReplyDraft("");
    setReplyTo(null);
    setBusy(true);
    try {
      await postReply(postId, text);
      onPosted();
      const command = amberCommand(text);
      if (command) await runAmber(command, postId);
    } catch {
      setReplyTo(postId);
      setReplyDraft(text);
    } finally {
      setBusy(false);
    }
  };

  const attach = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (list.length === 0) return;
    setUploading((n) => n + list.length);
    for (const f of list) {
      try {
        const up = await uploadToDrive(f, {
          groupId: room.circle.id,
          audience: { everyone: false, groups: [room.circle.id], people: [] },
          description: `Shared in ${room.circle.name}`,
        });
        setPending((cur) => [...cur, { id: up.id, name: up.title || up.filename }]);
      } catch {
        /* The row that failed simply does not appear; the rest still go. */
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
    onPosted();
  };

  const tagged = amberCommand(draft);
  let lastDay = "";

  return (
    <div className="flex h-full flex-col bg-[#fafbfd]">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {room.messages.length === 0 ? (
          <p className="py-10 text-center text-[13.5px] text-[var(--ds-muted)]">
            Nothing said in here yet. The first message starts the room.
          </p>
        ) : (
          room.messages.map((m) => {
            const fromAmber = String(m.body ?? "").startsWith("Amber");
            const tone = fromAmber ? AMBER_TONE : toneFor(m.author_name);
            const key = dayKey(m.created_at);
            const newDay = key !== lastDay;
            lastDay = key;

            return (
              <div key={m.id}>
                {/*
                  THE DAY, ON A HAIRLINE. Timestamps on every message answer
                  "when exactly" and nobody asks that; "was this today" is
                  what people actually want, and a line across the column
                  answers it once for everything under it.
                */}
                {newDay ? (
                  <div className="flex items-center gap-3 py-3">
                    <span className="h-px flex-1 bg-[var(--ds-line)]" />
                    <span className="text-[11.5px] font-medium text-[var(--ds-faint)]">
                      {dayLabel(m.created_at)}
                    </span>
                    <span className="h-px flex-1 bg-[var(--ds-line)]" />
                  </div>
                ) : null}

                <div className="group flex items-start gap-2.5 py-[3px]">
                  <span
                    className="mt-[22px] grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold"
                    style={{ backgroundColor: tone.avatar, color: tone.ink }}
                  >
                    {fromAmber ? "A" : initials(m.author_name)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="mb-0.5 flex items-baseline gap-2">
                      <span className="text-[13px] font-semibold text-[var(--ds-ink)]">
                        {fromAmber ? "Amber" : (m.author_name ?? "Somebody")}
                      </span>
                      <span className="text-[11px] text-[var(--ds-faint)]">
                        {ago(m.created_at)}
                      </span>
                    </p>

                    {/*
                      THE BUBBLE IS SIZED TO ITS OWN TEXT -- max-w, not w --
                      so a two-word message is two words wide. A bubble as
                      wide as the window is a paragraph with a background,
                      which is what made this read as a document.
                    */}
                    <div
                      className="inline-block max-w-[min(680px,88%)] rounded-2xl rounded-tl-md px-3.5 py-2.5"
                      style={{ backgroundColor: tone.bubble }}
                    >
                      {m.title ? (
                        <p className="text-[13.5px] font-semibold text-[var(--ds-ink)]">
                          {m.title}
                        </p>
                      ) : null}
                      <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-[var(--ds-ink)]">
                        <MessageText body={m.body} onOpenWork={onOpenWork} />
                      </p>

                      {/*
                        THE FILE IS IN THE MESSAGE, which is where somebody
                        looks for it. It is also in Files -- one row, two
                        places to find it -- and showing only the second was
                        the same as losing it, because nobody scrolls a chat
                        wondering which tab a thing went to.
                      */}
                      {m.files_list?.length ? (
                        <div className="mt-2 space-y-1.5">
                          {m.files_list.map((f) => (
                            <a
                              key={f.id}
                              href={`#file-${f.id}`}
                              onClick={(e) => {
                                e.preventDefault();
                                onOpenFiles?.();
                              }}
                              className="flex items-center gap-2.5 rounded-xl bg-white/70 px-3 py-2 transition hover:bg-white"
                            >
                              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--ds-sunk,rgba(0,0,0,.05))] text-[var(--ds-muted)]">
                                <Clip className="h-4 w-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium text-[var(--ds-ink)]">
                                  {f.title || f.filename}
                                </span>
                                <span className="block text-[11px] text-[var(--ds-faint)]">
                                  {f.byteSize ? `${Math.round(Number(f.byteSize) / 1024)} KB` : "File"}
                                  {" · in Files"}
                                </span>
                              </span>
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    {/*
                      REPLY SITS WITH THE REACTIONS, under the message it is
                      about. It used to be below the whole thread, so on a
                      message with three replies the button was four rows
                      away from the thing it replied to and read as
                      belonging to the last reply instead.
                    */}
                    <div className="flex items-center gap-2">
                      <Reactions postId={m.id} initial={m.reactions ?? []} />
                      {replyTo === m.id ? null : (
                        <button
                          type="button"
                          onClick={() => {
                            setReplyTo(m.id);
                            setReplyDraft("");
                          }}
                          className="text-[11.5px] text-[var(--ds-faint)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--ds-ink)]"
                        >
                          Reply
                        </button>
                      )}
                    </div>

                    {/*
                      REPLIES HANG OFF THE PARENT ON A CURVE. Not a nested
                      box: a box inside a box is a tree to parse, and a line
                      from one avatar to the next is already read as "this
                      came after that, about that".
                    */}
                    {m.replies?.length ? (
                      /*
                        ONE SHADED WELL, NOT A CARD PER REPLY.
                        
                        Each reply had its own avatar, its own name line and
                        its own bubble, so a three-reply thread was three
                        headers saying the same name and a column of
                        rectangles. A thread is ONE thing -- what came of the
                        message above it -- so it is one quiet panel, and
                        consecutive replies from the same person stack
                        without repeating who they are. The time stays on
                        every line, because that is the part that differs.
                      */
                      <div className="mt-1.5 space-y-1 rounded-2xl bg-[rgba(0,0,0,.035)] px-3 py-2">
                        {m.replies.map((r, ri) => {
                          const rt = toneFor(r.author_name);
                          const prev = m.replies[ri - 1];
                          const sameHand =
                            prev != null && prev.author_name === r.author_name;
                          return (
                            <div key={r.id} className="flex items-start gap-2">
                              {sameHand ? (
                                <span className="w-6 shrink-0" />
                              ) : (
                                <span
                                  className="mt-[15px] grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9.5px] font-semibold"
                                  style={{ backgroundColor: rt.avatar, color: rt.ink }}
                                >
                                  {initials(r.author_name)}
                                </span>
                              )}
                              <span className="min-w-0 flex-1">
                                {sameHand ? null : (
                                  <span className="mb-0.5 block text-[12px] font-semibold text-[var(--ds-ink)]">
                                    {r.author_name ?? "Somebody"}
                                  </span>
                                )}
                                <span className="flex items-baseline gap-2">
                                  <span className="min-w-0 whitespace-pre-wrap text-[13.5px] leading-snug text-[var(--ds-ink)]">
                                    <MessageText body={r.body} onOpenWork={onOpenWork} />
                                  </span>
                                  <span className="shrink-0 text-[10px] text-[var(--ds-faint)]">
                                    {ago(r.created_at)}
                                  </span>
                                </span>
                                <Reactions postId={r.id} initial={r.reactions ?? []} />
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    {replyTo === m.id ? (
                      <div className="mt-1.5 flex gap-2">
                        <input
                          autoFocus
                          value={replyDraft}
                          onChange={(e) => setReplyDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              void sendReply(m.id);
                            }
                            if (e.key === "Escape") setReplyTo(null);
                          }}
                          spellCheck
                          data-gramm="false"
                          data-gramm_editor="false"
                          data-enable-grammarly="false"
                          placeholder="Reply, or @amber to ask it for something"
                          className="flex-1 rounded-full border border-[var(--ds-line)] bg-[var(--ds-card)] px-3.5 py-1.5 text-[13.5px] outline-none focus:border-[var(--ds-accent-ring)]"
                        />
                        <Button tone="ghost" onClick={() => void sendReply(m.id)} busy={busy}>
                          Reply
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/*
          THE MESSAGE IS SENT, AS FAR AS THE SCREEN IS CONCERNED.
          
          Not dimmed, not greyed, not labelled "Sending". It is your name,
          your colour, your bubble and the time, exactly as it will look a
          second later -- because every chat anybody has ever used draws the
          message the instant you press enter, and anything less reads as a
          product that did not take the keystroke. The only tell is a small
          spinner at the end of the name line, and it disappears the moment
          the real row arrives.
        */}
        {sending.map((g) => {
          const tone = toneFor(meName);
          return (
            <div key={g.id} className="flex items-start gap-2.5 py-[3px]">
              <span
                className="mt-[22px] grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold"
                style={{ backgroundColor: tone.avatar, color: tone.ink }}
              >
                {initials(meName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="mb-0.5 flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold text-[var(--ds-ink)]">
                    {meName ?? "You"}
                  </span>
                  <span className="text-[11px] text-[var(--ds-faint)]">{ago(g.at)}</span>
                  <Loader2 className="h-3 w-3 animate-spin text-[var(--ds-faint)]" />
                </p>
                <div
                  className="inline-block max-w-[min(680px,88%)] rounded-2xl rounded-tl-md px-3.5 py-2.5"
                  style={{ backgroundColor: tone.bubble }}
                >
                  <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-[var(--ds-ink)]">
                    {g.body}
                  </p>
                  {g.files.length ? (
                    <div className="mt-2 space-y-1.5">
                      {g.files.map((name) => (
                        <span
                          key={name}
                          className="flex items-center gap-2.5 rounded-xl bg-white/70 px-3 py-2"
                        >
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[rgba(0,0,0,.05)] text-[var(--ds-muted)]">
                            <Clip className="h-4 w-4" />
                          </span>
                          <span className="truncate text-[13px] font-medium text-[var(--ds-ink)]">
                            {name}
                          </span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}

        {amberSteps ? (
          <div className="flex items-start gap-2.5 py-1 pl-0">
            <span
              className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold"
              style={{ backgroundColor: AMBER_TONE.avatar, color: "#fff" }}
            >
              A
            </span>
            <div className="min-w-0 flex-1">
              <AmberProgress
                steps={amberSteps}
                open={amberOpen}
                onToggle={() => setAmberOpen((v) => !v)}
              />
            </div>
          </div>
        ) : null}

        <div ref={bottom} />
      </div>

      {/* ------------------------------------------------------- composer */}
      <div className="px-4 pb-4 pt-1">
        {tagged ? (
          <p className="mb-1.5 flex items-center gap-1.5 px-2 text-[11.5px] text-[#9a5b12]">
            <Sparkles className="h-3 w-3" />
            Amber will do this and put the result in Work.
          </p>
        ) : null}

        {/*
          ONE SURFACE WITH THE CONTROLS INSIDE IT, which is what every
          messaging app settled on: the box is the control, the buttons live
          on its floor, and Send is the one coloured thing on the screen so
          there is never a question about what finishes the message.
        */}
        <div className="rounded-2xl border border-[var(--ds-line)] bg-[var(--ds-card)] px-3.5 pb-2.5 pt-3 shadow-[var(--ds-shadow-sm)] transition focus-within:border-[var(--ds-accent-ring)]">
          <textarea
            ref={box}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            spellCheck
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
            /*
              A QUIET PLACEHOLDER. "Message Founding Team — or @amber build
              me a one-pager on this" is a sentence of instructions sitting
              permanently in the one place somebody is about to type. It
              taught the @amber trick exactly once and then was noise
              forever. The @ button teaches it instead, on demand.
            */
            placeholder="Type something here"
            className="min-h-[24px] w-full resize-none border-0 bg-transparent p-0 text-[14.5px] leading-relaxed text-[var(--ds-ink)] outline-none placeholder:text-[var(--ds-faint)]"
          />
          {pending.length > 0 || uploading > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pending.map((f) => (
                <span
                  key={f.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ds-sunk,rgba(0,0,0,.05))] px-2.5 py-1 text-[11.5px] text-[var(--ds-ink)]"
                >
                  <Clip className="h-3 w-3 text-[var(--ds-muted)]" />
                  {f.name}
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() => setPending((cur) => cur.filter((x) => x.id !== f.id))}
                    className="text-[var(--ds-faint)] transition hover:text-[var(--ds-ink)]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {uploading > 0 ? (
                <span className="inline-flex items-center gap-1.5 px-1 text-[11.5px] text-[var(--ds-muted)]">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {uploading} uploading
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="mt-2 flex items-center gap-1">
            <input
              ref={picker}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void attach(e.target.files);
                e.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              aria-label="Attach a file"
              title="Attach a file — it lands in this circle's Files"
              onClick={() => picker.current?.click()}
              className="rounded-lg p-1.5 text-[var(--ds-muted)] transition hover:bg-[var(--ds-sunk,rgba(0,0,0,.04))] hover:text-[var(--ds-ink)]"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Mention Amber"
              title="Ask Amber for something"
              onClick={() => {
                setDraft((d) => (d.trim() ? `${d} @amber ` : "@amber "));
                box.current?.focus();
              }}
              className="rounded-lg p-1.5 text-[#c89b52] transition hover:bg-[var(--ds-sunk,rgba(0,0,0,.04))]"
            >
              <AtSign className="h-4 w-4" />
            </button>
            <span className="flex-1" />
            {/*
              SEND IS THE ONE COLOURED THING ON THE SCREEN, and it is blue
              rather than the product accent on purpose: amber means Amber
              here -- the assistant, its bubble, its mention -- and giving
              the ordinary send button the same colour would make every
              message look like it was going to the assistant.
            */}
            {/*
              NOT DISABLED WHILE A MESSAGE IS IN FLIGHT. The previous one is
              already drawn in the thread and this box is already empty, so
              greying out send only stops somebody typing the next line --
              which is what people do in a chat.
            */}
            <button
              type="button"
              onClick={send}
              disabled={!draft.trim() && pending.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#4668d6] px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-[#3a59bd] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type AmberStep = { label: string; at: number; done: boolean };

/**
 * WHAT IT IS DOING, AND THE ARROW FOR PEOPLE WHO WANT THE DETAIL.
 *
 * One line, changing, is enough for the person who just wants to know it is
 * alive. The disclosure is for the one who wants to know WHY it took forty
 * seconds, and showing them is how an assistant stops being a black box --
 * the complaint is never that it was slow, it is that nothing said what was
 * happening.
 */
function AmberProgress({
  steps,
  open,
  onToggle,
}: {
  steps: AmberStep[];
  open: boolean;
  onToggle: () => void;
}) {
  const current = steps.find((s) => !s.done) ?? steps[steps.length - 1];
  const finished = steps.every((s) => s.done);

  return (
    <div
      className="inline-block max-w-[min(520px,88%)] rounded-2xl rounded-tl-md px-3.5 py-2.5"
      style={{ backgroundColor: AMBER_TONE.bubble }}
    >
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 text-left">
        {finished ? (
          <Check className="h-3.5 w-3.5 shrink-0" style={{ color: AMBER_TONE.ink }} />
        ) : (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ color: AMBER_TONE.ink }} />
        )}
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--ds-ink)]">
          {current?.label ?? "Working"}
          {!finished ? "…" : ""}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[var(--ds-faint)] transition ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open ? (
        <ul className="mt-2 space-y-1 border-t border-[rgba(0,0,0,.07)] pt-2">
          {steps.map((s, i) => {
            const next = steps[i + 1];
            const took = s.done && s.at && next?.at ? Math.round((next.at - s.at) / 100) / 10 : null;
            return (
              <li key={s.label + i} className="flex items-baseline gap-2 text-[12px]">
                <span
                  className={`mt-[1px] h-1.5 w-1.5 shrink-0 rounded-full ${
                    s.done ? "" : s.at ? "animate-pulse" : "opacity-30"
                  }`}
                  style={{ backgroundColor: AMBER_TONE.ink }}
                />
                <span className={s.done || s.at ? "text-[var(--ds-ink)]" : "text-[var(--ds-faint)]"}>
                  {s.label}
                </span>
                {took ? <span className="text-[var(--ds-faint)]">{took}s</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- work */

function Work({
  room,
  groups,
  meId,
  onChanged,
  openStudio,
  onStudioClosed,
}: {
  room: Room;
  groups: { id: string; name: string }[];
  meId: string;
  onChanged: () => void;
  /** A page id a message linked to; opens full size the moment this tab shows. */
  openStudio?: string | null;
  onStudioClosed?: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [building, setBuilding] = useState(false);
  /* The one piece somebody has opened full size, to look at and change. */
  const [studio, setStudio] = useState<{ id: string; title: string } | null>(null);

  /*
   * A LINK IN A MESSAGE OPENS THE THING, not the tab it is in. Somebody
   * pressing "Open it in Work" means "show me the slide", and landing them
   * on a list where they then have to find it by name is the last step done
   * by hand.
   */
  useEffect(() => {
    if (!openStudio) return;
    const found = room.work.find((w) => w.id === openStudio);
    setStudio({ id: openStudio, title: found?.title ?? "Work" });
  }, [openStudio, room.work]);

  const grouped = useMemo(() => {
    const by = new Map<string, Room["work"]>();
    for (const w of room.work) {
      const k = w.workKind;
      by.set(k, [...(by.get(k) ?? []), w]);
    }
    // Artifacts first: they are the ones somebody can USE right now.
    const order = ["artifact", "project", "skill", "page", "record"];
    return order.filter((k) => by.has(k)).map((k) => [k, by.get(k)!] as const);
  }, [room.work]);

  return (
    <div className="space-y-4 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-[280px] flex-1 text-[12.5px] leading-relaxed text-[var(--ds-muted)]">
          Everything addressed to this circle. An artifact here runs; a project brings its
          instructions; a skill brings the files that came with it.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button tone="ghost" onClick={() => setSharing((v) => !v)}>
            <Plus className="h-3.5 w-3.5" />
            Share something in
          </Button>
          <Button tone="primary" onClick={() => setBuilding((v) => !v)}>
            <Sparkles className="h-3.5 w-3.5" />
            Build one here
          </Button>
        </div>
      </div>

      {building ? (
        <BuildInCircle
          circleId={room.circle.id}
          circleName={room.circle.name}
          onClose={() => setBuilding(false)}
          onBuilt={() => {
            setBuilding(false);
            onChanged();
          }}
        />
      ) : null}

      {sharing ? (
        <ShareIntoCircle
          circleId={room.circle.id}
          circleName={room.circle.name}
          meId={meId}
          onClose={() => setSharing(false)}
          onShared={() => {
            setSharing(false);
            onChanged();
          }}
        />
      ) : null}

      {room.work.length === 0 ? (
        <Empty
          title="Nothing shared in here yet"
          note="Anything in Knowledge can be addressed to this circle — a project you imported, a skill, an artifact you built. It stays one object; this circle is simply now an audience for it."
        />
      ) : (
        grouped.map(([kind, items]) => (
          <div key={kind}>
            <p className="mb-1.5 text-[11.5px] uppercase tracking-wide text-[var(--ds-faint)]">
              {WORK_LABEL[kind] ?? kind}
              {items.length > 1 ? "s" : ""} · {items.length}
            </p>
            <div className="divide-y divide-[var(--ds-line)] rounded-xl border border-[var(--ds-line)]">
              {items.map((w) => (
                <div key={`wrap-${w.id}`}>
                <div key={w.id} className="group/work flex items-start">
                  <button
                    type="button"
                    onClick={() => setOpen(open === w.id ? null : w.id)}
                    className="flex min-w-0 flex-1 items-start gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-[var(--ds-sunk,rgba(0,0,0,.02))]"
                  >
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ds-muted)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-[var(--ds-ink)]">
                        {w.title}
                      </span>
                      {w.summary ? (
                        <span className="mt-0.5 block truncate text-[12px] text-[var(--ds-muted)]">
                          {w.summary}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-[11px] text-[var(--ds-faint)]">
                      {ago(w.updated_at)}
                    </span>
                  </button>
                  {/*
                    FULL SIZE IS THE POINT FOR MOST OF THESE. A slideshow is
                    meant to be looked at and a tracker is meant to be
                    clicked around in; a 200px preview inside an accordion
                    inside a tab is a thumbnail of a tool.
                  */}
                  <button
                    type="button"
                    onClick={() => setStudio({ id: w.id, title: w.title })}
                    aria-label="Open full size"
                    title="Open full size"
                    className="mt-2.5 mr-2 shrink-0 rounded-md p-1 text-[var(--ds-faint)] opacity-0 transition group-hover/work:opacity-100 hover:text-[var(--ds-ink)]"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {open === w.id ? <WorkBody pageId={w.id} /> : null}
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {studio ? (
        <CircleStudio
          circleId={room.circle.id}
          pageId={studio.id}
          title={studio.title}
          onClose={() => {
            setStudio(null);
            onStudioClosed?.();
          }}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}

/**
 * THE BODY IS FETCHED WHEN IT IS OPENED, not with the room.
 *
 * A circle holding forty artifacts would otherwise send forty whole HTML
 * files down to draw a list of titles. The list read is already in the room;
 * this is the one extra request, and only for the one thing somebody chose.
 */
function WorkBody({ pageId }: { pageId: string }) {
  const [body, setBody] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getPage(pageId)
      .then((r) => alive && setBody(r.page.body ?? ""))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [pageId]);

  if (failed) {
    return (
      <p className="px-3.5 pb-3 text-[12.5px] text-[var(--ds-muted)]">
        That is not readable from here.
      </p>
    );
  }
  if (body === null) {
    return (
      <p className="flex items-center gap-2 px-3.5 pb-3 text-[12.5px] text-[var(--ds-muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Opening…
      </p>
    );
  }

  return (
    <div className="border-t border-[var(--ds-line)] px-3.5 pb-4 pt-1">
      {readArtifact(body) ? (
        <ArtifactBody body={body} />
      ) : (
        <div className="mt-3 max-h-[480px] overflow-y-auto whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--ds-ink)]">
          {body || "This page has a name and nothing in it yet."}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------- files, links, people ---*/

function Files({ room }: { room: Room }) {
  if (room.files.length === 0) {
    return (
      <div className="px-5 py-4">
        <Empty title="No files in here" note="Anything uploaded to this circle lands here." />
      </div>
    );
  }
  return (
    <div className="divide-y divide-[var(--ds-line)] px-5 py-2">
      {room.files.map((f) => (
        <div key={f.id} className="flex items-baseline gap-3 py-2.5">
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--ds-muted)]" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] text-[var(--ds-ink)]">
              {f.title || f.filename}
            </span>
            <span className="text-[11.5px] text-[var(--ds-faint)]">
              {f.uploaded_by_name ?? "Somebody"} · {ago(f.created_at)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Links({ room }: { room: Room }) {
  if (room.links.length === 0) {
    return (
      <div className="px-5 py-4">
        <Empty
          title="No links yet"
          note="Every URL anybody puts in a message here collects on this tab, so nobody has to scroll for the one from last Tuesday."
        />
      </div>
    );
  }
  return (
    <div className="divide-y divide-[var(--ds-line)] px-5 py-2">
      {room.links.map((l) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-baseline gap-3 py-2.5 transition hover:bg-[var(--ds-sunk,rgba(0,0,0,.02))]"
        >
          <Link2 className="h-3.5 w-3.5 shrink-0 text-[var(--ds-muted)]" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium text-[var(--ds-ink)]">
              {l.host}
            </span>
            {l.context ? (
              <span className="mt-0.5 block line-clamp-2 text-[12px] text-[var(--ds-muted)]">
                {l.context}
              </span>
            ) : null}
            <span className="mt-0.5 block truncate text-[11px] text-[var(--ds-faint)]">
              {l.by ?? "Somebody"} · {ago(l.at)} · {l.url}
            </span>
          </span>
        </a>
      ))}
    </div>
  );
}

/**
 * WHO IS IN THE ROOM, and for an admin, who else could be.
 *
 * Adding somebody to a circle is how a circle becomes useful, so it belongs
 * in the circle rather than on an administration screen somewhere else. The
 * list of everybody not yet in here is the whole control: no search to
 * learn, no modal, one press.
 */
function People({
  room,
  isAdmin,
  onChanged,
}: {
  room: Room;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [all, setAll] = useState<{ amberId: string; fullName: string | null }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    const token = tokenNow();
    if (!token) return;
    let alive = true;
    getMembers(token)
      .then((r) => {
        if (!alive) return;
        setAll(
          (r.members ?? [])
            .filter((m) => m.status === "active")
            .map((m) => ({ amberId: String(m.amberId), fullName: m.fullName ?? null })),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  const here = new Set(room.people.map((p) => p.amberId));
  const notHere = all.filter((m) => !here.has(m.amberId));

  const move = async (amberId: string, into: boolean) => {
    const token = tokenNow();
    if (!token) return;
    setBusy(amberId);
    try {
      if (into) await addToGroup(token, room.circle.id, amberId);
      else await removeFromGroup(token, room.circle.id, amberId);
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-5 py-3">
      {/*
        INVITING SOMEBODY IS THE POINT OF A ROOM WITH ONE PERSON IN IT.
        
        It lived on an administration screen that the circles view replaced,
        so there was nowhere to do the one thing this tab exists for. An
        invitation here does both halves at once: it brings somebody into the
        company AND into this circle, because "join us, then ask an admin to
        add you to the room you were invited to" is not a thing anybody
        should have to do.
      */}
      {isAdmin ? <InviteToCircle circleId={room.circle.id} circleName={room.circle.name} onInvited={onChanged} /> : null}

      <div className="divide-y divide-[var(--ds-line)]">
        {room.people.map((p) => (
          <div key={p.amberId} className="flex items-center gap-3 py-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--ds-ink)] text-[11px] font-semibold text-[var(--ds-card)]">
              {(p.fullName ?? "?").slice(0, 2).toUpperCase()}
            </span>
            <span className="flex-1 text-[13.5px] text-[var(--ds-ink)]">
              {p.fullName ?? "Unnamed"}
            </span>
            {isAdmin ? (
              <Button tone="ghost" busy={busy === p.amberId} onClick={() => void move(p.amberId, false)}>
                Remove
              </Button>
            ) : null}
          </div>
        ))}
      </div>

      {isAdmin && notHere.length > 0 ? (
        <div className="mt-4">
          <p className="text-[11.5px] uppercase tracking-wide text-[var(--ds-faint)]">
            Everyone else here
          </p>
          <div className="divide-y divide-[var(--ds-line)]">
            {notHere.map((m) => (
              <div key={m.amberId} className="flex items-center gap-3 py-2">
                <span className="flex-1 text-[13px] text-[var(--ds-muted)]">
                  {m.fullName ?? "Unnamed"}
                </span>
                <Button tone="ghost" busy={busy === m.amberId} onClick={() => void move(m.amberId, true)}>
                  Add
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}


/**
 * MAKE SOMETHING HERE, WITH THE ROOM AS CONTEXT.
 *
 * WHY THIS IS NOT A CHAT PROMPT. A message asking an assistant for a
 * checklist produces a message, which scrolls away. This produces an OBJECT
 * -- a project the team follows or an artifact they run -- addressed to this
 * circle, with the room's purpose and its recent conversation already behind
 * it. That is the difference between talking to a model in a room and the
 * room being able to build.
 *
 * IT TAKES A WHILE, AND IT SAYS SO. An artifact is a whole file; a minute is
 * normal. A spinner with no sentence under it is how somebody decides a
 * product is broken thirty seconds in.
 */
function BuildInCircle({
  circleId,
  circleName,
  onClose,
  onBuilt,
}: {
  circleId: string;
  circleName: string;
  onClose: () => void;
  onBuilt: () => void;
}) {
  const [want, setWant] = useState<"artifact" | "project">("artifact");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const go = async () => {
    const text = prompt.trim();
    if (text.length < 4 || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await buildInCircle(circleId, want, text);
      setPrompt("");
      onBuilt();
    } catch (e) {
      setFailed(
        (e as { message?: string })?.message ??
          "Could not build that. Try saying more about what it should do.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--ds-line)] bg-[var(--ds-sunk,var(--ds-card))] p-3.5">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[13px] font-semibold text-[var(--ds-ink)]">
          Build something in {circleName}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-[var(--ds-faint)] transition hover:text-[var(--ds-ink)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2 flex gap-1.5">
        {(["artifact", "project"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setWant(k)}
            className={`rounded-full border px-3 py-1 text-[12px] transition ${
              want === k
                ? "border-[var(--ds-accent)] text-[var(--ds-ink)]"
                : "border-[var(--ds-line)] text-[var(--ds-muted)] hover:text-[var(--ds-ink)]"
            }`}
          >
            {k === "artifact" ? "An artifact" : "A project"}
          </button>
        ))}
      </div>

      <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--ds-muted)]">
        {want === "artifact"
          ? "One self-contained page this circle can open and use — a calculator, a tracker, a checklist. It runs here."
          : "The way this team wants a job done, written down so a person or an assistant can follow it."}
      </p>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        placeholder={
          want === "artifact"
            ? "A deal desk calculator: deal size, discount, term, and the approval it needs"
            : "How we qualify an inbound lead before it gets a call"
        }
        className="mt-2 w-full resize-y rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] px-3 py-2 text-[13.5px] leading-relaxed outline-none focus:border-[var(--ds-accent-ring)]"
      />

      {failed ? <p className="mt-1.5 text-[12px] text-[var(--ds-ink)]">{failed}</p> : null}

      <div className="mt-2 flex items-center gap-2">
        <Button tone="primary" busy={busy} disabled={prompt.trim().length < 4} onClick={go}>
          Build it
        </Button>
        {busy ? (
          <span className="text-[12px] text-[var(--ds-muted)]">
            Writing it with what this circle knows. A minute is normal.
          </span>
        ) : (
          <span className="text-[12px] text-[var(--ds-faint)]">
            It lands in this circle and nowhere else.
          </span>
        )}
      </div>
    </div>
  );
}


/**
 * ONE ADDRESS, AND THE LINK IF THE EMAIL DOES NOT GO.
 *
 * WHY THE LINK IS SHOWN RATHER THAN HIDDEN. Invitation email is the single
 * most fragile thing in a young product: an unverified sending domain, a
 * spam folder, a typo'd address. A product that says "invitation sent" and
 * leaves it there is one where somebody waits three days before finding
 * out. The server already reports whether it actually sent; when it did not,
 * the accept link is put on screen to paste into a message that will
 * certainly arrive.
 */
function InviteToCircle({
  circleId,
  circleName,
  onInvited,
}: {
  circleId: string;
  circleName: string;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ url: string; emailed: boolean; why: string | null } | null>(
    null,
  );
  const [failed, setFailed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const invite = async () => {
    const token = tokenNow();
    const address = email.trim();
    if (!token || !address.includes("@") || busy) return;
    setBusy(true);
    setFailed(null);
    setSent(null);
    try {
      const r = await createInvite(token, address, "member", circleId);
      setSent({
        url: r.acceptUrl,
        emailed: Boolean(r.emailed),
        why: r.deliveryDetail ?? r.deliveryReason ?? null,
      });
      setEmail("");
      onInvited();
    } catch (e) {
      setFailed((e as { message?: string })?.message ?? "Could not invite that address.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] p-3.5">
      <p className="text-[13px] font-semibold text-[var(--ds-ink)]">Invite somebody</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--ds-muted)]">
        They join the company and land in {circleName} straight away.
      </p>

      <div className="mt-2.5 flex gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void invite();
          }}
          spellCheck={false}
          data-gramm="false"
          data-gramm_editor="false"
          data-enable-grammarly="false"
          placeholder="name@company.com"
          className="min-w-0 flex-1 rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] px-3 py-1.5 text-[13.5px] outline-none focus:border-[var(--ds-accent-ring)]"
        />
        <Button tone="primary" busy={busy} disabled={!email.includes("@")} onClick={invite}>
          Invite
        </Button>
      </div>

      {failed ? <p className="mt-2 text-[12px] text-[var(--ds-ink)]">{failed}</p> : null}

      {sent ? (
        <div className="mt-2.5 rounded-lg bg-[var(--ds-sunk,rgba(0,0,0,.04))] p-2.5">
          <p className="text-[12px] text-[var(--ds-ink)]">
            {sent.emailed
              ? "Invitation emailed."
              : "Invitation made, but the email did not send — paste this to them instead."}
          </p>
          {/*
            WHAT THE MAIL PROVIDER ACTUALLY SAID, not its error code.
            "validation_error" is what Resend returns for an unverified
            domain, a mis-scoped key, and the free-tier rule that only the
            account owner may be written to -- three different problems, one
            word, and no way to tell which from here. The sentence says
            which; addresses in it are redacted before it leaves the server.
          */}
          {sent.why && !sent.emailed ? (
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--ds-faint)]">{sent.why}</p>
          ) : null}
          {!sent.emailed ? (
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--ds-faint)]">
              The link below works whatever the mail is doing — it is the same invitation.
            </p>
          ) : null}
          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              readOnly
              value={sent.url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 bg-transparent text-[11.5px] text-[var(--ds-muted)] outline-none"
            />
            <button
              type="button"
              aria-label="Copy the link"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(sent.url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                } catch {
                  /* nothing useful to say */
                }
              }}
              className="shrink-0 rounded-md p-1 text-[var(--ds-faint)] transition hover:text-[var(--ds-ink)]"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Name it and it exists. A purpose is the one line everybody else reads. */
function NewCircle({ onClose, onMade }: { onClose: () => void; onMade: (id: string) => void }) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const make = async () => {
    const token = tokenNow();
    if (!token || !name.trim() || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      const r = await createGroup(token, { name: name.trim(), purpose: purpose.trim() });
      onMade(String(r.group.id));
    } catch (e) {
      setFailed((e as { message?: string })?.message ?? "Could not make that circle.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-b border-[var(--ds-line)] px-3.5 py-3">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void make();
          if (e.key === "Escape") onClose();
        }}
        placeholder="Name, e.g. Founding team"
        className="w-full rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--ds-accent-ring)]"
      />
      <input
        value={purpose}
        onChange={(e) => setPurpose(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void make();
          if (e.key === "Escape") onClose();
        }}
        placeholder="What it is for (optional)"
        className="w-full rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--ds-accent-ring)]"
      />
      {failed ? <p className="text-[12px] text-[var(--ds-ink)]">{failed}</p> : null}
      <div className="flex gap-2">
        <Button tone="primary" busy={busy} disabled={!name.trim()} onClick={make}>
          Make it
        </Button>
        <Button tone="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

