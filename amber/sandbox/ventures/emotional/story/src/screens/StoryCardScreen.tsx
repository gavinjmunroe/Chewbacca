"use client";

import { useReducer, useEffect, useRef } from "react";
import { NavProps, STORIES, USERS, StoryUser } from "@/types";
import StatusBar from "@/components/StatusBar";
import Avatar from "@/components/Avatar";
import Image from "next/image";

interface MockReply {
  id: string;
  storyId: string;
  user: StoryUser;
  text: string;
  timeAgo: string;
}

const MOCK_REPLIES: MockReply[] = [
  { id: "r1", storyId: "marcus-1", user: USERS.priya, text: "The part about efficiency being a tool and not a value really shifted something for me. I keep treating productivity as if it has moral weight.", timeAgo: "30m" },
  { id: "r2", storyId: "marcus-1", user: USERS.elena, text: "Your grandparents' Saturday wandering versus the tracked leisure thing. That tension is exactly what I feel every weekend. I never just let time happen.", timeAgo: "45m" },
  { id: "r3", storyId: "priya-1", user: USERS.marcus, text: "The 10-minute vs 3-hour framing is so good. I think I have the same thing where asking feels like admitting I should have figured it out already.", timeAgo: "1h" },
  { id: "r4", storyId: "priya-1", user: USERS.kofi, text: "Knowledge is collective, not just inside people. This is one of those things that sounds obvious once you say it and is somehow still hard to live.", timeAgo: "2h" },
  { id: "r5", storyId: "daniel-1", user: USERS.aisha, text: "The reframe from 'I need to overcome this' to 'I still care enough to be honest about what I don't know' is going to stay with me for a while.", timeAgo: "2h" },
  { id: "r6", storyId: "aisha-1", user: USERS.sam, text: "The distinction between overthinking-as-noise vs overthinking-as-signal is one I've never seen articulated this clearly. This felt very true.", timeAgo: "3h" },
  { id: "r7", storyId: "sam-1", user: USERS.nadia, text: "Self-sufficiency as fear with better branding. That sentence hit hard. I've been calling the same thing 'independence' for years.", timeAgo: "4h" },
  { id: "r8", storyId: "caleb-1", user: USERS.elena, text: "The thing about killing a project because the explanation would take more than 30 seconds. That's exactly the kind of optimization I didn't know I was running.", timeAgo: "7d" },
  { id: "r9", storyId: "caleb-2", user: USERS.marcus, text: "Tracing where the inner critic learned its voice instead of fighting it is a completely different approach than what I've been trying. I want to try this.", timeAgo: "14d" },
];

const WAVEFORMS = [
  [3,7,5,9,6,11,8,14,10,7,13,9,5,12,8,6,11,7,4,9,12,6,8,10,5,7,13,9,6,8,5,11,7,4,9],
  [5,9,7,12,4,8,11,6,14,9,5,10,7,13,8,4,11,6,9,7,12,5,8,10,6,14,7,9,5,8,4,9,7,12,5],
  [4,8,6,11,9,7,13,5,10,8,4,12,6,9,11,5,7,10,8,6,13,4,9,7,11,6,8,12,5,9,8,11,7,4,9],
  [6,10,8,13,5,9,7,11,4,12,8,6,10,7,13,5,9,6,11,8,4,10,7,12,6,9,5,11,8,7,9,12,6,10,8],
];
function getWaveform(storyId: string) { return WAVEFORMS[storyId.charCodeAt(0) % WAVEFORMS.length]; }

