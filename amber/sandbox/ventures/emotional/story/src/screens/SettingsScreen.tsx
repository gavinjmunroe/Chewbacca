"use client";

import { useReducer } from "react";
import { NavProps, USERS } from "@/types";
import StatusBar from "@/components/StatusBar";

interface ToggleProps {
  on: boolean;
  onToggle: () => void;
}

function Toggle({ on, onToggle }: ToggleProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggle(); }}
      style={{
        width: 44,
        height: 26,
        borderRadius: 13,
        background: on ? "rgba(245,158,11,0.8)" : "rgba(255,255,255,0.1)",
        position: "relative",
        cursor: "pointer",
        flexShrink: 0,
        transition: "background 0.2s ease",
        boxShadow: on ? "0 0 10px rgba(245,158,11,0.3)" : "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 3,
          left: on ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 0.2s ease",
          boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
        }}
      />
    </div>
  );
}

const SECTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "rgba(255,255,255,0.45)",
  paddingBottom: 8,
  paddingTop: 16,
};

const FIRST_SECTION_LABEL_STYLE: React.CSSProperties = {
  ...SECTION_LABEL_STYLE,
  paddingTop: 8,
};

const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "14px 0",
  borderBottom: "1px solid rgba(255,255,255,0.04)",
};

const ROW_LABEL_STYLE: React.CSSProperties = {
  fontSize: 14,
  color: "rgba(255,255,255,0.82)",
  fontFamily: "var(--font-inter), sans-serif",
};

const ROW_VALUE_STYLE: React.CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.32)",
  fontFamily: "var(--font-inter), sans-serif",
  textAlign: "right" as const,
};

const LOCKED_VALUE_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.22)",
  fontFamily: "var(--font-inter), sans-serif",
  fontStyle: "italic",
};

const CONTENT_RULE_ROW: React.CSSProperties = {
  padding: "14px 0",
  borderBottom: "1px solid rgba(255,255,255,0.04)",
};

const CONTENT_RULE_LABEL: React.CSSProperties = {
  fontSize: 14,
  color: "rgba(255,255,255,0.82)",
  fontFamily: "var(--font-inter), sans-serif",
  marginBottom: 3,
};

const CONTENT_RULE_DESC: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.3)",
  fontStyle: "italic",
  fontFamily: "var(--font-inter), sans-serif",
  lineHeight: 1.45,
};

interface ContentRuleRowProps {
  label: string;
  desc: string;
  last?: boolean;
}

function ContentRuleRow({ label, desc, last }: ContentRuleRowProps) {
  return (
    <div style={{ ...CONTENT_RULE_ROW, ...(last ? { borderBottom: "none" } : {}) }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", lineHeight: 1 }}>·</span>
        <span style={CONTENT_RULE_LABEL}>{label}</span>
      </div>
      <div style={{ paddingLeft: 14 }}>
        <span style={CONTENT_RULE_DESC}>{desc}</span>
      </div>
    </div>
  );
}

interface NotificationRowProps {
  label: string;
  on: boolean;
  onToggle: () => void;
}

function NotificationRow({ label, on, onToggle }: NotificationRowProps) {
  return (
    <div style={ROW_STYLE}>
      <span style={ROW_LABEL_STYLE}>{label}</span>
      <Toggle on={on} onToggle={onToggle} />
    </div>
  );
}

interface SettingsState {
  notifDailyPrompt: boolean;
  notifReply: boolean;
  notifCircleActivity: boolean;
  notifNewMember: boolean;
  toast: string | null;
}

type SettingsAction =
  | { type: "TOGGLE_DAILY_PROMPT" }
  | { type: "TOGGLE_REPLY" }
  | { type: "TOGGLE_CIRCLE_ACTIVITY" }
  | { type: "TOGGLE_NEW_MEMBER" }
  | { type: "SET_TOAST"; msg: string | null };

function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case "TOGGLE_DAILY_PROMPT": return { ...state, notifDailyPrompt: !state.notifDailyPrompt };
    case "TOGGLE_REPLY": return { ...state, notifReply: !state.notifReply };
    case "TOGGLE_CIRCLE_ACTIVITY": return { ...state, notifCircleActivity: !state.notifCircleActivity };
    case "TOGGLE_NEW_MEMBER": return { ...state, notifNewMember: !state.notifNewMember };
    case "SET_TOAST": return { ...state, toast: action.msg };
    default: return state;
  }
}

