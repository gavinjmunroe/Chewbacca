"use client";

import { useReducer, useEffect } from "react";
import { NavProps, CIRCLES, DAILY_PROMPT } from "@/types";
import StatusBar from "@/components/StatusBar";

const MIN_WORDS = 50;
const MAX_WORDS = 900;
const VOICE_MIN_SECS = 8;
type MediaMode = "written" | "photo" | "voice";

const VOICE_BARS = [4,8,6,12,9,15,11,7,13,10,6,14,8,5,11,9,7,13,10,6,12,8,5,10,14,7,9,11,6,8];

function PencilIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ color }}>
      <path d="M12 3L15 6L6 15H3V12L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

function CameraIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ color }}>
      <path d="M1 6.5a1 1 0 0 1 1-1h2l1.5-2h7L14 5.5h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-8z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      <circle cx="9" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  );
}

function MicIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ color }}>
      <rect x="6" y="1.5" width="6" height="8" rx="3" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M3.5 9a5.5 5.5 0 0 0 11 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="9" y1="14.5" x2="9" y2="16.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
}

interface ComposeState {
  text: string;
  mode: MediaMode;
  recording: boolean;
  recordSeconds: number;
  humanAffirmed: boolean;
  submitted: boolean;
  modeSwitchWarning: boolean;
  showCancelConfirm: boolean;
}

type ComposeAction =
  | { type: "SET_TEXT"; value: string }
  | { type: "SET_MODE"; value: MediaMode }
  | { type: "SET_RECORDING"; value: boolean }
  | { type: "INCREMENT_RECORD_SECONDS" }
  | { type: "RESET_RECORD_SECONDS" }
  | { type: "TOGGLE_HUMAN_AFFIRMED" }
  | { type: "SET_SUBMITTED" }
  | { type: "SET_MODE_SWITCH_WARNING"; value: boolean }
  | { type: "SET_SHOW_CANCEL_CONFIRM"; value: boolean };

function composeReducer(state: ComposeState, action: ComposeAction): ComposeState {
  switch (action.type) {
    case "SET_TEXT": return { ...state, text: action.value };
    case "SET_MODE": return { ...state, mode: action.value, humanAffirmed: false };
    case "SET_RECORDING": return { ...state, recording: action.value };
    case "INCREMENT_RECORD_SECONDS": return { ...state, recordSeconds: state.recordSeconds + 1 };
    case "RESET_RECORD_SECONDS": return { ...state, recordSeconds: 0 };
    case "TOGGLE_HUMAN_AFFIRMED": return { ...state, humanAffirmed: !state.humanAffirmed };
    case "SET_SUBMITTED": return { ...state, submitted: true };
    case "SET_MODE_SWITCH_WARNING": return { ...state, modeSwitchWarning: action.value };
    case "SET_SHOW_CANCEL_CONFIRM": return { ...state, showCancelConfirm: action.value };
    default: return state;
  }
}

interface CancelDialogProps {
  onKeep: () => void;
  onDiscard: () => void;
}

function CancelDialog({ onKeep, onDiscard }: CancelDialogProps) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(15,12,10,0.88)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "0 32px" }}>
      <div className="dialog-in" style={{ background: "rgba(20,12,35,0.98)", borderRadius: 16, padding: 24, width: "100%" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 6, fontFamily: "var(--font-dm-sans)", textAlign: "center" as const }}>Lose your response?</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 20, fontFamily: "var(--font-inter)", textAlign: "center" as const }}>Your draft will be deleted.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button onClick={onKeep} style={{ width: "100%", background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.28)", color: "#f59e0b", padding: 12, borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-inter)" }}>Keep writing</button>
          <button onClick={onDiscard} style={{ width: "100%", background: "none", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.45)", padding: 12, borderRadius: 10, fontSize: 14, cursor: "pointer", fontFamily: "var(--font-inter)" }}>Discard</button>
        </div>
      </div>
    </div>
  );
}

interface VoiceRecorderProps {
  recording: boolean;
  recordSeconds: number;
  onToggle: () => void;
}