function parseDurationSecs(dur: string): number {
  const parts = dur.split(":").map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

interface StoryCardState {
  reacted: string | null;
  isPlaying: boolean;
  playProgress: number;
  reactionBounce: string | null;
  reply: string;
  replySent: boolean;
}

type StoryCardAction =
  | { type: "SET_REACTED"; value: string | null }
  | { type: "SET_IS_PLAYING"; value: boolean }
  | { type: "SET_PLAY_PROGRESS"; value: number }
  | { type: "STOP_PLAYBACK" }
  | { type: "SET_REACTION_BOUNCE"; value: string | null }
  | { type: "SET_REPLY"; value: string }
  | { type: "SET_REPLY_SENT" };

function storyCardReducer(state: StoryCardState, action: StoryCardAction): StoryCardState {
  switch (action.type) {
    case "SET_REACTED": return { ...state, reacted: action.value };
    case "SET_IS_PLAYING": return { ...state, isPlaying: action.value };
    case "SET_PLAY_PROGRESS": return { ...state, playProgress: action.value };
    case "STOP_PLAYBACK": return { ...state, isPlaying: false, playProgress: 0 };
    case "SET_REACTION_BOUNCE": return { ...state, reactionBounce: action.value };
    case "SET_REPLY": return { ...state, reply: action.value };
    case "SET_REPLY_SENT": return { ...state, replySent: true };
    default: return state;
  }
}

type StoryType = typeof STORIES[number];

interface AudioPlayerProps {
  story: StoryType;
  isPlaying: boolean;
  playProgress: number;
  waveformBars: number[];
  audioDurationSecs: number;
  onTogglePlay: () => void;
}

function AudioPlayer({ story, isPlaying, playProgress, waveformBars, audioDurationSecs, onTogglePlay }: AudioPlayerProps) {
  return (
    <div style={{ backgroundColor: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)", borderRadius: 14, padding: "14px 16px", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <button onClick={onTogglePlay} style={{ width: 38, height: 38, borderRadius: "50%", backgroundColor: "rgba(245,158,11,0.18)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {isPlaying ? (
            <div style={{ display: "flex", gap: 3 }}>
              <div style={{ width: 3, height: 12, backgroundColor: "rgba(245,158,11,0.9)", borderRadius: 1 }} />
              <div style={{ width: 3, height: 12, backgroundColor: "rgba(245,158,11,0.9)", borderRadius: 1 }} />
            </div>
          ) : (
            <div style={{ width: 0, height: 0, borderTop: "7px solid transparent", borderBottom: "7px solid transparent", borderLeft: "12px solid rgba(245,158,11,0.9)", marginLeft: 3 }} />
          )}
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", fontFamily: "var(--font-inter)", marginBottom: 6 }}>Voice Story · {story.audioDuration}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 2, height: 24 }}>
            {waveformBars.map((h, barPos) => {
              const playedThreshold = Math.floor((playProgress / 100) * waveformBars.length);
              const barColor = isPlaying ? (barPos < playedThreshold ? "rgba(245,158,11,0.9)" : "rgba(245,158,11,0.22)") : (barPos < 12 ? "rgba(245,158,11,0.7)" : "rgba(245,158,11,0.18)");
              return <div key={`waveform-bar-pos-${barPos}-h-${h}`} style={{ width: 3, borderRadius: 2, height: `${Math.max(3, h * 1.4)}px`, backgroundColor: barColor, transition: "background-color 0.15s ease" }} />;
            })}
          </div>
        </div>
      </div>
      <div style={{ height: 2, backgroundColor: "rgba(245,158,11,0.12)", borderRadius: 999, position: "relative", overflow: "hidden" }}>
        <div key={isPlaying ? "playing" : "stopped"} style={{ height: "100%", backgroundColor: "rgba(245,158,11,0.65)", borderRadius: 999, width: isPlaying ? "100%" : "0%", animation: isPlaying ? `audio-play ${audioDurationSecs}s linear forwards` : "none" }} />
      </div>
    </div>
  );
}

interface ReactionPanelProps {
  story: StoryType;
  reacted: string | null;
  reactionBounce: string | null;
  onReact: (type: string) => void;
}

function ReactionPanel({ story, reacted, reactionBounce, onReact }: ReactionPanelProps) {
  const reactionOptions = [
    { type: "think",   symbol: "◦◦", label: "Made me think"    },
    { type: "changed", symbol: "⟳",  label: "Changed my view"  },
    { type: "felt",    symbol: "◎",   label: "Felt this deeply" },
    { type: "door",    symbol: "→",   label: "Opened a door"    },
  ];
  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ height: 1, backgroundColor: "rgba(255,255,255,0.05)", marginBottom: 20 }} />
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginBottom: 12, fontFamily: "var(--font-inter)", fontWeight: 600 }}>How did this land?</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
        {reactionOptions.map(({ type, symbol, label }) => {
          const count = story.reactions[type as keyof typeof story.reactions];
          const isSelected = reacted === type;
          const displayCount = isSelected ? count + 1 : count;
          return (
            <div key={type} style={{ transform: `scale(${reactionBounce === type ? 1.12 : 1})`, transition: "transform 0.15s ease" }}>
              <button onClick={() => onReact(type)} style={{ backgroundColor: isSelected ? "rgba(245,158,11,0.1)" : "rgba(255,255,255,0.025)", border: isSelected ? "1px solid rgba(245,158,11,0.3)" : "1px solid rgba(255,255,255,0.055)", borderRadius: 12, padding: "10px 14px", cursor: "pointer", width: "100%", minHeight: 44, textAlign: "left" as const, display: "flex", alignItems: "center", gap: 8, transition: "background-color 0.15s, border-color 0.15s" }}>
                <span style={{ fontSize: 13, color: isSelected ? "#f59e0b" : "rgba(255,255,255,0.3)", flexShrink: 0, lineHeight: 1, fontFamily: "var(--font-inter)" }}>{symbol}</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: isSelected ? "#fff" : "rgba(255,255,255,0.65)", fontFamily: "var(--font-inter)", flex: 1, lineHeight: 1.3 }}>{label}</span>
                <span style={{ fontSize: 11, color: isSelected ? "rgba(245,158,11,0.7)" : "rgba(255,255,255,0.28)", fontFamily: "var(--font-inter)", flexShrink: 0, fontWeight: isSelected ? 600 : 400 }}>{displayCount > 0 ? displayCount : "0"}</span>
              </button>
            </div>
          );
        })}
      </div>
      {reacted && <div key={reacted} style={{ fontSize: 11, color: "rgba(245,158,11,0.6)", textAlign: "center" as const, marginTop: 10, fontFamily: "var(--font-inter)", animation: "reaction-appear 0.25s ease" }}>noted ✓</div>}
    </div>
  );
}

