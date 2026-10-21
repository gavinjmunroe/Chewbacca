"use client";

import { useState } from "react";
import { NavProps, CIRCLES, USERS, STORIES } from "@/types";
import StatusBar from "@/components/StatusBar";
import Avatar from "@/components/Avatar";

type NotifType = "RESPONSE" | "REACTION" | "CIRCLE_ACTIVITY" | "REPLY";

interface Notification {
  id: string;
  type: NotifType;
  userId?: string;
  userName?: string;
  userColor?: string;
  circleLabel?: string;
  circleColor?: string;
  circleId?: string;
  text: string;
  preview?: string;
  timeAgo: string;
  read: boolean;
  storyId?: string;
  section: "today" | "earlier";
}

const INITIAL_NOTIFS: Notification[] = [
  {
    id: "n1",
    type: "RESPONSE",
    userId: "marcus",
    userName: "Marcus Rivera",
    userColor: "#6366f1",
    circleLabel: "IYA '27",
    circleColor: "#f59e0b",
    text: "responded to today's prompt",
    timeAgo: "12m",
    read: false,
    storyId: "marcus-1",
    section: "today",
  },
  {
    id: "n2",
    type: "REACTION",
    userId: "priya",
    userName: "Priya Sharma",
    userColor: "#ec4899",
    text: 'reacted "Made me think" to your story',
    timeAgo: "2h",
    read: false,
    storyId: "caleb-1",
    section: "today",
  },
  {
    id: "n3",
    type: "CIRCLE_ACTIVITY",
    circleLabel: "IYA '27",
    circleColor: "#f59e0b",
    circleId: "iya-27",
    text: "7 of 10 responded today",
    timeAgo: "3h",
    read: false,
    section: "today",
  },
  {
    id: "n4",
    type: "RESPONSE",
    userId: "daniel",
    userName: "Daniel Kim",
    userColor: "#0ea5e9",
    text: "responded to today's prompt",
    timeAgo: "1h",
    read: false,
    storyId: "daniel-1",
    section: "today",
  },
  {
    id: "n5",
    type: "REPLY",
    userId: "elena",
    userName: "Elena Vasquez",
    userColor: "#f59e0b",
    text: "replied to your story",
    preview:
      "This resonated so much. I've been thinking about the same thing lately...",
    timeAgo: "1d",
    read: true,
    storyId: "caleb-1",
    section: "earlier",
  },
  {
    id: "n6",
    type: "REACTION",
    userId: "kofi",
    userName: "Kofi Asante",
    userColor: "#34d399",
    text: 'reacted "Felt this deeply" to your story',
    timeAgo: "1d",
    read: true,
    storyId: "caleb-2",
    section: "earlier",
  },
  {
    id: "n7",
    type: "CIRCLE_ACTIVITY",
    circleLabel: "Close Friends",
    circleColor: "#34d399",
    circleId: "close-friends",
    text: "6 of 8 responded this week",
    timeAgo: "2d",
    read: true,
    section: "earlier",
  },
  {
    id: "n8",
    type: "REPLY",
    userId: "aisha",
    userName: "Aisha Johnson",
    userColor: "#f97316",
    text: "replied to your story",
    preview: "The part about the inner critic...",
    timeAgo: "2d",
    read: true,
    storyId: "caleb-2",
    section: "earlier",
  },
];

export default function NotificationsScreen({ navigate, goBack }: NavProps) {
  const [notifs, setNotifs] = useState<Notification[]>(INITIAL_NOTIFS);

  const unreadCount = notifs.filter((n) => !n.read).length;

  function handleTap(notif: Notification) {
    setNotifs((prev) =>
      prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
    );
    if (notif.storyId) {
      navigate("story", "forward", notif.storyId);
    } else if (notif.type === "CIRCLE_ACTIVITY" && notif.circleId) {
      navigate("circle-manage", "forward", notif.circleId);
    } else if (notif.userId) {
      navigate("user-profile", "forward", notif.userId);
    }
  }

  function markAllRead() {
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  const todayNotifs = notifs.filter((n) => n.section === "today");
  const earlierNotifs = notifs.filter((n) => n.section === "earlier");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0f0c0a",
        color: "#fff",
        fontFamily: "var(--font-inter), sans-serif",
        overflowX: "hidden",
      }}
    >
      <StatusBar />

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "52px 20px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={goBack}
          style={{
            background: "none",
            border: "none",
            color: "#f59e0b",
            fontSize: 22,
            cursor: "pointer",
            padding: "2px 4px",
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
          }}
        >
          &#8592;
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              fontFamily: "var(--font-dm-sans), sans-serif",
            }}
          >
            Notifications
          </span>
          {unreadCount > 0 && (
            <span
              style={{
                background: "rgba(245,158,11,0.18)",
                border: "1px solid rgba(245,158,11,0.3)",
                color: "#f59e0b",
                fontSize: 11,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 20,
                letterSpacing: "0.01em",
              }}
            >
              {unreadCount} new
            </span>
          )}
        </div>

        <button
          onClick={markAllRead}
          style={{
            background: "none",
            border: "none",
            color: "rgba(245,158,11,0.75)",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            padding: "2px 0",
            letterSpacing: "0.01em",
          }}
        >
          Mark all read
        </button>
      </div>

      {/* Scrollable content */}
      <div
        className="inner-scroll"
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          paddingBottom: 32,
        }}
      >
        <NotifSection
          label="Today"
          notifs={todayNotifs}
          onTap={handleTap}
        />
        <NotifSection
          label="Earlier"
          notifs={earlierNotifs}
          onTap={handleTap}
        />
      </div>
    </div>
  );
}

