import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Pin,
  PinOff,
  Edit3,
  Users,
  MessageSquare,
  Inbox,
} from "lucide-react";
import type { ChatDTO } from "@shared/types";
import { Avatar } from "./Avatar";
import { cn, formatChatListTimestamp, prettyHandle } from "@/lib/utils";

type Filter = "all" | "unread" | "dms" | "groups";

interface SidebarProps {
  chats: ChatDTO[];
  loading: boolean;
  selectedChatId: string | null;
  search: string;
  onSearch: (q: string) => void;
  onSelect: (chatId: string) => void;
  onTogglePin: (chatId: string) => void;
}

export function Sidebar({
  chats,
  loading,
  selectedChatId,
  search,
  onSearch,
  onSelect,
  onTogglePin,
}: SidebarProps): JSX.Element {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [contextMenu, setContextMenu] = useState<{
    chatId: string;
    x: number;
    y: number;
  } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘F focuses search. Native macOS convention.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click anywhere to dismiss the context menu.
  useEffect(() => {
    if (!contextMenu) return;
    function onClick(): void {
      setContextMenu(null);
    }
    window.addEventListener("click", onClick);
    window.addEventListener("scroll", onClick, true);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("scroll", onClick, true);
    };
  }, [contextMenu]);

  const filtered = useMemo(() => {
    let list = chats;
    if (filter === "unread") list = list.filter((c) => c.unreadCount > 0);
    else if (filter === "dms") list = list.filter((c) => c.kind === "dm");
    else if (filter === "groups") list = list.filter((c) => c.kind === "group");

    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((c) => {
      const haystack = [
        c.name,
        c.contactDisplayName,
        c.identifier,
        c.lastMessagePreview,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [chats, search, filter]);

  // Arrow-key navigation between visible chats.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      // Don't interfere when typing in the search box or a textarea.
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const idx = filtered.findIndex((c) => c.chatId === selectedChatId);
      let next = idx;
      if (e.key === "ArrowDown") next = Math.min(filtered.length - 1, idx + 1);
      else next = Math.max(0, idx - 1);
      const target2 = filtered[next];
      if (target2) onSelect(target2.chatId);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, selectedChatId, onSelect]);

  const pinned = filtered.filter((c) => c.isPinned);
  const others = filtered.filter((c) => !c.isPinned);

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-r border-white/[0.06]">
      {/* Title bar (drag region) */}
      <div className="titlebar-drag flex h-14 items-center justify-between gap-2 px-4 pl-20 pr-4">
        <div className="text-sm font-semibold tracking-tight text-zinc-100">
          Messages
        </div>
        <button
          className="no-drag flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
          title="New message (coming soon)"
          aria-label="New message"
        >
          <Edit3 className="h-4 w-4" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search  (⌘F)"
            className="w-full rounded-xl border border-white/[0.06] bg-white/[0.05] py-2 pl-9 pr-3 text-sm text-white placeholder-zinc-500 outline-none transition-colors focus:border-white/20 focus:bg-white/[0.08]"
          />
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-1 px-3 pb-3">
        <FilterPill
          active={filter === "all"}
          onClick={() => setFilter("all")}
          icon={Inbox}
          label="All"
        />
        <FilterPill
          active={filter === "unread"}
          onClick={() => setFilter("unread")}
          label="Unread"
        />
        <FilterPill
          active={filter === "dms"}
          onClick={() => setFilter("dms")}
          icon={MessageSquare}
          label="DMs"
        />
        <FilterPill
          active={filter === "groups"}
          onClick={() => setFilter("groups")}
          icon={Users}
          label="Groups"
        />
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {loading && chats.length === 0 ? (
          <SidebarSkeleton />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-zinc-500">
            {search
              ? `No chats matching "${search}"`
              : filter !== "all"
                ? "No chats in this filter."
                : "No conversations yet."}
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <SectionLabel>Pinned</SectionLabel>
                {pinned.map((chat) => (
                  <ChatRow
                    key={chat.chatId}
                    chat={chat}
                    isSelected={chat.chatId === selectedChatId}
                    isHovered={hoveredId === chat.chatId}
                    onHover={(h) => setHoveredId(h ? chat.chatId : null)}
                    onClick={() => onSelect(chat.chatId)}
                    onTogglePin={() => onTogglePin(chat.chatId)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({
                        chatId: chat.chatId,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                  />
                ))}
              </>
            )}
            {others.length > 0 && (
              <>
                {pinned.length > 0 && <SectionLabel>All Messages</SectionLabel>}
                {others.map((chat) => (
                  <ChatRow
                    key={chat.chatId}
                    chat={chat}
                    isSelected={chat.chatId === selectedChatId}
                    isHovered={hoveredId === chat.chatId}
                    onHover={(h) => setHoveredId(h ? chat.chatId : null)}
                    onClick={() => onSelect(chat.chatId)}
                    onTogglePin={() => onTogglePin(chat.chatId)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({
                        chatId: chat.chatId,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Right-click context menu */}
      {contextMenu && (
        <ContextMenu
          chat={chats.find((c) => c.chatId === contextMenu.chatId) ?? null}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onTogglePin={() => {
            onTogglePin(contextMenu.chatId);
            setContextMenu(null);
          }}
        />
      )}
    </aside>
  );
}

function FilterPill({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon?: typeof Inbox;
  label: string;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-imessage-blue text-white"
          : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200",
      )}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </button>
  );
}

function ContextMenu({
  chat,
  x,
  y,
  onClose,
  onTogglePin,
}: {
  chat: ChatDTO | null;
  x: number;
  y: number;
  onClose: () => void;
  onTogglePin: () => void;
}): JSX.Element | null {
  if (!chat) return null;
  return (
    <div
      className="fixed z-50 min-w-[180px] overflow-hidden rounded-xl border border-white/10 bg-zinc-900/95 py-1 shadow-2xl backdrop-blur-xl"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem
        label={chat.isPinned ? "Unpin" : "Pin"}
        onClick={onTogglePin}
        icon={chat.isPinned ? PinOff : Pin}
      />
      <MenuItem label="Mute (coming soon)" disabled />
      <MenuItem label="Mark all read (coming soon)" disabled />
      <div className="my-1 border-t border-white/[0.06]" />
      <MenuItem
        label="Close menu"
        onClick={onClose}
        className="text-zinc-500"
      />
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  icon: Icon,
  disabled = false,
  className,
}: {
  label: string;
  onClick?: () => void;
  icon?: typeof Pin;
  disabled?: boolean;
  className?: string;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-100 transition-colors",
        disabled ? "cursor-not-allowed text-zinc-600" : "hover:bg-white/[0.08]",
        className,
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

function SectionLabel({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="mb-1 mt-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </div>
  );
}

interface ChatRowProps {
  chat: ChatDTO;
  isSelected: boolean;
  isHovered: boolean;
  onHover: (hovered: boolean) => void;
  onClick: () => void;
  onTogglePin: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function ChatRow({
  chat,
  isSelected,
  isHovered,
  onHover,
  onClick,
  onTogglePin,
  onContextMenu,
}: ChatRowProps): JSX.Element {
  const displayName =
    chat.name || chat.contactDisplayName || prettyHandle(chat.identifier);
  const preview =
    chat.lastMessagePreview ||
    (chat.kind === "group" ? "New group conversation" : "No messages yet");

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={cn(
        "group relative flex w-full cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        isSelected
          ? "bg-imessage-blue text-white"
          : "text-zinc-100 hover:bg-white/[0.07]",
      )}
    >
      <Avatar
        name={chat.contactDisplayName || chat.name}
        identifier={chat.identifier}
        photoUrl={chat.contactPhotoUrl}
        size="md"
        className={cn(isSelected && "ring-2 ring-white/20")}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={cn("truncate text-[15px] font-semibold")}>
              {displayName}
            </span>
            {chat.isPinned && (
              <Pin
                className={cn(
                  "h-3 w-3 shrink-0",
                  isSelected ? "text-white/80" : "text-zinc-500",
                )}
              />
            )}
          </div>
          <span
            className={cn(
              "shrink-0 text-[11px] font-medium",
              isSelected ? "text-white/80" : "text-zinc-500",
            )}
          >
            {formatChatListTimestamp(chat.lastMessageAt)}
          </span>
        </div>
        <div className="mt-0.5 flex items-start justify-between gap-2">
          <p
            className={cn(
              "line-clamp-2 text-[13px] leading-snug",
              isSelected
                ? "text-white/90"
                : chat.unreadCount > 0
                  ? "text-zinc-200"
                  : "text-zinc-400",
            )}
          >
            {chat.lastMessageFromMe && (
              <span className="text-zinc-500">You: </span>
            )}
            {preview}
          </p>
          {chat.unreadCount > 0 && !isSelected && (
            <span className="mt-0.5 flex h-2 w-2 shrink-0 rounded-full bg-imessage-blue" />
          )}
        </div>
      </div>

      {/* Hover affordance: pin toggle */}
      {isHovered && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          className={cn(
            "absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md transition-colors",
            isSelected
              ? "bg-white/15 hover:bg-white/25"
              : "bg-zinc-700 hover:bg-zinc-600",
          )}
          title={chat.isPinned ? "Unpin" : "Pin"}
        >
          {chat.isPinned ? (
            <PinOff className="h-3.5 w-3.5" />
          ) : (
            <Pin className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </button>
  );
}

function SidebarSkeleton(): JSX.Element {
  return (
    <div className="space-y-2 px-1 pt-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
          <div className="h-10 w-10 animate-pulse rounded-full bg-white/[0.06]" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-white/[0.04]" />
          </div>
        </div>
      ))}
    </div>
  );
}