export default function SettingsScreen({ navigate: _navigate, goBack }: NavProps) {
  const [state, dispatch] = useReducer(settingsReducer, {
    notifDailyPrompt: true,
    notifReply: true,
    notifCircleActivity: true,
    notifNewMember: true,
    toast: null,
  });

  const { notifDailyPrompt, notifReply, notifCircleActivity, notifNewMember, toast } = state;

  function showToast(msg: string) {
    dispatch({ type: "SET_TOAST", msg });
    setTimeout(() => dispatch({ type: "SET_TOAST", msg: null }), 2200);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0f0c0a", color: "#fff", fontFamily: "var(--font-inter), sans-serif", overflowX: "hidden", position: "relative" }}>
      <StatusBar />

      {toast && (
        <div style={{ position: "absolute", bottom: 32, left: "50%", transform: "translateX(-50%)", backgroundColor: "rgba(20,16,12,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 18px", fontSize: 13, color: "rgba(255,255,255,0.75)", fontFamily: "var(--font-inter)", zIndex: 50, whiteSpace: "nowrap", boxShadow: "0 4px 20px rgba(0,0,0,0.4)", animation: "fade-in 0.2s ease" }}>
          {toast}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "52px 20px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <button onClick={goBack} style={{ background: "none", border: "none", color: "#f59e0b", fontSize: 22, cursor: "pointer", padding: "2px 4px", lineHeight: 1, display: "flex", alignItems: "center" }}>
          &#8592;
        </button>
        <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em", fontFamily: "var(--font-dm-sans), sans-serif" }}>Settings</span>
        <div style={{ width: 36 }} />
      </div>

      <div className="inner-scroll" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px", paddingBottom: 48 }}>
        <div style={FIRST_SECTION_LABEL_STYLE}>Account</div>
        <div style={ROW_STYLE}>
          <span style={ROW_LABEL_STYLE}>Name</span>
          <span style={ROW_VALUE_STYLE}>{USERS.caleb.name}</span>
        </div>
        <div style={ROW_STYLE}>
          <span style={ROW_LABEL_STYLE}>Campus</span>
          <span style={{ ...ROW_VALUE_STYLE, maxWidth: 180, textAlign: "right", lineHeight: 1.35 }}>USC Iovine &amp; Young Academy</span>
        </div>
        <div style={ROW_STYLE}>
          <span style={ROW_LABEL_STYLE}>Identity</span>
          <span style={{ fontSize: 13, color: "#34d399", fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 14, height: 14, borderRadius: "50%", border: "1.5px solid #34d399", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>&#10003;</span>
            Verified Human
          </span>
        </div>

        <div style={SECTION_LABEL_STYLE}>Notifications</div>
        <NotificationRow label="Daily prompt reminder" on={notifDailyPrompt} onToggle={() => dispatch({ type: "TOGGLE_DAILY_PROMPT" })} />
        <NotificationRow label="Reply received" on={notifReply} onToggle={() => dispatch({ type: "TOGGLE_REPLY" })} />
        <NotificationRow label="Circle activity" on={notifCircleActivity} onToggle={() => dispatch({ type: "TOGGLE_CIRCLE_ACTIVITY" })} />
        <NotificationRow label="New circle member" on={notifNewMember} onToggle={() => dispatch({ type: "TOGGLE_NEW_MEMBER" })} />

        <div style={SECTION_LABEL_STYLE}>Content Rules</div>
        <ContentRuleRow label="Minimum reply length: 50 words" desc="This is what makes replies meaningful" />
        <ContentRuleRow label="Max posts per day: 1 story" desc="Reflection over broadcasting" />
        <ContentRuleRow label="AI-generated content: Not permitted" desc="Verified human only" last />

        <div style={SECTION_LABEL_STYLE}>Privacy</div>
        <div style={ROW_STYLE}>
          <span style={ROW_LABEL_STYLE}>Stories shared with</span>
          <span style={LOCKED_VALUE_STYLE}>Your Circles only · locked</span>
        </div>
        <div style={ROW_STYLE}>
          <span style={ROW_LABEL_STYLE}>Your posts visible to</span>
          <span style={LOCKED_VALUE_STYLE}>Circle members only · locked</span>
        </div>

        <div style={SECTION_LABEL_STYLE}>About</div>
        <div style={ROW_STYLE}>
          <span style={ROW_LABEL_STYLE}>Story v0.9 beta</span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.22)", fontStyle: "italic" }}>Post less. Mean more.</span>
        </div>
        <div role="button" tabIndex={0} onClick={() => showToast("Thanks for rating Story!")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") showToast("Thanks for rating Story!"); }} style={{ ...ROW_STYLE, cursor: "pointer" }}>
          <span style={{ ...ROW_LABEL_STYLE, color: "rgba(255,255,255,0.65)" }}>Rate Story</span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.22)" }}>›</span>
        </div>
        <div role="button" tabIndex={0} onClick={() => showToast("Feedback noted. Thank you.")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") showToast("Feedback noted. Thank you."); }} style={{ ...ROW_STYLE, borderBottom: "none", cursor: "pointer" }}>
          <span style={{ ...ROW_LABEL_STYLE, color: "rgba(255,255,255,0.65)" }}>Send Feedback</span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.22)" }}>›</span>
        </div>
      </div>
    </div>
  );
}
