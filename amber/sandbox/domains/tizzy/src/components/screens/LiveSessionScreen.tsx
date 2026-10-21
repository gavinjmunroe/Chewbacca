"use client";

import { useReducer, useEffect, useRef } from 'react';
import { demoData } from '../shared/demoData';

interface LiveSessionScreenProps {
  onEnd: (result: { duration: number; env: string; metrics: { speechClarity: number; paceConsistency: number; vocalVariety: number; turnTaking: number } }) => void;
}

const ENVIRONMENTS = ['Study Group', 'Dining Hall', 'Team Meeting', 'Class', 'Phone Call', 'Social Event'];

const HINTS = [
  { dots: '·',   text: 'Try pausing 1 to 2 seconds before responding' },
  { dots: '··',  text: 'Great energy. Vary your pitch to emphasize key points' },
  { dots: '···', text: "You're speaking quickly. Slow down slightly." },
  { dots: '·',   text: 'Nice turn-taking. Keep listening actively' },
  { dots: '··',  text: 'Speak up a bit. Project your voice more.' },
  { dots: '···', text: "Avoid filler words. Pause instead of saying 'um'." },
];

const HAPTIC_KEY_ITEMS = [
  { dots: '·',   text: 'One tap: pause and breathe.' },
  { dots: '··',  text: 'Two taps: slow down 10%.' },
  { dots: '···', text: 'Three taps: great response timing.' },
];

const WAVEFORM_BARS = ['wb-0', 'wb-1', 'wb-2', 'wb-3', 'wb-4', 'wb-5', 'wb-6'] as const;

const METRIC_LABELS: Record<string, string> = {
  speechClarity:   'Vocal Clarity',
  paceConsistency: 'Speaking Pace',
  vocalVariety:    'Vocal Range',
  turnTaking:      'Conversational Flow',
};

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val));
}

function metricColorByKey(_key: string): string {
  return '#2563EB';
}

// Compute initial metrics from last 5 sessions so they reflect real data
const last5 = demoData.sessions.slice(0, 5);
const initialMetrics = {
  speechClarity:   Math.round(last5.reduce((s, sess) => s + sess.metrics.speechClarity,   0) / last5.length),
  paceConsistency: Math.round(last5.reduce((s, sess) => s + sess.metrics.paceConsistency, 0) / last5.length),
  vocalVariety:    Math.round(last5.reduce((s, sess) => s + sess.metrics.vocalVariety,    0) / last5.length),
  turnTaking:      Math.round(last5.reduce((s, sess) => s + sess.metrics.turnTaking,      0) / last5.length),
};

// ─── LiveSessionScreen reducer ────────────────────────────────────────────────

interface LiveSessionState {
  elapsed: number;
  time: string;
  selectedEnv: string;
  metrics: typeof initialMetrics;
  currentHintIndex: number;
  showHint: boolean;
  hintVisible: boolean;
  showEndConfirm: boolean;
  hintDismissed: boolean;
}

type LiveSessionAction =
  | { type: 'TICK' }
  | { type: 'SET_TIME'; time: string }
  | { type: 'SET_ENV'; env: string }
  | { type: 'UPDATE_METRICS' }
  | { type: 'SHOW_HINT' }
  | { type: 'NEXT_HINT'; total: number }
  | { type: 'HINT_VISIBLE'; visible: boolean }
  | { type: 'SHOW_END_CONFIRM'; value: boolean }
  | { type: 'DISMISS_HINT' };

function liveSessionReducer(state: LiveSessionState, action: LiveSessionAction): LiveSessionState {
  switch (action.type) {
    case 'TICK':         return { ...state, elapsed: state.elapsed + 1 };
    case 'SET_TIME':     return { ...state, time: action.time };
    case 'SET_ENV':      return { ...state, selectedEnv: action.env };
    case 'UPDATE_METRICS': return {
      ...state,
      metrics: {
        speechClarity:   clamp(state.metrics.speechClarity   + (Math.random() > 0.5 ? 1 : -1), 60, 100),
        paceConsistency: clamp(state.metrics.paceConsistency + (Math.random() > 0.5 ? 1 : -1), 60, 100),
        vocalVariety:    clamp(state.metrics.vocalVariety    + (Math.random() > 0.5 ? 1 : -1), 60, 100),
        turnTaking:      clamp(state.metrics.turnTaking      + (Math.random() > 0.5 ? 1 : -1), 60, 100),
      },
    };
    case 'SHOW_HINT':    return { ...state, showHint: true };
    case 'NEXT_HINT':    return { ...state, currentHintIndex: (state.currentHintIndex + 1) % action.total };
    case 'HINT_VISIBLE': return { ...state, hintVisible: action.visible };
    case 'SHOW_END_CONFIRM': return { ...state, showEndConfirm: action.value };
    case 'DISMISS_HINT': return { ...state, hintDismissed: true };
    default:             return state;
  }
}