interface ReplyThreadProps {
  story: StoryType;
  navigate: NavProps["navigate"];
}

function ReplyThread({ story, navigate }: ReplyThreadProps) {
  const replies = MOCK_REPLIES.filter(r => r.storyId === story.id);
  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ height: 1, backgroundColor: "rgba(255,255,255,0.05)", marginBottom: 16 }} />
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 12, fontFamily: "var(--font-inter)", fontWeight: 600 }}>Replies from your circle</div>
      {replies.map(r => (
        <div key={r.id} style={{ display: "flex", gap: 10, marginBottom: 12, padding: "10px 12px", backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 10 }}>
          <div role="button" tabIndex={0} onClick={() => navigate("user-profile", "forward", r.user.id)} onKeyDown={(e) => { if (e.key === "Enter") { navigate("user-profile", "forward", r.user.id); } }} style={{ cursor: "pointer", flexShrink: 0 }}>
            <Avatar userId={r.user.id} color={r.user.color} size={28} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span role="button" tabIndex={0} onClick={() => navigate("user-profile", "forward", r.user.id)} onKeyDown={(e) => { if (e.key === "Enter") { navigate("user-profile", "forward", r.user.id); } }} style={{ fontSize: 12, fontWeight: 600, color: "#fff", fontFamily: "var(--font-inter)", cursor: "pointer" }}>{r.user.name}</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontFamily: "var(--font-inter)" }}>{r.timeAgo}</span>
            </div>
            <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.62)", lineHeight: 1.55, margin: 0, fontFamily: "var(--font-inter)" }}>{r.text}</p>
          </div>
        </div>
      ))}
      {replies.length === 0 && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.22)", fontFamily: "var(--font-inter)", fontStyle: "italic" }}>No replies yet. Be the first to respond.</div>}
    </div>
  );
}

interface ReplyBoxProps {
  story: StoryType;
  reply: string;
  replySent: boolean;
  navigate: NavProps["navigate"];
  onChangeReply: (val: string) => void;
  onSendReply: () => void;
}

