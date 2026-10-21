"use client";

import { useState, useEffect } from 'react';
import { demoData } from '../shared/demoData';
import type { Tab } from '../shared/types';

// ── Metric color helper ────────────────────────────────────────────────────────
function metricColor(v: number): string {
  if (v >= 85) return '#16A34A';
  if (v >= 75) return '#2563EB';
  return '#D97706';
}

interface HomeScreenProps {
  onNavigate: (tab: Tab) => void;
  onViewProgress?: () => void;
  onSelectSession?: (id: string) => void;
  onStartSession?: () => void;
  onViewSessions?: () => void;
}

// ─── Waveform decoration ──────────────────────────────────────────────────────
function WaveformDecoration() {
  return (
    <>
      <style>{`
        @keyframes waveformDeco {
          0%, 100% { opacity: 0.12; }
          50% { opacity: 0.22; }
        }
      `}</style>
      <svg
        width="100"
        height="36"
        viewBox="0 0 100 36"
        fill="none"
        style={{ opacity: 0.18, animation: 'waveformDeco 3s ease-in-out infinite' }}
      >
        <rect x="0"  y="14" width="5" height="8"  rx="2.5" fill="white" />
        <rect x="9"  y="8"  width="5" height="20" rx="2.5" fill="white" />
        <rect x="18" y="2"  width="5" height="32" rx="2.5" fill="white" />
        <rect x="27" y="6"  width="5" height="24" rx="2.5" fill="white" />
        <rect x="36" y="12" width="5" height="12" rx="2.5" fill="white" />
        <rect x="45" y="4"  width="5" height="28" rx="2.5" fill="white" />
        <rect x="54" y="10" width="5" height="16" rx="2.5" fill="white" />
        <rect x="63" y="1"  width="5" height="34" rx="2.5" fill="white" />
        <rect x="72" y="8"  width="5" height="20" rx="2.5" fill="white" />
        <rect x="81" y="14" width="5" height="8"  rx="2.5" fill="white" />
        <rect x="90" y="6"  width="5" height="24" rx="2.5" fill="white" />
      </svg>
    </>
  );
}

// ─── Circular Progress Ring ───────────────────────────────────────────────────
function CircularRing({ progress, size = 80 }: { progress: number; size?: number }) {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const offset = circumference * (1 - clampedProgress);
  const center = size / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <circle cx={center} cy={center} r={radius} stroke="rgba(255,255,255,0.15)" strokeWidth={8} fill="none" />
      <circle
        cx={center} cy={center} r={radius}
        stroke="white" strokeWidth={8} fill="none"
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round" transform={`rotate(-90 ${center} ${center})`}
      />
      <text
        x={center} y={center + 1}
        textAnchor="middle" dominantBaseline="middle"
        fontSize="15" fontWeight="700" fill="white" fontFamily="system-ui, sans-serif"
      >
        {Math.round(clampedProgress * 100)}%
      </text>
    </svg>
  );
}