const INITIAL_LIVE_STATE: LiveSessionState = {
  elapsed: 0,
  time: '',
  selectedEnv: 'Study Group',
  metrics: initialMetrics,
  currentHintIndex: 0,
  showHint: false,
  hintVisible: true,
  showEndConfirm: false,
  hintDismissed: false,
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function LiveStatusBar({ time }: { time: string }) {
  return (
    <div style={{
      height: 56,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: 20,
      paddingRight: 20,
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.75)', letterSpacing: '-0.2px' }}>
        {time}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
          <rect x="0"    y="8" width="3" height="4"  rx="1" fill="white" opacity="0.6" />
          <rect x="4.5"  y="5" width="3" height="7"  rx="1" fill="white" opacity="0.6" />
          <rect x="9"    y="2" width="3" height="10" rx="1" fill="white" opacity="0.6" />
          <rect x="13.5" y="0" width="3" height="12" rx="1" fill="white" opacity="0.6" />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="white" strokeWidth="1" opacity="0.5" />
          <rect x="2" y="2" width="16" height="8" rx="2" fill="white" opacity="0.6" />
          <path d="M22.5 4 L22.5 8" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        </svg>
      </div>
    </div>
  );
}

function LiveHeader({ timeStr, onEndClick }: { timeStr: string; onEndClick: () => void }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: 20,
      paddingRight: 20,
      paddingBottom: 14,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#2563EB',
            flexShrink: 0,
            animation: 'coachingPulse 1.4s ease-in-out infinite',
          }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#2563EB', letterSpacing: '0.05em' }}>
            COACHING LIVE
          </span>
        </div>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.02em' }}>
          Coaching Session
        </span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>
          Live haptic feedback active
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.55)', fontVariantNumeric: 'tabular-nums' }}>
          {timeStr}
        </span>
        <button
          onClick={onEndClick}
          style={{
            background: 'rgba(37,99,235,0.14)',
            border: '1px solid rgba(37,99,235,0.28)',
            borderRadius: 20,
            paddingLeft: 16,
            paddingRight: 16,
            paddingTop: 7,
            paddingBottom: 7,
            color: '#93C5FD',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          End
        </button>
      </div>
    </div>
  );
}

function EnvironmentSelector({ selectedEnv, onSelect }: { selectedEnv: string; onSelect: (env: string) => void }) {
  return (
    <div style={{
      display: 'flex',
      gap: 7,
      paddingLeft: 18,
      paddingRight: 18,
      marginBottom: 22,
      overflowX: 'auto',
      WebkitOverflowScrolling: 'touch',
      scrollbarWidth: 'none',
    }}>
      {ENVIRONMENTS.map(env => (
        <button
          key={env}
          onClick={() => onSelect(env)}
          style={{
            flexShrink: 0,
            padding: '5px 13px',
            borderRadius: 20,
            border: selectedEnv === env ? 'none' : '1px solid rgba(255,255,255,0.13)',
            background: selectedEnv === env ? '#2563EB' : 'rgba(255,255,255,0.05)',
            color: selectedEnv === env ? '#FFFFFF' : 'rgba(255,255,255,0.45)',
            fontSize: 12,
            fontWeight: selectedEnv === env ? 700 : 400,
            cursor: 'pointer',
            fontFamily: 'inherit',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 120,
          }}
        >
          {env}
        </button>
      ))}
    </div>
  );
}

function LiveWaveform() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      height: 72,
      gap: 5,
      paddingLeft: 24,
      paddingRight: 24,
      marginBottom: 26,
    }}>
      {WAVEFORM_BARS.map((barId, barIdx) => (
        <div
          key={barId}
          style={{
            width: 7,
            height: 64,
            borderRadius: 4,
            background: `linear-gradient(180deg, rgba(37,99,235,0.6) 0%, #2563EB 100%)`,
            opacity: 0.88,
            animation: `liveBar ${0.8 + (barIdx % 3) * 0.15}s ease-in-out ${barIdx * 0.1}s infinite alternate`,
            transformOrigin: 'bottom',
          }}
        />
      ))}
    </div>
  );
}

