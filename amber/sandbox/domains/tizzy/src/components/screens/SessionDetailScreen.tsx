"use client";

import { useState, useEffect } from 'react';
import { demoData, formatDate } from '../shared/demoData';

interface SessionDetailScreenProps {
  sessionId: string;
  onBack: () => void;
  onCoach?: () => void;
}

// Canonical metric config: internal key → display name, hint, color
const METRIC_CONFIG: Record<string, { label: string; hint: string; color: string }> = {
  speechClarity:   { label: 'Vocal Clarity',       hint: 'amplitude + projection', color: '#2563EB' },
  paceConsistency: { label: 'Speaking Pace',        hint: 'wpm variance',           color: '#2563EB' },
  vocalVariety:    { label: 'Vocal Range',          hint: 'pitch variation',        color: '#2563EB' },
  turnTaking:      { label: 'Conversational Flow',  hint: 'pause + rhythm',         color: '#2563EB' },
};

// ISSUE 62: Derive baselines from actual session averages instead of hardcoded values
function computeSessionAvgs(): Record<string, number> {
  const sessions = demoData.sessions;
  return {
    speechClarity:   Math.round(sessions.reduce((s, sess) => s + sess.metrics.speechClarity,   0) / sessions.length),
    paceConsistency: Math.round(sessions.reduce((s, sess) => s + sess.metrics.paceConsistency, 0) / sessions.length),
    vocalVariety:    Math.round(sessions.reduce((s, sess) => s + sess.metrics.vocalVariety,    0) / sessions.length),
    turnTaking:      Math.round(sessions.reduce((s, sess) => s + sess.metrics.turnTaking,       0) / sessions.length),
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DetailHeader({
  session,
  currentIndex,
  totalSessions,
  onBack,
  onShare,
}: {
  session: typeof demoData.sessions[0];
  currentIndex: number;
  totalSessions: number;
  onBack: () => void;
  onShare: () => void;
}) {
  return (
    <div
      style={{
        paddingTop: 48,
        paddingBottom: 10,
        background: '#FFFFFF',
        borderBottom: '1px solid #E5E7EB',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: 16,
        paddingRight: 20,
        flexShrink: 0,
      }}
    >
      <button
        onClick={onBack}
        style={{
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#2563EB',
          fontFamily: 'inherit',
          borderRadius: 8,
          padding: 0,
        }}
      >
        <svg width="10" height="18" viewBox="0 0 10 18" fill="none">
          <path d="M9 1L1 9L9 17" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        <span style={{ fontSize: 17, fontWeight: 600, color: '#0F1117', letterSpacing: '-0.2px' }}>
          {session.environment}
        </span>
        <span style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 500 }}>
          {currentIndex + 1} of {totalSessions}
        </span>
      </div>
      <button
        onClick={onShare}
        style={{
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.04)',
          border: '1px solid rgba(0,0,0,0.08)',
          borderRadius: 8,
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 1v9M4 5l4-4 4 4M2 11v3h12v-3" stroke="rgba(0,0,0,0.45)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}

function SessionTitleBlock({
  session,
  displayDuration,
}: {
  session: typeof demoData.sessions[0];
  displayDuration: string;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h2
        style={{
          fontSize: 22,
          fontWeight: 800,
          color: '#0F1117',
          margin: 0,
          marginBottom: 6,
          letterSpacing: '-0.4px',
        }}
      >
        {session.environment}
      </h2>
      <span
        style={{
          display: 'inline-block',
          background: '#F3F4F6',
          color: '#6B7280',
          fontSize: 11,
          fontWeight: 500,
          borderRadius: 20,
          paddingLeft: 10,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 3,
          marginBottom: 6,
        }}
      >
        Auto-captured
      </span>
      <p style={{ fontSize: 14, color: '#6B7280', margin: 0, fontWeight: 500 }}>
        {formatDate(session.date)} · {displayDuration}
      </p>
    </div>
  );
}

function SessionSummaryCard({ summary }: { summary: string }) {
  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid #E5E7EB',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <p
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#9CA3AF',
          textTransform: 'uppercase',
          letterSpacing: '0.9px',
          margin: 0,
          marginBottom: 8,
        }}
      >
        Session Summary
      </p>
      <p style={{ fontSize: 14, color: '#6B7280', margin: 0, lineHeight: 1.6 }}>
        {summary}
      </p>
    </div>
  );
}

interface MetricBarData {
  key: string;
  label: string;
  hint: string;
  color: string;
  value: number;
  avgValue: number;
  delta: number;
}