function ReplyBox({ story, reply, replySent, navigate, onChangeReply, onSendReply }: ReplyBoxProps) {
  const replyWordCount = reply.trim() === "" ? 0 : reply.trim().split(/\s+/).length;
  const replyReady = replyWordCount >= 50;
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ height: 1, backgroundColor: "rgba(255,255,255,0.05)", marginBottom: 18 }} />
      {replySent ? (
        <div style={{ backgroundColor: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.18)", borderRadius: 12, padding: "14px 16px", textAlign: "center" as const }}>
          <div style={{ fontSize: 13, color: "#34d399", fontWeight: 600, fontFamily: "var(--font-inter)" }}>✓ Reply sent to {story.user.name}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", marginTop: 4, fontFamily: "var(--font-inter)" }}>{"They\u2019ll see it in their Circle feed."}</div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", marginBottom: 9, fontFamily: "var(--font-inter)", letterSpacing: "0.02em" }}>Reply to {story.user.name}</div>
          <textarea value={reply} onChange={(e) => onChangeReply(e.target.value)} placeholder="What came up for you reading this?" style={{ width: "100%", minHeight: 90, backgroundColor: "rgba(255,255,255,0.025)", border: `1px solid ${replyReady ? "rgba(245,158,11,0.28)" : "rgba(255,255,255,0.07)"}`, borderRadius: 12, padding: "12px 14px", outline: "none", resize: "none", color: "rgba(255,255,255,0.82)", fontSize: 13, lineHeight: 1.6, fontFamily: "var(--font-inter)", boxSizing: "border-box" as const, transition: "border-color 0.2s" }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
            <span style={{ fontSize: 11, color: replyReady ? "#f59e0b" : "rgba(255,255,255,0.22)", fontFamily: "var(--font-inter)" }}>{replyReady ? `${replyWordCount} words ✓` : `${replyWordCount} / 50 words`}</span>
            <button onClick={onSendReply} style={{ backgroundColor: replyReady ? "rgba(245,158,11,0.9)" : "rgba(255,255,255,0.06)", border: "none", borderRadius: 8, padding: "7px 18px", color: replyReady ? "#fff" : "rgba(255,255,255,0.25)", fontSize: 12, fontWeight: 600, cursor: replyReady ? "pointer" : "default", fontFamily: "var(--font-inter)", transition: "background-color 0.2s" }}>Send</button>
          </div>
        </>
      )}
      {!story.isDiscovery && story.dayLabel === "Today" && (
        <button onClick={() => navigate("compose", "forward")} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginTop: 12, backgroundColor: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.1)", borderRadius: 12, padding: "10px 14px", cursor: "pointer", boxSizing: "border-box" as const }}>
          <span style={{ fontSize: 12, color: "rgba(245,158,11,0.7)", fontFamily: "var(--font-inter)" }}>Add your voice to today&apos;s prompt →</span>
        </button>
      )}
      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", textAlign: "center" as const, marginTop: 8, marginBottom: 0, fontFamily: "var(--font-inter)" }}>
        {story.isDiscovery ? "Public within Discovery. Never algorithmic." : "Private to your Circle only."}
      </p>
    </div>
  );
}