function LiveMetricsCard({ metrics }: { metrics: typeof initialMetrics }) {
  return (
    <div style={{
      marginLeft: 18,
      marginRight: 18,
      background: 'rgba(255,255,255,0.04)',
      borderRadius: 16,
      border: '1px solid rgba(255,255,255,0.07)',
      padding: '14px 16px',
      marginBottom: 14,
    }}>
      <p style={{
        fontSize: 10,
        fontWeight: 700,
        color: 'rgba(255,255,255,0.35)',
        textTransform: 'uppercase',
        letterSpacing: '0.9px',
        margin: '0 0 12px 0',
        display: 'flex',
        alignItems: 'center',
      }}>
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#2563EB',
            marginRight: 6,
            animation: 'coachingPulse 1.4s ease-in-out infinite',
          }}
        />
        Live Metrics
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 18px' }}>
        {(Object.entries(metrics) as [keyof typeof metrics, number][]).map(([key, val]) => {
          const scoreColor = metricColorByKey(key);
          return (
            <div key={key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>
                  {METRIC_LABELS[key]}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor }}>
                  {Math.round(val)}%
                </span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.round(val)}%`,
                  background: '#2563EB',
                  borderRadius: 2,
                  transition: 'width 0.9s ease',
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HapticKeyCard() {
  return (
    <div style={{
      marginLeft: 18,
      marginRight: 18,
      background: 'rgba(37,99,235,0.07)',
      borderRadius: 14,
      border: '1px solid rgba(37,99,235,0.18)',
      padding: '12px 14px',
      marginBottom: 14,
    }}>
      <p style={{
        fontSize: 10,
        fontWeight: 700,
        color: 'rgba(255,255,255,0.35)',
        textTransform: 'uppercase',
        letterSpacing: '0.9px',
        margin: '0 0 8px 0',
      }}>
        Haptic Key
      </p>
      {HAPTIC_KEY_ITEMS.map(({ dots, text }) => (
        <div key={dots} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{
            fontFamily: 'monospace',
            fontSize: 14,
            fontWeight: 700,
            color: '#93C5FD',
            letterSpacing: 2,
            minWidth: 28,
          }}>
            {dots}
          </span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.4 }}>
            {text}
          </span>
        </div>
      ))}
    </div>
  );
}

function HapticHintCard({
  hint,
  hintVisible,
  onDismiss,
}: {
  hint: typeof HINTS[0];
  hintVisible: boolean;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{
        marginLeft: 18,
        marginRight: 18,
        background: 'rgba(37,99,235,0.12)',
        borderRadius: 14,
        border: '1px solid rgba(37,99,235,0.25)',
        padding: '11px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 14,
        opacity: hintVisible ? 1 : 0,
        transition: 'opacity 0.25s ease',
        position: 'relative',
      }}
    >
      <button
        onClick={onDismiss}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'rgba(255,255,255,0.4)',
          fontSize: 14,
          padding: 4,
          lineHeight: 1,
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
      </button>
      <div style={{
        width: 34,
        height: 34,
        borderRadius: 10,
        background: 'rgba(37,99,235,0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: 14,
        fontFamily: 'monospace',
        color: '#93C5FD',
        fontWeight: 700,
        letterSpacing: 2,
      }}>
        {hint.dots}
      </div>
      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#93C5FD', margin: '0 0 2px 0', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
          Haptic Coach
        </p>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: 0 }}>
          {hint.text}
        </p>
      </div>
    </div>
  );
}

function PendantStatusCard({ battery }: { battery: number }) {
  return (
    <div style={{
      marginLeft: 18,
      marginRight: 18,
      background: 'rgba(22,163,74,0.07)',
      borderRadius: 12,
      border: '1px solid rgba(22,163,74,0.18)',
      padding: '9px 14px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 24,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A', flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>
          Pendant Active · {battery}%
        </span>
      </div>
      <span style={{ fontSize: 12, color: '#16A34A', fontWeight: 600 }}>
        Active
      </span>
    </div>
  );
}

function EndConfirmOverlay({
  timeStr,
  elapsed,
  onKeepGoing,
  onSaveAndEnd,
}: {
  timeStr: string;
  elapsed: number;
  onKeepGoing: () => void;
  onSaveAndEnd: () => void;
}) {
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      background: 'rgba(0,0,0,0.72)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      zIndex: 50,
    }}>
      <div style={{
        background: '#1A2438',
        borderRadius: 22,
        padding: '26px 22px',
        width: '100%',
        border: '1px solid rgba(255,255,255,0.09)',
      }}>
        <h3 style={{
          fontSize: 19,
          fontWeight: 700,
          color: '#FFFFFF',
          margin: '0 0 6px 0',
          textAlign: 'center',
          letterSpacing: '-0.02em',
        }}>
          End Coaching Session?
        </h3>
        <p style={{
          fontSize: 13,
          color: 'rgba(255,255,255,0.45)',
          textAlign: 'center',
          margin: '0 0 22px 0',
          lineHeight: 1.5,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {timeStr} recorded · Your insights will be ready instantly.
          {elapsed < 10 && (
            <span style={{ display: 'block', color: '#D97706', fontSize: 12, marginTop: 4 }}>
              Very short session. Metrics may be limited.
            </span>
          )}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onKeepGoing}
            style={{
              flex: 1,
              height: 48,
              borderRadius: 14,
              background: '#2563EB',
              border: 'none',
              color: '#FFFFFF',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Keep going
          </button>
          <button
            onClick={onSaveAndEnd}
            style={{
              flex: 1,
              height: 48,
              borderRadius: 14,
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.65)',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Save &amp; End
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function LiveSessionScreen({ onEnd }: LiveSessionScreenProps) {
  const [liveState, dispatch] = useReducer(liveSessionReducer, INITIAL_LIVE_STATE);
  const { elapsed, time, selectedEnv, metrics, currentHintIndex, showHint, hintVisible, showEndConfirm, hintDismissed } = liveState;

  const shuffledHints = useRef([...HINTS].sort(() => Math.random() - 0.5));

  // Session timer
  useEffect(() => {
    const id = setInterval(() => dispatch({ type: 'TICK' }), 1000);
    return () => clearInterval(id);
  }, []);

  // Wall clock
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      dispatch({
        type: 'SET_TIME',
        time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
          .replace(' AM', '')
          .replace(' PM', ''),
      });
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  // Show first hint after 3s
  useEffect(() => {
    const id = setTimeout(() => dispatch({ type: 'SHOW_HINT' }), 3000);
    return () => clearTimeout(id);
  }, []);

  // Rotate hints every 9s with cross-fade
  useEffect(() => {
    if (!showHint) return;
    const id = setInterval(() => {
      dispatch({ type: 'HINT_VISIBLE', visible: false });
      setTimeout(() => {
        dispatch({ type: 'NEXT_HINT', total: shuffledHints.current.length });
        dispatch({ type: 'HINT_VISIBLE', visible: true });
      }, 250);
    }, 9000);
    return () => clearInterval(id);
  }, [showHint]);

  // Metrics simulation
  useEffect(() => {
    const id = setInterval(() => dispatch({ type: 'UPDATE_METRICS' }), 3000);
    return () => clearInterval(id);
  }, []);

  const mins    = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const secs    = String(elapsed % 60).padStart(2, '0');
  const timeStr = `${mins}:${secs}`;

  const hint = shuffledHints.current[currentHintIndex];

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#0B1120',
      fontFamily: 'var(--font-dm-sans), var(--font-inter), system-ui, sans-serif',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <style>{`
        @keyframes liveBar {
          from { transform: scaleY(0.22); }
          to   { transform: scaleY(1); }
        }
        @keyframes hintIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        @keyframes coachingPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.45; transform: scale(0.85); }
        }
      `}</style>

      <LiveStatusBar time={time} />
      <LiveHeader
        timeStr={timeStr}
        onEndClick={() => dispatch({ type: 'SHOW_END_CONFIRM', value: true })}
      />

      <div style={{
        flex: 1,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
      }}>
        <EnvironmentSelector
          selectedEnv={selectedEnv}
          onSelect={(env) => dispatch({ type: 'SET_ENV', env })}
        />
        <LiveWaveform />
        <LiveMetricsCard metrics={metrics} />
        <HapticKeyCard />

        {showHint && !hintDismissed && (
          <HapticHintCard
            hint={hint}
            hintVisible={hintVisible}
            onDismiss={() => dispatch({ type: 'DISMISS_HINT' })}
          />
        )}

        <PendantStatusCard battery={demoData.device.battery} />
      </div>

      {showEndConfirm && (
        <EndConfirmOverlay
          timeStr={timeStr}
          elapsed={elapsed}
          onKeepGoing={() => dispatch({ type: 'SHOW_END_CONFIRM', value: false })}
          onSaveAndEnd={() => onEnd({ duration: elapsed, env: selectedEnv, metrics })}
        />
      )}
    </div>
  );
}
