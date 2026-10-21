"use client";

/**
 * EVERY TEAM IN ONE LIST, AND THE ONE YOU OPENED EXPANDS IN PLACE.
 *
 * The previous shape was a list on one side and a detail panel on the other,
 * which is a file browser. A file browser is right when the list is long and
 * the thing you pick is one of many; it is wrong for teams, because a company
 * has six of them, you are in three, and the question is never "which one"
 * but "what is happening in any of them". A detail panel answers that one
 * team at a time and hides the rest behind a click each.
 *
 * So: all of them, collapsed, with the last thing said on each and a badge if
 * something is unread. Open one and it unfolds where it sits, pushing the
 * others down — which is exactly what Teams does, and the reason it works is
 * that the list never leaves the screen. You can see that Sales has three
 * unread while you are reading Engineering.
 *
 * ONLY ONE OPEN AT A TIME, which is a real decision rather than a default.
 * Two open conversations at six hundred pixels each means neither is usable
 * and the list below both is off the bottom of the screen. Opening one closes
 * the other, and the one that closes keeps its state, because everything
 * inside is mounted and merely hidden.
 *
 * WHAT IS MOUNTED AND WHEN. A group that has never been opened renders
 * nothing at all; once opened it stays mounted and is hidden on collapse, so
 * coming back to a conversation lands where you left it, scrolled where you
 * left it, with its draft intact. Three groups opened over a session is three
 * mounted panels, which is the deliberate trade: more memory for a console
 * that does not rebuild a screen every time you glance at another team.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, Pin, PinOff, Plus, Trash2, Users } from "lucide-react";
import { hueFor } from "@/lib/cn";
import type { OrgGroup, OrgMember } from "@/lib/org";
import type { Post } from "@/lib/knowledge";
import {
  Avatar,
  Badge,
  Button,
  Empty,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "@/components/ui";
import { ScreenVisible } from "@/lib/screen";

export type GroupView = "feed" | "calendar" | "files" | "links" | "people";

/**
 * The order is the order of use.
 *
 * Messages first because it is why anybody opens a team at all. Calendar
 * second because "when are we doing this" is the next question in the same
 * breath, and it used to be third behind Files — which is the thing you look
 * for least often and had the better position.
 */
const TABS: { key: GroupView; label: string }[] = [
  { key: "feed", label: "Messages" },
  { key: "calendar", label: "Calendar" },
  { key: "files", label: "Files" },
  { key: "links", label: "Links" },
  { key: "people", label: "People" },
];