export default function StoryCardScreen({ navigate, goBack, storyId, navActive: _navActive }: NavProps) {
  const story = STORIES.find((s) => s.id === storyId) ?? STORIES[0];
  const [state, dispatch] = useReducer(storyCardReducer, { reacted: null, isPlaying: false, playProgress: 0, reactionBounce: null, reply: "", replySent: false });
  const { reacted, isPlaying, playProgress, reactionBounce, reply, replySent } = state;
  const playProgressRef = useRef(playProgress);
  playProgressRef.current = playProgress;

  useEffect(() => {
    if (!isPlaying) return;
    const intervalId = setInterval(() => {
      const next = playProgressRef.current + 1;
      if (next >= 100) { dispatch({ type: "STOP_PLAYBACK" }); clearInterval(intervalId); }
      else { dispatch({ type: "SET_PLAY_PROGRESS", value: next }); }
    }, 300);
    return () => clearInterval(intervalId);
  }, [isPlaying]);

  const audioDurationSecs = story.audioDuration ? parseDurationSecs(story.audioDuration) : 180;
  const waveformBars = getWaveform(story.id ?? "");
  const totalResonated = story.reactions.think + story.reactions.changed + story.reactions.felt + story.reactions.door;

  const handleReact = (type: string) => {
    dispatch({ type: "SET_REACTED", value: reacted === type ? null : type });
    dispatch({ type: "SET_REACTION_BOUNCE", value: type });
    setTimeout(() => dispatch({ type: "SET_REACTION_BOUNCE", value: null }), 300);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#0f0c0a", position: "relative" }}>
      <StatusBar />

      <div style={{ flexShrink: 0, padding: "52px 8px 10px", display: "flex", alignItems: "center", backgroundColor: "#0f0c0a", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <button onClick={() => goBack?.()} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", fontSize: 20, padding: "0 12px", cursor: "pointer", lineHeight: 1 }}>←</button>
        <div style={{ flex: 1, textAlign: "center" as const }}><span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-inter)", letterSpacing: "0.02em" }}>{story.user.name}</span></div>
        <div style={{ width: 44 }} />
      </div>

      <div className="inner-scroll" style={{ flex: 1, overflowY: "auto", paddingBottom: 80, paddingLeft: 20, paddingRight: 20 }}>
        {story.mediaType === "photo" && (story.photoUrl || story.photoGradient) && (
          <div style={{ width: "100%", height: 160, borderRadius: 14, marginBottom: 20, marginTop: 18, position: "relative", overflow: "hidden" }}>
            {story.photoUrl ? (
              <><Image src={story.photoUrl} alt="" width={400} height={160} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /><div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 40%, rgba(15,12,10,0.6) 100%)" }} /></>
            ) : (
              <><div style={{ width: "100%", height: "100%", background: `linear-gradient(135deg, ${story.photoGradient![0]} 0%, ${story.photoGradient![1]} 100%)` }} /><div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 25% 35%, rgba(255,255,255,0.07) 0%, transparent 55%)" }} /></>
            )}
            <div style={{ position: "absolute", bottom: 10, right: 12, fontSize: 10, color: "rgba(255,255,255,0.38)", fontFamily: "var(--font-inter)", letterSpacing: "0.04em" }}>◎ photo story</div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: story.mediaType !== "photo" ? 18 : 0, marginBottom: 6 }}>
          <div role="button" tabIndex={0} onClick={() => navigate("user-profile", "forward", story.user.id)} onKeyDown={(e) => { if (e.key === "Enter") { navigate("user-profile", "forward", story.user.id); e.preventDefault(); } }} style={{ cursor: "pointer", flexShrink: 0 }}>
            <Avatar userId={story.user.id} color={story.user.color} size={44} />
          </div>
          <div role="button" tabIndex={0} onClick={() => navigate("user-profile", "forward", story.user.id)} onKeyDown={(e) => { if (e.key === "Enter") { navigate("user-profile", "forward", story.user.id); e.preventDefault(); } }} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", fontFamily: "var(--font-dm-sans)" }}>{story.user.name}</span>
              {story.user.verified && <span style={{ fontSize: 11, color: "#34d399", fontWeight: 700 }}>✓</span>}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", marginTop: 2, fontFamily: "var(--font-inter)" }}>{story.timeAgo} · {story.user.campus ?? "USC IYA"}</div>
          </div>
          {totalResonated > 0 && (
            <div style={{ textAlign: "right" as const, flexShrink: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "rgba(245,158,11,0.65)", fontFamily: "var(--font-dm-sans)" }}>{totalResonated}</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", fontFamily: "var(--font-inter)", marginTop: 1, letterSpacing: "0.03em" }}>resonated</div>
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16, marginTop: 10 }}>
          {!story.isDiscovery && (
            <div role="button" tabIndex={0} onClick={() => navigate("prompt", "back")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { navigate("prompt", "back"); e.preventDefault(); } }} style={{ display: "inline-block", backgroundColor: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)", color: "rgba(245,158,11,0.55)", fontSize: 11, padding: "4px 10px", borderRadius: 999, cursor: "pointer", fontFamily: "var(--font-inter)" }}>
              ← today&apos;s prompt
            </div>
          )}
          {story.isDiscovery && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, backgroundColor: "rgba(52,211,153,0.05)", border: "1px solid rgba(52,211,153,0.12)", borderRadius: 999, padding: "4px 10px" }}>
              <span style={{ fontSize: 11, color: "#34d399", fontFamily: "var(--font-inter)", fontWeight: 600, letterSpacing: "0.05em" }}>DISCOVERY</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", fontFamily: "var(--font-inter)" }}>{story.user.campus}</span>
            </div>
          )}
        </div>

        {story.promptText && (
          <div style={{ backgroundColor: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.09)", borderRadius: 10, padding: "10px 12px", marginBottom: 20 }}>
            <div style={{ fontSize: 10, color: "rgba(245,158,11,0.5)", marginBottom: 5, fontFamily: "var(--font-inter)", fontWeight: 600 }}>In response to</div>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.48)", lineHeight: 1.55, margin: 0, fontStyle: "italic", fontFamily: "var(--font-inter)" }}>{story.promptText}</p>
          </div>
        )}

        {story.mediaType === "audio" && story.audioDuration && (
          <AudioPlayer story={story} isPlaying={isPlaying} playProgress={playProgress} waveformBars={waveformBars} audioDurationSecs={audioDurationSecs} onTogglePlay={() => { if (isPlaying) { dispatch({ type: "STOP_PLAYBACK" }); } else { dispatch({ type: "SET_IS_PLAYING", value: true }); } }} />
        )}

        <div style={{ height: 1, backgroundColor: "rgba(255,255,255,0.05)", marginBottom: 22 }} />

        <div>
          {story.body.split("\n\n").map((paragraph, paraNum) => (
            <p key={`paragraph-${paragraph.slice(0, 24).replace(/\s+/g, "-")}-${paraNum}`} style={{ fontSize: 16, lineHeight: 1.9, color: "rgba(255,255,255,0.85)", fontFamily: "var(--font-inter)", marginBottom: 20, marginTop: 0 }}>
              {paragraph}
            </p>
          ))}
        </div>

        <ReactionPanel story={story} reacted={reacted} reactionBounce={reactionBounce} onReact={handleReact} />

        <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
          <button onClick={() => {/* no-op for demo */}} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "rgba(255,255,255,0.18)", fontFamily: "var(--font-inter)", padding: "4px 8px" }}>Report story</button>
        </div>

        {!story.isDiscovery && <ReplyThread story={story} navigate={navigate} />}

        {story.id === "caleb-today" && (
          <div style={{ marginTop: 20 }}>
            <div style={{ height: 1, backgroundColor: "rgba(255,255,255,0.05)", marginBottom: 14 }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex" }}>
                {["marcus", "priya", "elena"].map((uid, memberPos) => (
                  <div key={uid} role="button" tabIndex={0} onClick={() => navigate("user-profile", "forward", uid)} onKeyDown={(e) => { if (e.key === "Enter") { navigate("user-profile", "forward", uid); } }} style={{ marginLeft: memberPos === 0 ? 0 : -5, zIndex: 3 - memberPos, position: "relative", cursor: "pointer" }}>
                    <Avatar userId={uid} color={USERS[uid]?.color ?? "#888"} size={18} border="1px solid #0f0c0a" />
                  </div>
                ))}
              </div>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", fontFamily: "var(--font-inter)" }}>Seen by Marcus, Priya, and 3 others</span>
            </div>
          </div>
        )}

        <ReplyBox story={story} reply={reply} replySent={replySent} navigate={navigate} onChangeReply={(val) => dispatch({ type: "SET_REPLY", value: val })} onSendReply={() => { if (reply.trim().split(/\s+/).length >= 50) dispatch({ type: "SET_REPLY_SENT" }); }} />
      </div>
    </div>
  );
}