function VoiceRecorder({ recording, recordSeconds, onToggle }: VoiceRecorderProps) {
  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div style={{ padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
      <div style={{ width: "100%", height: 60, display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
        {VOICE_BARS.map((h, barPos) => (
          <div key={`voice-bar-pos-${barPos}-h-${h}`} style={{ width: 3, borderRadius: 2, height: recording ? `${Math.max(4, h * 1.5)}px` : "4px", backgroundColor: recording ? "rgba(245,158,11,0.7)" : "rgba(255,255,255,0.1)", transition: "height 0.15s ease" }} />
        ))}
      </div>
      <div style={{ fontSize: 32, fontWeight: 300, color: "#fff", fontFamily: "var(--font-dm-sans)", letterSpacing: "0.05em" }}>{formatTime(recordSeconds)}</div>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {recording && <div style={{ position: "absolute", inset: -16, borderRadius: "50%", border: "2px solid rgba(239,68,68,0.4)", animation: "record-ring 1.4s ease-out infinite", pointerEvents: "none" }} />}
        <button onClick={onToggle} style={{ width: 64, height: 64, borderRadius: "50%", backgroundColor: recording ? "rgba(239,68,68,0.9)" : "rgba(245,158,11,0.9)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: recording ? "0 0 24px rgba(239,68,68,0.35)" : "0 0 20px rgba(245,158,11,0.28)", transition: "background-color 0.2s ease" }}>
          {recording ? <div style={{ width: 18, height: 18, backgroundColor: "#fff", borderRadius: 2 }} /> : <div style={{ width: 14, height: 14, borderRadius: "50%", backgroundColor: "#fff" }} />}
        </button>
      </div>
      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.28)", fontFamily: "var(--font-inter)" }}>{recording ? "Recording. Tap to stop." : "Tap to start recording"}</span>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.18)", fontFamily: "var(--font-inter)", textAlign: "center" as const, lineHeight: 1.5, maxWidth: 200 }}>
        Voice: {VOICE_MIN_SECS} sec min, 6 min max. No editing.
      </div>
    </div>
  );
}

interface WrittenBottomBarProps {
  wordCount: number;
  wordReady: boolean;
  humanAffirmed: boolean;
  progress: number;
  onToggleHuman: () => void;
}

function WrittenBottomBar({ wordCount, wordReady, humanAffirmed, progress, onToggleHuman }: WrittenBottomBarProps) {
  return (
    <>
      <div style={{ height: 2, backgroundColor: "rgba(255,255,255,0.04)" }}>
        <div style={{ height: "100%", width: `${progress * 100}%`, backgroundColor: "rgba(245,158,11,0.4)", borderRadius: "0 2px 2px 0", transition: "width 0.1s ease" }} />
      </div>
      <div style={{ padding: "11px 18px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ color: "#fff", fontWeight: 600, fontSize: 14 }}>{wordCount}</span>
              {!wordReady ? <span style={{ color: "rgba(255,255,255,0.32)", fontSize: 13 }}> / {MIN_WORDS} words</span> : <span style={{ color: "#34d399", fontSize: 13 }}> words ✓</span>}
            </div>
            <div style={{ marginTop: 2 }}>
              {!wordReady ? <span style={{ color: "rgba(255,255,255,0.32)", fontSize: 11 }}>Keep going. 50 words minimum.</span> : <span style={{ color: "rgba(52,211,153,0.65)", fontSize: 11 }}>Ready to share</span>}
            </div>
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.16)", fontFamily: "var(--font-inter)", textAlign: "right" as const }}>Max {MAX_WORDS} words<br />Private to your 3 Circles</div>
        </div>
        <button onClick={onToggleHuman} style={{ display: "flex", alignItems: "center", gap: 10, backgroundColor: humanAffirmed ? "rgba(52,211,153,0.07)" : "rgba(255,255,255,0.025)", border: humanAffirmed ? "1px solid rgba(52,211,153,0.25)" : "1px solid rgba(255,255,255,0.09)", borderRadius: 10, padding: "10px 14px", cursor: "pointer", textAlign: "left" as const, width: "100%", boxSizing: "border-box" as const }}>
          <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, border: humanAffirmed ? "none" : "1.5px solid rgba(255,255,255,0.18)", backgroundColor: humanAffirmed ? "#34d399" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {humanAffirmed && <svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4.5L4 7.5L10 1" stroke="#0f0c0a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: humanAffirmed ? "#34d399" : "rgba(255,255,255,0.68)", fontFamily: "var(--font-inter)" }}>This is my own voice</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontFamily: "var(--font-inter)", marginTop: 2, lineHeight: 1.4 }}>Not AI. Not a draft someone else wrote.</div>
          </div>
        </button>
        <div style={{ margin: "14px 0 0", padding: "12px 14px", backgroundColor: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.1)", borderRadius: 10 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-inter)", marginBottom: 8 }}>Posting to</div>
          <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6 }}>
            {CIRCLES.map(c => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 4, height: 4, borderRadius: "50%", backgroundColor: "rgba(245,158,11,0.6)", flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", fontFamily: "var(--font-inter)", fontWeight: 500 }}>{c.name}</span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontFamily: "var(--font-inter)" }}>({c.memberIds.length})</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export default function ComposeScreen({ goBack, onPost }: NavProps) {
  const [state, dispatch] = useReducer(composeReducer, {
    text: "",
    mode: "written",
    recording: false,
    recordSeconds: 0,
    humanAffirmed: false,
    submitted: false,
    modeSwitchWarning: false,
    showCancelConfirm: false,
  });
  const { text, mode, recording, recordSeconds, humanAffirmed, submitted, modeSwitchWarning, showCancelConfirm } = state;

  useEffect(() => {
    if (!recording) return;
    const intervalId = setInterval(() => dispatch({ type: "INCREMENT_RECORD_SECONDS" }), 1000);
    return () => clearInterval(intervalId);
  }, [recording]);

  const wordCount = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
  const wordReady = mode !== "written" || wordCount >= MIN_WORDS;
  const voiceReady = mode === "voice" && !recording && recordSeconds >= VOICE_MIN_SECS;
  const isReady = mode === "written" ? (wordReady && humanAffirmed) : mode === "voice" ? voiceReady : true;
  const progress = Math.min(1, wordCount / MIN_WORDS);

  const handleRecordToggle = () => {
    if (!recording) dispatch({ type: "RESET_RECORD_SECONDS" });
    dispatch({ type: "SET_RECORDING", value: !recording });
  };

  const handlePost = () => {
    if (!isReady) return;
    dispatch({ type: "SET_SUBMITTED" });
    setTimeout(() => onPost?.(), 900);
  };

  const modeOptions: { key: MediaMode; label: string; Icon: React.FC<{color: string}>; desc: string }[] = [
    { key: "written", label: "Written", Icon: PencilIcon, desc: "50+ words" },
    { key: "photo",   label: "Photo",   Icon: CameraIcon, desc: "+ caption" },
    { key: "voice",   label: "Voice",   Icon: MicIcon,    desc: "8 sec min" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#0f0c0a", position: "relative" }}>
      <StatusBar />

      {showCancelConfirm && (
        <CancelDialog
          onKeep={() => dispatch({ type: "SET_SHOW_CANCEL_CONFIRM", value: false })}
          onDiscard={() => goBack?.()}
        />
      )}

      {submitted && (
        <div style={{ position: "absolute", inset: 0, zIndex: 20, backgroundColor: "rgba(15,12,10,0.96)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, animation: "fade-in 0.25s ease" }}>
          <div style={{ width: 72, height: 72, borderRadius: "50%", backgroundColor: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.22)", display: "flex", alignItems: "center", justifyContent: "center", animation: "celebrate-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards" }}>
            <div style={{ fontSize: 30, color: "#34d399", lineHeight: 1 }}>✓</div>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", fontFamily: "var(--font-dm-sans)" }}>Story posted</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.38)", fontFamily: "var(--font-inter)" }}>Shared with your 3 Circles</div>
        </div>
      )}

      <div style={{ flexShrink: 0, paddingTop: 52, padding: "52px 16px 10px", display: "flex", flexDirection: "row", alignItems: "center", backgroundColor: "#0f0c0a", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <button onClick={() => { if ((mode === "written" && text.length > 0) || (mode === "voice" && recordSeconds > 0)) { dispatch({ type: "SET_SHOW_CANCEL_CONFIRM", value: true }); } else { goBack?.(); } }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 14, cursor: "pointer", padding: "4px 0", minWidth: 60, fontFamily: "var(--font-inter)" }}>Cancel</button>
        <div style={{ flex: 1, textAlign: "center" }}><span style={{ color: "#fff", fontSize: 15, fontWeight: 600, fontFamily: "var(--font-dm-sans)" }}>Your Story</span></div>
        <button onClick={handlePost} style={{ background: "none", border: "none", color: isReady ? "#f59e0b" : "rgba(255,255,255,0.16)", fontSize: 14, fontWeight: 600, cursor: isReady ? "pointer" : "default", padding: "4px 0", minWidth: 60, textAlign: "right" as const, fontFamily: "var(--font-inter)" }}>Post</button>
      </div>

      <div className="inner-scroll" style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ margin: "16px 16px 0" }}>
          <div style={{ fontSize: 12, color: "rgba(245,158,11,0.75)", fontWeight: 600, marginBottom: 8, fontFamily: "var(--font-inter)" }}>Today&apos;s prompt</div>
          <div style={{ fontSize: 15, color: "rgba(255,255,255,0.75)", lineHeight: 1.6, fontFamily: "var(--font-inter)" }}>{DAILY_PROMPT}</div>
          <div style={{ height: 1, backgroundColor: "rgba(255,255,255,0.05)", marginTop: 16 }} />
        </div>

        <div style={{ padding: "14px 16px 0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            {modeOptions.map(({ key, label, Icon, desc }) => (
              <button key={key} onClick={() => { if (key !== mode && wordCount > 0) { dispatch({ type: "SET_MODE_SWITCH_WARNING", value: true }); setTimeout(() => dispatch({ type: "SET_MODE_SWITCH_WARNING", value: false }), 2000); } dispatch({ type: "SET_MODE", value: key }); }} style={{ backgroundColor: mode === key ? "rgba(245,158,11,0.1)" : "rgba(255,255,255,0.025)", border: mode === key ? "1px solid rgba(245,158,11,0.32)" : "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "10px 8px", cursor: "pointer", textAlign: "center" as const, transition: "background-color 0.15s ease, border-color 0.15s ease", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <Icon color={mode === key ? "#f59e0b" : "rgba(255,255,255,0.38)"} />
                <div style={{ fontSize: 11, fontWeight: 600, color: mode === key ? "#fff" : "rgba(255,255,255,0.45)", fontFamily: "var(--font-inter)" }}>{label}</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", fontFamily: "var(--font-inter)", lineHeight: 1.3 }}>{desc}</div>
              </button>
            ))}
          </div>
          {modeSwitchWarning && (
            <div style={{ marginTop: 8, backgroundColor: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.18)", borderRadius: 8, padding: "8px 12px", animation: "fade-in 0.2s ease" }}>
              <span style={{ fontSize: 11, color: "rgba(245,158,11,0.65)", fontFamily: "var(--font-inter)" }}>Your written response will be saved if you switch back.</span>
            </div>
          )}
        </div>

        {mode === "written" && (
          <div style={{ padding: "14px 18px" }}>
            <textarea value={text} onChange={(e) => dispatch({ type: "SET_TEXT", value: e.target.value })} placeholder="Write what's actually on your mind. Be specific. Vague responses won't land." style={{ width: "100%", minHeight: 220, backgroundColor: "transparent", border: "none", outline: "none", resize: "none", color: "rgba(255,255,255,0.85)", fontSize: 15, lineHeight: 1.65, fontFamily: "var(--font-inter)", boxSizing: "border-box" as const }} />
          </div>
        )}

        {mode === "photo" && (
          <div style={{ padding: "14px 16px" }}>
            <div style={{ width: "100%", height: 160, backgroundColor: "rgba(255,255,255,0.025)", border: "1.5px dashed rgba(255,255,255,0.09)", borderRadius: 14, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: "rgba(245,158,11,0.09)", border: "1px solid rgba(245,158,11,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }}><CameraIcon color="rgba(245,158,11,0.65)" /></div>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.28)", fontFamily: "var(--font-inter)" }}>Add a photo (up to 3)</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.16)", fontFamily: "var(--font-inter)" }}>Screenshot, photo, or visual context</span>
            </div>
            <textarea placeholder="Caption: what are we looking at, and why does it matter?" style={{ width: "100%", minHeight: 100, marginTop: 14, backgroundColor: "transparent", border: "none", outline: "none", resize: "none", color: "rgba(255,255,255,0.85)", fontSize: 14, lineHeight: 1.6, fontFamily: "var(--font-inter)", boxSizing: "border-box" as const }} />
          </div>
        )}

        {mode === "voice" && <VoiceRecorder recording={recording} recordSeconds={recordSeconds} onToggle={handleRecordToggle} />}
      </div>

      <div style={{ flexShrink: 0, borderTop: "1px solid rgba(255,255,255,0.05)", backgroundColor: "#0f0c0a" }}>
        {mode === "written" ? (
          <WrittenBottomBar wordCount={wordCount} wordReady={wordReady} humanAffirmed={humanAffirmed} progress={progress} onToggleHuman={() => dispatch({ type: "TOGGLE_HUMAN_AFFIRMED" })} />
        ) : (
          <div style={{ padding: "11px 18px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.22)", fontFamily: "var(--font-inter)" }}>Private to your 3 Circles</div>
              {mode === "voice" ? (
                <div style={{ fontSize: 11, color: voiceReady ? "#34d399" : "rgba(255,255,255,0.28)", fontFamily: "var(--font-inter)" }}>
                  {recordSeconds === 0 ? "Tap the mic to start" : voiceReady ? "✓ Ready to post" : `${recordSeconds}s / ${VOICE_MIN_SECS}s min${recording ? " · recording" : ""}`}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "#34d399", fontFamily: "var(--font-inter)" }}>✓ Ready to post</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