// ─── Compact Capture Row ──────────────────────────────────────────────────────
function CaptureRow({
  session,
  onClick,
  isLast,
}: {
  session: typeof demoData.sessions[0];
  onClick: () => void;
  isLast: boolean;
}) {
  const metricsEntries = Object.entries(session.metrics);
  const avgScore = Math.round(metricsEntries.reduce((sum, [, v]) => sum + v, 0) / metricsEntries.length);
  const scoreColor = metricColor(avgScore);
  const leftBorderColor = avgScore >= 85 ? '#16A34A' : avgScore >= 75 ? '#2563EB' : '#D97706';

  return (
    <div
      className="tizzy-tap"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 8,
        borderBottom: isLast ? 'none' : '1px solid #F3F4F6',
        borderLeft: `3px solid ${leftBorderColor}`,
        cursor: 'pointer',
      }}
    >
      <span style={{
        fontSize: 11, fontWeight: 600, color: '#6B7280',
        background: '#F3F4F6', borderRadius: 20, padding: '3px 9px',
        whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        {session.environment}
      </span>
      <span style={{ fontSize: 11, color: '#6B7280', flexShrink: 0 }}>{session.duration} min</span>
      <div style={{ flex: 1 }} />
      <span style={{
        fontSize: 11, fontWeight: 700, color: scoreColor,
        background: `${scoreColor}18`, borderRadius: 20, padding: '2px 8px', flexShrink: 0,
      }}>
        {avgScore}%
      </span>
      <svg width="6" height="10" viewBox="0 0 6 10" fill="none" style={{ flexShrink: 0 }}>
        <path d="M1 1L5 5L1 9" stroke="#E5E7EB" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ─── Today's Goal Card ────────────────────────────────────────────────────────
function TodayGoalCard({
  goal,
  onViewProgress,
  onDismiss,
}: {
  goal: { text: string; description: string; difficulty: string; progress: number };
  onViewProgress?: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onViewProgress?.()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onViewProgress?.(); }}
      style={{
        background: 'linear-gradient(135deg, #1A1A2E 0%, #1E3A8A 55%, #2563EB 100%)',
        borderRadius: '16px', padding: '14px 16px', marginBottom: '14px',
        cursor: 'pointer', boxShadow: '0 4px 16px rgba(30,58,138,0.18)', position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
          Today&apos;s Goal
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#16A34A' }}>
            {goal.progress}% mastered
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            style={{
              background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '50%',
              width: 20, height: 20, cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.6)', padding: 0, fontFamily: 'inherit',
            }}
            aria-label="Dismiss goal card"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M1 1L7 7M7 1L1 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>
      <p style={{ fontSize: 14, fontWeight: 600, color: '#FFFFFF', margin: '0 0 8px 0', lineHeight: 1.3 }}>
        {goal.text}
      </p>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${goal.progress}%`, height: '100%', background: '#16A34A', borderRadius: 2 }} />
      </div>
    </div>
  );
}

// ─── Home Screen ──────────────────────────────────────────────────────────────
export default function HomeScreen({ onNavigate, onViewProgress, onSelectSession, onStartSession, onViewSessions }: HomeScreenProps) {
  const { user, device, sessions, weeklyStats } = demoData;

  const [clockTime, setClockTime] = useState('');
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClockTime(
        now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
          .replace(' AM', '').replace(' PM', '')
      );
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  const [startPressed, setStartPressed] = useState(false);
  const [goalDismissed, setGoalDismissed] = useState(false);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const TODAY_DATE = demoData.sessions[0]?.date.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  const todaySessions = sessions.filter(s => s.date.startsWith(TODAY_DATE));

  const sessionsThisWeek = weeklyStats.sessionsThisWeek;
  const weeklyGoal = weeklyStats.weeklyGoal;
  const ringProgress = Math.min(1, sessionsThisWeek / weeklyGoal);

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: '#F8F9FB',
      fontFamily: 'var(--font-dm-sans), var(--font-inter), system-ui, sans-serif',
      overflow: 'hidden',
    }}>

      {/* ── Status Bar ─────────────────────────────────────────────────────────── */}
      <div style={{
        height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingLeft: 20, paddingRight: 20, flexShrink: 0, background: '#F8F9FB',
      }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#0F1117', letterSpacing: '-0.2px' }}>
          {clockTime}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="17" height="12" viewBox="0 0 17 12" fill="none" style={{ opacity: 0.85 }}>
            <rect x="0"    y="8" width="3" height="4"  rx="1" fill="#0F1117" />
            <rect x="4.5"  y="5" width="3" height="7"  rx="1" fill="#0F1117" />
            <rect x="9"    y="2" width="3" height="10" rx="1" fill="#0F1117" />
            <rect x="13.5" y="0" width="3" height="12" rx="1" fill="#0F1117" />
          </svg>
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none" style={{ opacity: 0.85 }}>
            <path d="M8 9.5 L8 9.5" stroke="#0F1117" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M5.5 7.2 Q8 5.2 10.5 7.2" stroke="#0F1117" strokeWidth="1.8" strokeLinecap="round" fill="none" />
            <path d="M3 4.8 Q8 1 13 4.8" stroke="#0F1117" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </svg>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#0F1117' }}>{device.battery}%</span>
          <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
            <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="#0F1117" strokeWidth="1" />
            <rect x="2"   y="2"   width={`${(device.battery / 100) * 17}`} height="8" rx="2" fill="#0F1117" />
            <path d="M22.5 4 L22.5 8" stroke="#0F1117" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* ── Scrollable Content ─────────────────────────────────────────────────── */}
      <div style={{
        flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        paddingLeft: '18px', paddingRight: '18px', paddingBottom: '84px',
        scrollbarWidth: 'none',
      }}>

        {/* ── Hero ──────────────────────────────────────────────────────────────── */}
        <div style={{ paddingTop: '16px', marginBottom: '18px' }}>
          <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '0 0 3px 0', fontWeight: 400 }}>
            {greeting}, {user.name}
          </p>
          <div style={{ marginBottom: '8px' }}>
            <span style={{ fontSize: '22px', fontWeight: 800, color: '#0F1117', letterSpacing: '-0.03em', lineHeight: 1.2 }}>
              Tizzy is recording
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <style>{`
              @keyframes pendantPulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.35; transform: scale(0.8); }
              }
            `}</style>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: '#DCFCE7', color: '#15803D',
              fontSize: 11, fontWeight: 600, borderRadius: 20, padding: '3px 10px',
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%', background: '#16A34A',
                animation: 'pendantPulse 2s ease-in-out infinite', flexShrink: 0,
              }} />
              Pendant active · capturing
            </span>
            <span style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 500 }}>{todayLabel}</span>
          </div>
        </div>

        {/* ── Today's Captures ──────────────────────────────────────────────────── */}
        <div style={{
          background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '16px',
          padding: '14px 16px', marginBottom: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 2 }}>
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#0F1117', letterSpacing: '-0.01em' }}>
              Today&apos;s Captures
            </span>
            <span style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 500 }}>
              {todaySessions.length} conversation{todaySessions.length !== 1 ? 's' : ''}
            </span>
          </div>
          <p style={{ fontSize: '9px', color: '#D1D5DB', margin: '0 0 10px 0', fontWeight: 500 }}>
            Auto-detected from your pendant
          </p>

          {todaySessions.length === 0 ? (
            <div style={{ paddingTop: 14, paddingBottom: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <rect x="9" y="2" width="6" height="12" rx="3" stroke="#9CA3AF" strokeWidth="2" />
                  <path d="M5 10C5 14.418 8.134 18 12 18C15.866 18 19 14.418 19 10" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <p style={{ fontSize: 12, color: '#9CA3AF', margin: 0, textAlign: 'center' }}>
                No captures yet today. Wear your pendant and start talking.
              </p>
            </div>
          ) : (
            todaySessions.map((session, i) => (
              <CaptureRow
                key={session.id}
                session={session}
                isLast={i === todaySessions.length - 1}
                onClick={() => onSelectSession ? onSelectSession(session.id) : onNavigate('sessions')}
              />
            ))
          )}

          <div style={{ marginTop: 10, borderTop: '1px solid #F3F4F6', paddingTop: 10 }}>
            <button
              onClick={() => onViewSessions ? onViewSessions() : onNavigate('sessions')}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontSize: '12px', color: '#2563EB', fontWeight: 600, fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              View all captures
              <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
                <path d="M1 1L6 6L1 11" stroke="#2563EB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Weekly Dashboard ───────────────────────────────────────────────────── */}
        <div style={{
          borderRadius: '20px', padding: '18px 18px 16px', marginBottom: '14px',
          position: 'relative', overflow: 'hidden',
          background: 'linear-gradient(135deg, #1A1A2E 0%, #1E3A8A 55%, #2563EB 100%)',
          boxShadow: '0 8px 32px rgba(15,23,42,0.30), 0 2px 8px rgba(0,0,0,0.10)',
          height: '170px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        }}>
          <div style={{ position: 'absolute', right: 10, bottom: 8, pointerEvents: 'none' }}>
            <WaveformDecoration />
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', position: 'relative' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '1px', textTransform: 'uppercase' }}>
                This Week
              </span>
              <span style={{ fontSize: 52, fontWeight: 800, color: '#FFFFFF', lineHeight: 1, letterSpacing: '-0.04em' }}>
                {sessionsThisWeek}
              </span>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: 500, marginTop: 1 }}>
                of {weeklyGoal} conversations
              </span>
              <div style={{ width: 120, height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
                <div style={{ height: '100%', width: `${ringProgress * 100}%`, background: '#FFFFFF', borderRadius: 2 }} />
              </div>
            </div>
            <div style={{ flexShrink: 0, marginTop: 2 }}>
              <CircularRing progress={ringProgress} size={80} />
            </div>
          </div>

          <button
            onClick={() => onStartSession ? onStartSession() : onNavigate('sessions')}
            onMouseDown={() => setStartPressed(true)}
            onMouseUp={() => setStartPressed(false)}
            onMouseLeave={() => setStartPressed(false)}
            onTouchStart={() => setStartPressed(true)}
            onTouchEnd={() => setStartPressed(false)}
            style={{
              alignSelf: 'flex-start',
              background: startPressed ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.18)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.25)', borderRadius: 12,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', position: 'relative', transition: 'background 0.1s ease',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#FFFFFF', fontFamily: 'inherit', lineHeight: 1.2 }}>
                Start Coaching Session
              </span>
              <span style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.55)', fontFamily: 'inherit' }}>
                Practice with live haptic feedback
              </span>
            </div>
            <svg width="7" height="12" viewBox="0 0 7 12" fill="none" style={{ flexShrink: 0 }}>
              <path d="M1 1L6 6L1 11" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* ── Today's Goal ──────────────────────────────────────────────────────── */}
        {sessions[0]?.insights?.microGoal && !goalDismissed && (
          <TodayGoalCard
            goal={sessions[0].insights.microGoal}
            onViewProgress={onViewProgress}
            onDismiss={() => setGoalDismissed(true)}
          />
        )}

      </div>
    </div>
  );
}