function MetricsCard({ metricBars }: { metricBars: MetricBarData[] }) {
  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid #E5E7EB',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <p
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#9CA3AF',
          textTransform: 'uppercase',
          letterSpacing: '0.9px',
          margin: 0,
          marginBottom: 14,
        }}
      >
        Performance Metrics
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {metricBars.map((metric) => (
          <div key={metric.key}>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                marginBottom: 6,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, color: '#0F1117', fontWeight: 600 }}>
                    {metric.label}
                  </span>
                  {metric.delta !== 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: metric.delta > 0 ? '#065F46' : '#92400E',
                        background: metric.delta > 0 ? '#F0FDF4' : '#FFF7ED',
                        paddingLeft: 6,
                        paddingRight: 6,
                        paddingTop: 2,
                        paddingBottom: 2,
                        borderRadius: 20,
                      }}
                    >
                      {metric.delta > 0 ? '+' : ''}{metric.delta}% vs avg
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 400 }}>
                  {metric.hint}
                </span>
              </div>
              <span style={{ fontSize: 15, fontWeight: 700, color: metric.color }}>
                {metric.value}%
              </span>
            </div>
            <div
              style={{
                height: 8,
                background: '#E5E7EB',
                borderRadius: 4,
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: `${metric.value}%`,
                  height: '100%',
                  background: '#2563EB',
                  borderRadius: 4,
                }}
              />
              <div
                title={`Last week: ${metric.avgValue}%`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: `${metric.avgValue}%`,
                  width: 1,
                  height: '100%',
                  background: 'rgba(0,0,0,0.3)',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InsightsCard({ insights }: { insights: typeof demoData.sessions[0]['insights'] }) {
  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid #E5E7EB',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <p style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.9px', margin: '0 0 12px 0' }}>
        Insights
      </p>
      <p style={{ fontSize: 10, fontWeight: 700, color: '#16A34A', textTransform: 'uppercase', letterSpacing: '0.6px', margin: '0 0 6px 0' }}>
        Strengths
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 14 }}>
        {insights.whatWentWell.map((item, idx) => (
          <div
            key={`well-${item.slice(0, 32)}`}
            style={{
              borderLeft: '3px solid #16A34A',
              padding: '6px 10px 6px 12px',
              marginBottom: idx < insights.whatWentWell.length - 1 ? 4 : 0,
              fontSize: 13, color: '#374151', lineHeight: 1.55,
            }}
          >
            {item}
          </div>
        ))}
      </div>
      <p style={{ fontSize: 10, fontWeight: 700, color: '#D97706', textTransform: 'uppercase', letterSpacing: '0.6px', margin: '0 0 6px 0' }}>
        Focus Areas
      </p>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {insights.areasForGrowth.map((item, idx) => (
          <div
            key={`growth-${item.slice(0, 32)}`}
            style={{
              borderLeft: '3px solid #D97706',
              padding: '6px 10px 6px 12px',
              marginBottom: idx < insights.areasForGrowth.length - 1 ? 4 : 0,
              fontSize: 13, color: '#374151', lineHeight: 1.55,
            }}
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function NextGoalCard({ microGoal }: { microGoal: typeof demoData.sessions[0]['insights']['microGoal'] }) {
  return (
    <div
      style={{
        background: '#EFF6FF',
        border: '1px solid #BFDBFE',
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '1.2px',
            color: '#2563EB',
            textTransform: 'uppercase',
          }}
        >
          Your Next Goal
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#065F46',
            background: '#F0FDF4',
            paddingLeft: 8,
            paddingRight: 8,
            paddingTop: 3,
            paddingBottom: 3,
            borderRadius: 20,
            textTransform: 'capitalize',
          }}
        >
          Difficulty: {microGoal.difficulty}
        </span>
      </div>
      <p
        style={{
          fontSize: 10,
          color: '#9CA3AF',
          margin: 0,
          marginBottom: 10,
          fontWeight: 400,
        }}
      >
        Based on this capture
      </p>
      <p
        style={{
          fontSize: 17,
          fontWeight: 700,
          color: '#0F1117',
          margin: 0,
          marginBottom: 8,
          lineHeight: 1.3,
        }}
      >
        {microGoal.text}
      </p>
      <p
        style={{
          fontSize: 13,
          color: '#6B7280',
          margin: 0,
          marginBottom: 16,
          lineHeight: 1.55,
        }}
      >
        {microGoal.description}
      </p>
      <div>
        <div
          style={{
            height: 8,
            background: '#E5E7EB',
            borderRadius: 4,
            overflow: 'hidden',
            marginBottom: 6,
          }}
        >
          <div
            style={{
              width: `${microGoal.progress}%`,
              height: '100%',
              background: '#2563EB',
              borderRadius: 4,
            }}
          />
        </div>
        <span style={{ fontSize: 12, color: '#2563EB', fontWeight: 600 }}>
          {microGoal.progress}% mastered
        </span>
      </div>
    </div>
  );
}

function AskCoachCTA({ onCoach }: { onCoach: () => void }) {
  return (
    <button
      onClick={onCoach}
      style={{
        width: '100%',
        height: 50,
        borderRadius: 14,
        background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',
        border: 'none',
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        boxShadow: '0 4px 16px rgba(37,99,235,0.28)',
      }}
    >
      Ask AI Coach about this session
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 7H12M12 7L8.5 3.5M12 7L8.5 10.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

function ShareToast() {
  return (
    <div style={{
      position: 'absolute',
      bottom: 32,
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#0F1117',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 12,
      padding: '10px 18px',
      fontSize: 13,
      fontWeight: 600,
      color: '#FFFFFF',
      zIndex: 100,
      whiteSpace: 'nowrap',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
    }}>
      Copied to clipboard
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SessionDetailScreen({ sessionId, onBack, onCoach }: SessionDetailScreenProps) {
  const [shareToast, setShareToast] = useState(false);

  // ISSUE 65: Scroll to top on mount / sessionId change
  useEffect(() => {
    const el = document.querySelector('[data-session-detail-scroll]');
    if (el) el.scrollTop = 0;
  }, [sessionId]);

  const session = demoData.sessions.find((s) => s.id === sessionId) ?? demoData.sessions[0];
  const { metrics, insights } = session;

  const sessions = demoData.sessions;
  const currentIndex = sessions.findIndex(s => s.id === sessionId);

  const avgMetrics = demoData.weeklyStats.previousWeekMetrics;
  const allSessionAvgs = computeSessionAvgs();

  const METRIC_BARS: MetricBarData[] = [
    { key: 'speechClarity',   value: metrics.speechClarity,   avgValue: avgMetrics.speechClarity },
    { key: 'paceConsistency', value: metrics.paceConsistency, avgValue: avgMetrics.paceConsistency },
    { key: 'vocalVariety',    value: metrics.vocalVariety,    avgValue: avgMetrics.vocalVariety },
    { key: 'turnTaking',      value: metrics.turnTaking,       avgValue: avgMetrics.turnTaking },
  ].map(m => ({
    ...m,
    label: METRIC_CONFIG[m.key].label,
    hint:  METRIC_CONFIG[m.key].hint,
    color: METRIC_CONFIG[m.key].color,
    delta: m.value - allSessionAvgs[m.key],
  }));

  const displayDuration = session.duration < 120
    ? `${session.duration} min`
    : `${Math.round(session.duration / 60)} min`;

  const handleShare = () => {
    const avgScore = Math.round(Object.values(metrics).reduce((a, b) => a + b, 0) / 4);
    const text = `My ${session.environment} capture on ${formatDate(session.date)}: Avg score ${avgScore}%. Best: ${METRIC_CONFIG[Object.entries(metrics).sort(([, a], [, b]) => b - a)[0][0]]?.label ?? ''}.`;
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    setShareToast(true);
    setTimeout(() => setShareToast(false), 2000);
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#F8F9FB',
        fontFamily: 'var(--font-dm-sans), var(--font-inter), system-ui, sans-serif',
        overflow: 'hidden',
      }}
    >
      <DetailHeader
        session={session}
        currentIndex={currentIndex}
        totalSessions={sessions.length}
        onBack={onBack}
        onShare={handleShare}
      />

      <div
        data-session-detail-scroll=""
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
        }}
      >
        <div style={{ padding: 20, paddingBottom: 40 }}>
          <SessionTitleBlock session={session} displayDuration={displayDuration} />
          <SessionSummaryCard summary={session.summary} />
          <MetricsCard metricBars={METRIC_BARS} />
          <InsightsCard insights={insights} />
          <NextGoalCard microGoal={insights.microGoal} />
          <AskCoachCTA onCoach={() => onCoach?.()} />
        </div>
      </div>

      {shareToast && <ShareToast />}
    </div>
  );
}