export default function GroupAccordion({
  groups,
  members,
  membership,
  lastByGroup,
  unreadByGroup,
  openId,
  view,
  isAdmin,
  onOpen,
  onView,
  onEdit,
  onDelete,
  onNew,
  onReorder,
  onPin,
  renderPanel,
}: {
  groups: OrgGroup[];
  members: OrgMember[];
  membership: Map<string, string[]>;
  /** The most recent message per group, for the collapsed row's subtitle. */
  lastByGroup: Map<string, Post>;
  unreadByGroup: Map<string, number>;
  openId: string | null;
  view: GroupView;
  isAdmin: boolean;
  onOpen: (id: string | null) => void;
  onView: (v: GroupView) => void;
  onEdit: (g: OrgGroup) => void;
  onDelete: (g: OrgGroup) => void;
  onNew: () => void;
  /** The whole new order, because a drag moves everything it passed. */
  onReorder: (ids: string[]) => void;
  onPin: (id: string, pinned: boolean) => void;
  /** The group's own screens. Rendered once per group that has been opened. */
  renderPanel: (group: OrgGroup, view: GroupView) => React.ReactNode;
}) {
  /*
   * Which groups have ever been opened. Once a group is in here it stays, and
   * its panel stays mounted behind the collapse — that is what makes
   * reopening instant and keeps the scroll position and the half-typed
   * message.
   */
  const [mounted, setMounted] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!openId) return;
    setMounted((prev) => (prev.has(openId) ? prev : new Set(prev).add(openId)));
  }, [openId]);

  /*
   * DRAGGING REORDERS THE LIST, AND THE LIST MOVES WHILE YOU DRAG.
   *
   * Held in local state during the gesture and saved once on release. The
   * alternative -- writing on every crossing -- is a request per row you
   * pass over, on an API where a request costs more than a second, for an
   * arrangement nobody has finished making.
   *
   * `order` is null except mid-drag, so the moment the gesture ends the list
   * goes back to being whatever the server says. That is what keeps a
   * half-finished drag from leaving a stale order on screen if the save
   * fails.
   */
  const [order, setOrder] = useState<string[] | null>(null);
  const dragging = useRef<string | null>(null);

  const shown = useMemo(() => {
    if (!order) return groups;
    const byId = new Map(groups.map((g) => [g.id, g]));
    const out = order.map((id) => byId.get(id)).filter(Boolean) as OrgGroup[];
    // Anything that arrived mid-drag still has to appear.
    for (const g of groups) if (!order.includes(g.id)) out.push(g);
    return out;
  }, [groups, order]);

  function onDragOver(overId: string) {
    const from = dragging.current;
    if (!from || from === overId) return;
    const base = (order ?? groups.map((g) => g.id)).slice();
    const i = base.indexOf(from);
    const j = base.indexOf(overId);
    if (i < 0 || j < 0) return;
    base.splice(i, 1);
    base.splice(j, 0, from);
    setOrder(base);
  }

  function onDrop() {
    const final = order;
    dragging.current = null;
    setOrder(null);
    if (final) onReorder(final);
  }

  if (groups.length === 0) {
    return (
      <Empty
        icon={<Users className="h-4 w-4" />}
        title="No groups yet"
        note="A group is who a thing can be shared with short of the whole company. Most companies start with the two or three that already exist in conversation."
        action={
          isAdmin ? (
            <Button tone="primary" onClick={onNew}>
              Create the first group
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-1.5">
      {shown.map((g) => (
        <GroupRow
          key={g.id}
          onDragStart={() => {
            dragging.current = g.id;
          }}
          onDragOver={() => onDragOver(g.id)}
          onDrop={onDrop}
          onPin={() => onPin(g.id, !g.pinnedAt)}
          group={g}
          members={members}
          memberIds={membership.get(g.id) ?? []}
          last={lastByGroup.get(g.id) ?? null}
          unread={unreadByGroup.get(g.id) ?? 0}
          open={openId === g.id}
          everOpened={mounted.has(g.id)}
          view={view}
          isAdmin={isAdmin}
          onToggle={() => onOpen(openId === g.id ? null : g.id)}
          onView={onView}
          onEdit={() => onEdit(g)}
          onDelete={() => onDelete(g)}
          renderPanel={renderPanel}
        />
      ))}
    </div>
  );
}

function GroupRow({
  group,
  members,
  memberIds,
  last,
  unread,
  open,
  everOpened,
  view,
  isAdmin,
  onToggle,
  onView,
  onEdit,
  onDelete,
  onPin,
  onDragStart,
  onDragOver,
  onDrop,
  renderPanel,
}: {
  group: OrgGroup;
  members: OrgMember[];
  memberIds: string[];
  last: Post | null;
  unread: number;
  open: boolean;
  everOpened: boolean;
  view: GroupView;
  isAdmin: boolean;
  onToggle: () => void;
  onView: (v: GroupView) => void;
  onEdit: () => void;
  onDelete: () => void;
  onPin: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  renderPanel: (group: OrgGroup, view: GroupView) => React.ReactNode;
}) {
  const faces = useMemo(() => {
    const ids = new Set(memberIds);
    return members.filter((m) => ids.has(m.amberId)).slice(0, 4);
  }, [members, memberIds]);

  return (
    /*
      A CARD, NOT A DISCLOSURE ROW.
      
      The chevron made this read as a settings accordion -- a list of things
      you expand to configure. These are places you work, so they are cards
      stacked on each other, with the shadow doing the job the chevron was
      doing badly: the one in front is the one you are in.
    */
    <div
      draggable
      onDragStart={(e) => {
        // Firefox refuses to start a drag without data on the transfer.
        e.dataTransfer.setData("text/plain", group.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDrop}
      className={`group/card overflow-hidden rounded-xl border bg-[var(--ds-card)] transition-all ${
        open
          ? "border-[var(--ds-accent-ring)] shadow-[var(--ds-shadow)]"
          : "border-[var(--ds-line)] shadow-[var(--ds-shadow-sm)] hover:border-[var(--ds-line-strong)] hover:shadow-[var(--ds-shadow)]"
      }`}
    >
      {/* ── the row, always visible ── */}
      <div
        className={`flex items-center gap-3 px-3 py-2.5 ${
          open ? "border-b border-[var(--ds-line)]" : ""
        }`}
      >
        {/* The handle appears on hover: a grip on every row all the time is
            six pieces of furniture in a list of six teams. */}
        <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-[var(--ds-faint)] opacity-0 transition-opacity group-hover/card:opacity-100" />

        <button
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={open}
        >
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-bold text-white"
            style={{ background: hueFor(group.name) }}
          >
            {group.name.slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span
                className={`truncate text-[13.5px] text-[var(--ds-ink)] ${
                  unread ? "font-semibold" : "font-medium"
                }`}
              >
                {group.name}
              </span>
              {group.pinnedAt ? (
                <Pin className="h-3 w-3 shrink-0 text-[var(--ds-accent)]" />
              ) : null}
              {unread ? (
                /* The one badge that means "this needs you", so it is the
                   only number in this list that is allowed to be loud. */
                <span className="tnum shrink-0 rounded-full bg-[var(--ds-accent)] px-1.5 py-px text-[10px] font-semibold text-white">
                  {unread}
                </span>
              ) : null}
            </span>
            {/*
              The last thing said, not the purpose. A purpose is written once
              and read never; "Maya: pushed the fix, waiting on review" is the
              reason to open this row or skip it.
            */}
            <span className="block truncate text-[12px] text-[var(--ds-dim)]">
              {last
                ? `${last.author_name ?? "Someone"}: ${last.body.slice(0, 70)}`
                : group.purpose || "Nothing said here yet"}
            </span>
          </span>
        </button>

        <span className="hidden shrink-0 -space-x-1.5 sm:flex">
          {faces.map((m) => (
            <Avatar key={m.amberId} name={m.fullName || m.email} size={22} />
          ))}
        </span>

        {/*
          The member count, quietly. It used to be a bordered "empty" badge on
          every row of a new workspace, which turned a list of teams into a
          list of complaints about them.
        */}
        <span className="tnum hidden shrink-0 text-[11px] text-[var(--ds-faint)] sm:block">
          {group.memberCount}
        </span>

        <button
          onClick={onPin}
          title={group.pinnedAt ? "Unpin" : "Pin to the top"}
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-md transition-opacity hover:bg-[var(--ds-hover)] ${
            group.pinnedAt
              ? "text-[var(--ds-accent)] opacity-100"
              : "text-[var(--ds-faint)] opacity-0 group-hover/card:opacity-100"
          }`}
        >
          {group.pinnedAt ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </button>

        {isAdmin ? (
          <Menu>
            <MenuTrigger asChild>
              <Button tone="ghost" size="sm">···</Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={onEdit}>Rename or describe</MenuItem>
              <MenuItem danger onSelect={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete group
              </MenuItem>
            </MenuContent>
          </Menu>
        ) : null}
      </div>

      {/* ── the panel, mounted from the first time it is opened ── */}
      {everOpened ? (
        /*
         * `hidden` rather than unmounting. The conversation inside keeps its
         * scroll position and its half-typed message, and reopening costs a
         * style change instead of a remount. ScreenVisible tells the chat
         * whether to keep polling: a collapsed group is not a screen anybody
         * is reading.
         */
        <ScreenVisible.Provider value={open}>
          <div hidden={!open}>
            <div className="flex gap-1 overflow-x-auto border-b border-[var(--ds-line)] px-3 py-2">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => onView(t.key)}
                  className={
                    "whitespace-nowrap rounded-lg px-2.5 py-1 text-[12.5px] font-medium transition-colors " +
                    (view === t.key
                      ? "bg-[var(--ds-accent-soft)] text-[var(--ds-accent-ink)]"
                      : "text-[var(--ds-muted)] hover:bg-[var(--ds-hover)] hover:text-[var(--ds-ink)]")
                  }
                >
                  {t.label}
                  {t.key === "people" ? (
                    <span className="ml-1 text-[var(--ds-faint)]">{group.memberCount}</span>
                  ) : null}
                </button>
              ))}
            </div>
            {renderPanel(group, view)}
          </div>
        </ScreenVisible.Provider>
      ) : null}
    </div>
  );
}

export { TABS as GROUP_TABS };
export function NewGroupRow({ onNew }: { onNew: () => void }) {
  return (
    <button
      onClick={onNew}
      className="flex w-full items-center gap-3 rounded-xl border border-dashed border-[var(--ds-line-strong)] px-3 py-2.5 text-left text-[13px] text-[var(--ds-muted)] transition-colors hover:border-[var(--ds-accent)] hover:text-[var(--ds-ink)]"
    >
      <Plus className="h-4 w-4" />
      New group
    </button>
  );
}