function NotifSection({
  label,
  notifs,
  onTap,
}: {
  label: string;
  notifs: Notification[];
  onTap: (n: Notification) => void;
}) {
  if (notifs.length === 0) return null;
  return (
    <div style={{ marginTop: 4 }}>
      <div
        style={{
          padding: "16px 20px 6px",
          fontSize: 12,
          fontWeight: 600,
          color: "rgba(255,255,255,0.4)",
        }}
      >
        {label}
      </div>
      {notifs.map((n) => (
        <NotifRow key={n.id} notif={n} onTap={onTap} />
      ))}
    </div>
  );
}

function NotifRow({
  notif,
  onTap,
}: {
  notif: Notification;
  onTap: (n: Notification) => void;
}) {
  const isCircle = notif.type === "CIRCLE_ACTIVITY";
  const tappable = !!notif.storyId || true;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onTap(notif)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onTap(notif); }}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "13px 20px",
        background: notif.read
          ? "transparent"
          : "rgba(245,158,11,0.04)",
        border: notif.read ? "none" : "none",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        cursor: tappable ? "pointer" : "default",
        position: "relative",
        transition: "background 0.15s ease",
        borderLeft: notif.read
          ? "2px solid transparent"
          : "2px solid rgba(245,158,11,0.22)",
      }}
    >
      {/* Left avatar or circle icon */}
      <div style={{ flexShrink: 0, paddingTop: 1 }}>
        {isCircle ? (
          <CircleIcon
            label={notif.circleLabel || ""}
            color={notif.circleColor || "#f59e0b"}
          />
        ) : (
          <div style={{ position: "relative" }}>
            <Avatar
              userId={notif.userId || ""}
              color={notif.userColor || "#888"}
              size={40}
              border="none"
            />
            {notif.circleLabel && (
              <div
                style={{
                  position: "absolute",
                  bottom: -3,
                  right: -3,
                  background: "rgba(245,158,11,0.22)",
                  border: "1px solid rgba(245,158,11,0.4)",
                  borderRadius: 6,
                  padding: "1px 4px",
                  fontSize: 8,
                  fontWeight: 600,
                  color: "#f59e0b",
                  letterSpacing: "0.03em",
                  whiteSpace: "nowrap",
                }}
              >
                {notif.circleLabel}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            color: "rgba(255,255,255,0.88)",
            lineHeight: 1.45,
          }}
        >
          <span
            style={{
              fontWeight: 600,
              color: notif.read ? "rgba(255,255,255,0.82)" : "#fff",
            }}
          >
            {isCircle ? notif.circleLabel : notif.userName}
          </span>{" "}
          <span
            style={{
              color: notif.read
                ? "rgba(255,255,255,0.5)"
                : "rgba(255,255,255,0.72)",
            }}
          >
            {notif.text}
          </span>
        </div>
        {notif.preview && (
          <div
            style={{
              marginTop: 4,
              fontSize: 13,
              color: "rgba(255,255,255,0.32)",
              fontStyle: "italic",
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            "{notif.preview}"
          </div>
        )}
      </div>

      {/* Right: time + unread dot */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 6,
          flexShrink: 0,
          paddingTop: 1,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: notif.read
              ? "rgba(255,255,255,0.28)"
              : "rgba(255,255,255,0.45)",
          }}
        >
          {notif.timeAgo}
        </span>
        {!notif.read && (
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#f59e0b",
              boxShadow: "0 0 6px rgba(245,158,11,0.6)",
            }}
          />
        )}
      </div>
    </div>
  );
}

function CircleIcon({ label, color }: { label: string; color: string }) {
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        background: `${color}18`,
        border: `1.5px solid ${color}45`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          border: `2px solid ${color}`,
          background: `${color}22`,
        }}
      />
      <div
        style={{
          fontSize: 6,
          fontWeight: 700,
          color: color,
          letterSpacing: "0.04em",
          textAlign: "center",
          lineHeight: 1,
          maxWidth: 34,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </div>
  );
}
