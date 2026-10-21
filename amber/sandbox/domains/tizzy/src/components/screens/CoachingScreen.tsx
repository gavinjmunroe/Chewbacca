"use client";

import { useState, useEffect, useRef } from 'react';
import { demoData } from '../shared/demoData';

interface CoachingScreenProps {
  onSelectSession: (id: string) => void;
  onBack?: () => void;
  onStartSession?: () => void;
  onChat?: () => void;
}

// ─── Metric config ──────────────────────────────────────────────────────────

const METRIC_CONFIG = {
  speechClarity: {
    label: 'Vocal Clarity',
    subtitle: 'amplitude + projection',
    color: '#2563EB',
    tagBg: '#EFF6FF',
  },
  paceConsistency: {
    label: 'Speaking Pace',
    subtitle: 'wpm variance',
    color: '#2563EB',
    tagBg: '#EFF6FF',
  },
  vocalVariety: {
    label: 'Vocal Range',
    subtitle: 'pitch variation',
    color: '#2563EB',
    tagBg: '#EFF6FF',
  },
  turnTaking: {
    label: 'Conversational Flow',
    subtitle: 'pause + rhythm',
    color: '#2563EB',
    tagBg: '#EFF6FF',
  },
} as const;

// ─── Shared style constants ──────────────────────────────────────────────────

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#9CA3AF',
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  margin: '0 0 10px 0',
  display: 'block',
  paddingBottom: 8,
  borderBottom: '1px solid #E5E7EB',
};

const CARD: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderRadius: 16,
  padding: 16,
};

// ─── Icon sub-components ────────────────────────────────────────────────────

function FlameIcon() {
  return (
    <svg width="11" height="14" viewBox="0 0 13 17" fill="none" style={{ display: 'inline', marginLeft: 1 }}>
      <path d="M6.5 0.5C6.5 0.5 11 5 11 9C11 11.76 8.98 14 6.5 14C4.02 14 2 11.76 2 9C2 6.5 3.5 5 4.5 3.5C4.3 5.2 5.5 6.2 5.5 6.2C5.5 4 6 2 6.5 0.5Z" fill="#EA580C" />
      <path d="M6.5 9.5C6.5 9.5 8.5 8 8.5 6.5C8.5 7.5 8 8 7.5 8.5C8 8 9 8.5 8.5 10C8 11.5 6.5 11.5 6.5 11.5C5 11.5 4.5 10.5 4.5 9.5C4.5 8.5 5.5 9.5 6.5 9.5Z" fill="#FED7AA" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ display: 'inline', marginRight: 5 }}>
      <path d="M3 1h8v5a4 4 0 0 1-8 0V1Z" stroke="#D97706" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
      <path d="M1 2h2M11 2h2" stroke="#D97706" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M7 10v2M5 12h4" stroke="#D97706" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// ─── CoachingStatusBar ───────────────────────────────────────────────────────

function CoachingStatusBar({ clockTime, batteryPct }: { clockTime: string; batteryPct: number }) {
  return (
    <div style={{
      height: 56,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: 20,
      paddingRight: 20,
      flexShrink: 0,
      background: '#F8F9FB',
    }}>
      <span style={{ fontSize: 15, fontWeight: 600, color: '#111827', letterSpacing: '-0.2px' }}>{clockTime}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
          <rect x="0"    y="8" width="3" height="4"  rx="1" fill="#111827" />
          <rect x="4.5"  y="5" width="3" height="7"  rx="1" fill="#111827" />
          <rect x="9"    y="2" width="3" height="10" rx="1" fill="#111827" />
          <rect x="13.5" y="0" width="3" height="12" rx="1" fill="#111827" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
          <path d="M8 9.5 L8 9.5" stroke="#111827" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M5.5 7.2 Q8 5.2 10.5 7.2" stroke="#111827" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          <path d="M3 4.8 Q8 1 13 4.8" stroke="#111827" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="#111827" strokeWidth="1" />
          <rect x="2"   y="2"   width={`${(batteryPct / 100) * 17}`} height="8"  rx="2"   fill="#111827" />
          <path d="M22.5 4 L22.5 8" stroke="#111827" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

// ─── CoachingHeader ──────────────────────────────────────────────────────────

function CoachingHeader({ weekNum, streak }: { weekNum: number; streak: number }) {
  return (
    <div style={{ paddingTop: '14px', marginBottom: '14px' }}>
      <h1 style={{
        fontSize: '26px',
        fontWeight: 800,
        color: '#0F1117',
        margin: '0 0 4px 0',
        letterSpacing: '-0.03em',
      }}>
        Your Progress
      </h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const }}>
        <p style={{ fontSize: '13px', color: '#6B7280', margin: 0 }}>
          Week {weekNum} · {streak}-day streak <FlameIcon />
        </p>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          background: '#F0FDF4',
          border: '1px solid #BBF7D0',
          borderRadius: 20,
          padding: '3px 10px',
        }}>
          <div style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#16A34A',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#16A34A' }}>Recording</span>
        </div>
      </div>
    </div>
  );
}

// ─── MetricGridItem type ─────────────────────────────────────────────────────

interface MetricGridItem {
  key: string;
  label: string;
  subtitle: string;
  value: number;
  delta: number;
  color: string;
}

// ─── CurrentMetricsGrid ──────────────────────────────────────────────────────

function CurrentMetricsGrid({ metrics }: { metrics: MetricGridItem[] }) {
  return (
    <>
      <span style={SECTION_LABEL}>Current Metrics</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
        {metrics.map((metric) => (
          <div key={metric.key} style={{ ...CARD, padding: '14px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#6B7280', marginBottom: 4, letterSpacing: '-0.01em' }}>
              {metric.label}
            </div>
            <div style={{ fontSize: 9, color: '#9CA3AF', marginBottom: 8, fontStyle: 'italic' }}>
              {metric.subtitle}
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: metric.color, lineHeight: 1, letterSpacing: '-0.03em', marginBottom: 4 }}>
              {metric.value}
            </div>
            {metric.delta !== 0 && (
              <div style={{
                fontSize: 10,
                fontWeight: 700,
                color: metric.delta > 0 ? '#16A34A' : '#D97706',
              }}>
                {metric.delta > 0 ? '+' : ''}{metric.delta} vs last week
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ─── GrowthCard ──────────────────────────────────────────────────────────────

interface GrowthCardProps {
  monthsActive: number;
  improvementPct: number;
  first10Avg: number;
  last10Avg: number;
  totalSessions: number;
  totalHoursStr: string;
  longestStreak: number;
}

function GrowthCard({
  monthsActive, improvementPct, first10Avg, last10Avg,
  totalSessions, totalHoursStr, longestStreak,
}: GrowthCardProps) {
  return (
    <>
      <span style={SECTION_LABEL}>{monthsActive} Months of Growth</span>
      <div style={{
        background: 'linear-gradient(135deg, #1E3A8A, #2563EB)',
        borderRadius: 16,
        padding: 18,
        marginBottom: 20,
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', right: -20, top: -20, width: 100, height: 100,
          borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', right: 20, bottom: -30, width: 80, height: 80,
          borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none',
        }} />
        <div style={{ fontSize: 36, fontWeight: 800, color: '#FFFFFF', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 4 }}>
          +{improvementPct}%
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', marginBottom: 16 }}>
          improvement since you started
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ textAlign: 'center' as const }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#FFFFFF' }}>{first10Avg}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>First avg</div>
          </div>
          <svg width="32" height="14" viewBox="0 0 32 14" fill="none">
            <path d="M0 7H28M24 2L30 7L24 12" stroke="rgba(255,255,255,0.5)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ textAlign: 'center' as const }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#34D399' }}>{last10Avg}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>Current avg</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 12 }}>
          <div style={{ textAlign: 'center' as const, flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#FFFFFF' }}>{totalSessions}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Sessions</div>
          </div>
          <div style={{ width: 1, background: 'rgba(255,255,255,0.15)' }} />
          <div style={{ textAlign: 'center' as const, flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#FFFFFF' }}>{totalHoursStr}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Coached</div>
          </div>
          <div style={{ width: 1, background: 'rgba(255,255,255,0.15)' }} />
          <div style={{ textAlign: 'center' as const, flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#F97316' }}>{longestStreak}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Best streak</div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── ScoreTrendChart ─────────────────────────────────────────────────────────

interface HistoryEntry { avgScore: number; sessions: number; week: string; }

interface ScoreTrendChartProps {
  history: HistoryEntry[];
  CHART_W: number;
  CHART_H: number;
  CHART_PAD_L: number;
  CHART_PAD_R: number;
  CHART_PAD_T: number;
  CHART_PAD_B: number;
  chartX: (i: number) => number;
  chartY: (score: number) => number;
  polylinePoints: string;
  areaPath: string;
  scoreMin: number;
  scoreMax: number;
}

function ScoreTrendChart({
  history, CHART_W, CHART_H, CHART_PAD_L, CHART_PAD_R, CHART_PAD_T, CHART_PAD_B,
  chartX, chartY, polylinePoints, areaPath, scoreMin, scoreMax,
}: ScoreTrendChartProps) {
  return (
    <>
      <span style={SECTION_LABEL}>Score Trend</span>
      <div style={{ ...CARD, marginBottom: 20, padding: '14px 10px 10px 10px' }}>
        <svg
          width={CHART_W}
          height={CHART_H}
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          style={{ display: 'block', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563EB" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#2563EB" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[25, 50, 75, 100].map(score => {
            const y = chartY(score);
            return (
              <g key={score}>
                <line x1={CHART_PAD_L} y1={y} x2={CHART_W - CHART_PAD_R} y2={y} stroke="#E5E7EB" strokeWidth="1" strokeDasharray="3,3" />
                <text x={CHART_PAD_L - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#9CA3AF">{score}</text>
              </g>
            );
          })}
          {areaPath && <path d={areaPath} fill="url(#areaGrad)" />}
          <polyline
            points={polylinePoints}
            fill="none"
            stroke="#2563EB"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {history.map((h, i) => (
            <circle
              key={h.week ?? `history-${i}`}
              cx={chartX(i)}
              cy={chartY(h.avgScore)}
              r="2"
              fill="#2563EB"
            />
          ))}
          {history.length > 0 && (() => {
            const minIdx = history.reduce((best, h, i) => h.avgScore < history[best].avgScore ? i : best, 0);
            const maxIdx = history.reduce((best, h, i) => h.avgScore > history[best].avgScore ? i : best, 0);
            return (
              <>
                <text x={chartX(minIdx)} y={chartY(scoreMin) + 14} textAnchor="middle" fontSize="9" fill="#9CA3AF" fontWeight="600">{scoreMin}</text>
                <text x={chartX(maxIdx)} y={chartY(scoreMax) - 5} textAnchor="middle" fontSize="9" fill="#2563EB" fontWeight="600">{scoreMax}</text>
              </>
            );
          })()}
          <text x={CHART_PAD_L} y={CHART_H - 2} textAnchor="start" fontSize="9" fill="#9CA3AF">Week 1</text>
          <text x={CHART_W - CHART_PAD_R} y={CHART_H - 2} textAnchor="end" fontSize="9" fill="#9CA3AF">Now</text>
        </svg>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, paddingLeft: CHART_PAD_L - 10 }}>
          <div style={{ width: 10, height: 2, background: '#2563EB', borderRadius: 1 }} />
          <span style={{ fontSize: 9, color: '#9CA3AF', fontWeight: 600 }}>Avg Score</span>
        </div>
      </div>
    </>
  );
}

// ─── ActivityHeatmap ─────────────────────────────────────────────────────────

interface HeatCell { sessions: number; week: string; }

interface ActivityHeatmapProps {
  heatGrid: Array<Array<HeatCell | null>>;
  sampledMonths: Array<{ label: string; pos: number }>;
  heatColor: (sessions: number) => string;
  CELL: number;
  CELL_GAP: number;
}

function ActivityHeatmap({ heatGrid, sampledMonths, heatColor, CELL, CELL_GAP }: ActivityHeatmapProps) {
  return (
    <>
      <span style={SECTION_LABEL}>Activity</span>
      <div style={{ ...CARD, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: CELL_GAP, marginBottom: 4 }}>
          {sampledMonths.map(({ label, pos }) => (
            <div key={`month-${pos}`} style={{ width: CELL, fontSize: 8, color: '#9CA3AF', fontWeight: 600, textAlign: 'center' as const, flexShrink: 0 }}>
              {label}
            </div>
          ))}
        </div>
        {heatGrid.map((row, r) => (
          <div key={`row-${r}`} style={{ display: 'flex', gap: CELL_GAP, marginBottom: CELL_GAP }}>
            {row.map((cell, c) => (
              <div
                key={cell ? cell.week : `cell-${r}-${c}`}
                title={cell ? `${cell.week}: ${cell.sessions} sessions` : ''}
                style={{
                  width: CELL,
                  height: CELL,
                  borderRadius: 3,
                  background: cell ? heatColor(cell.sessions) : '#F3F4F6',
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
          <span style={{ fontSize: 9, color: '#9CA3AF', marginRight: 2 }}>Less</span>
          {[0, 1, 2, 4].map(n => (
            <div key={n} style={{ width: 10, height: 10, borderRadius: 2, background: heatColor(n), border: '1px solid rgba(0,0,0,0.06)' }} />
          ))}
          <span style={{ fontSize: 9, color: '#9CA3AF', marginLeft: 2 }}>More</span>
        </div>
      </div>
    </>
  );
}

// ─── AllTimeBests ────────────────────────────────────────────────────────────

interface BestSession { metrics: { speechClarity: number; paceConsistency: number; vocalVariety: number; turnTaking: number }; environment: string; date: string; }

interface AllTimeBestsProps {
  bestVocalClarity: BestSession;
  bestSpeakingPace: BestSession;
  bestVocalRange: BestSession;
  bestConvFlow: BestSession;
  formatDate: (d: string) => string;
}

function AllTimeBests({ bestVocalClarity, bestSpeakingPace, bestVocalRange, bestConvFlow, formatDate }: AllTimeBestsProps) {
  const entries = [
    { label: 'Vocal Clarity',   score: bestVocalClarity.metrics.speechClarity,  env: bestVocalClarity.environment,  date: bestVocalClarity.date,  color: METRIC_CONFIG.speechClarity.color },
    { label: 'Speaking Pace',   score: bestSpeakingPace.metrics.paceConsistency, env: bestSpeakingPace.environment,  date: bestSpeakingPace.date,  color: METRIC_CONFIG.paceConsistency.color },
    { label: 'Vocal Range',     score: bestVocalRange.metrics.vocalVariety,      env: bestVocalRange.environment,    date: bestVocalRange.date,    color: METRIC_CONFIG.vocalVariety.color },
    { label: 'Conv. Flow',      score: bestConvFlow.metrics.turnTaking,          env: bestConvFlow.environment,      date: bestConvFlow.date,      color: METRIC_CONFIG.turnTaking.color },
  ];
  return (
    <>
      <span style={SECTION_LABEL}><TrophyIcon />All-Time Bests</span>
      <div style={{
        display: 'flex', gap: 10, overflowX: 'auto', WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none', marginBottom: 20, paddingBottom: 4,
      }}>
        {entries.map(e => (
          <div key={e.label} style={{ ...CARD, minWidth: 128, maxWidth: 148, flexShrink: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: e.color, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 5 }}>
              {e.label}
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: e.color, lineHeight: 1, letterSpacing: '-0.02em', marginBottom: 4 }}>
              {e.score}%
            </div>
            <div style={{ fontSize: 11, color: '#374151', fontWeight: 600, marginBottom: 2 }}>{e.env}</div>
            <div style={{ fontSize: 10, color: '#9CA3AF' }}>{formatDate(e.date)}</div>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── MetricBreakdown ─────────────────────────────────────────────────────────

interface DeepMetric {
  key: string;
  label: string;
  measureNote: string;
  current: number;
  start: number;
  color: string;
}

interface MetricBreakdownProps {
  deepMetrics: DeepMetric[];
  last6History: HistoryEntry[];
}

function MetricBreakdown({ deepMetrics, last6History }: MetricBreakdownProps) {
  const miniBarMax = Math.max(...last6History.map(h => h.avgScore), 1);
  return (
    <>
      <span style={SECTION_LABEL}>Metric Breakdown</span>
      <div style={{ ...CARD, marginBottom: 20 }}>
        {deepMetrics.map((m, idx) => {
          const delta = m.current - m.start;
          return (
            <div key={m.key} style={{ marginBottom: idx < deepMetrics.length - 1 ? 20 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#0F1117' }}>{m.label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: m.color }}>{m.current}%</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    color: delta >= 0 ? '#16A34A' : '#D97706',
                    background: delta >= 0 ? '#F0FDF4' : '#FFF7ED',
                    borderRadius: 8, padding: '2px 6px',
                  }}>
                    {delta >= 0 ? '+' : ''}{delta} vs start
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 10, color: '#9CA3AF', fontStyle: 'italic', marginBottom: 6 }}>{m.measureNote}</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 28 }}>
                {last6History.map((h, i) => {
                  const barH = Math.max(3, (h.avgScore / miniBarMax) * 26);
                  const isLast = i === last6History.length - 1;
                  return (
                    <div key={h.week ?? `bar-${i}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: 28 }}>
                      <div style={{
                        width: '100%', height: barH,
                        background: isLast ? '#2563EB' : 'rgba(37,99,235,0.25)',
                        borderRadius: '2px 2px 0 0', transition: 'height 0.6s ease',
                      }} />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                <span style={{ fontSize: 8, color: '#9CA3AF' }}>6w ago</span>
                <span style={{ fontSize: 8, color: '#9CA3AF' }}>Now</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── TodaysGoal ──────────────────────────────────────────────────────────────

interface MicroGoal { text: string; description: string; progress: number; }

function TodaysGoal({ microGoal }: { microGoal: MicroGoal }) {
  return (
    <>
      <span style={SECTION_LABEL}>Today&apos;s Goal</span>
      <div style={{
        background: 'linear-gradient(135deg, #0F172A 0%, #1E3A8A 50%, #2563EB 100%)',
        borderRadius: '20px', padding: '18px', marginBottom: '20px',
        boxShadow: '0 6px 24px rgba(30,58,138,0.2)', position: 'relative', overflow: 'hidden',
      }}>
        <svg width="90" height="32" viewBox="0 0 90 32" fill="none"
          style={{ position: 'absolute', right: 10, bottom: 8, opacity: 0.15, pointerEvents: 'none' }}>
          <rect x="0"  y="12" width="5" height="8"  rx="2.5" fill="white" />
          <rect x="9"  y="6"  width="5" height="20" rx="2.5" fill="white" />
          <rect x="18" y="0"  width="5" height="32" rx="2.5" fill="white" />
          <rect x="27" y="5"  width="5" height="22" rx="2.5" fill="white" />
          <rect x="36" y="11" width="5" height="10" rx="2.5" fill="white" />
          <rect x="45" y="3"  width="5" height="26" rx="2.5" fill="white" />
          <rect x="54" y="9"  width="5" height="14" rx="2.5" fill="white" />
          <rect x="63" y="0"  width="5" height="32" rx="2.5" fill="white" />
          <rect x="72" y="7"  width="5" height="18" rx="2.5" fill="white" />
          <rect x="81" y="13" width="5" height="6"  rx="2.5" fill="white" />
        </svg>
        <p style={{ fontSize: 17, fontWeight: 700, color: '#FFFFFF', margin: '0 0 6px 0', lineHeight: 1.3, position: 'relative' }}>
          {microGoal.text}
        </p>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: '0 0 14px 0', lineHeight: 1.5, position: 'relative' }}>
          {microGoal.description}
        </p>
        <div style={{ position: 'relative' }}>
          <div style={{ height: 6, background: 'rgba(255,255,255,0.2)', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ width: `${microGoal.progress}%`, height: '100%', background: '#34D399', borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>
            {microGoal.progress}% mastered
          </span>
        </div>
      </div>
    </>
  );
}

// ─── ThisWeekSection ─────────────────────────────────────────────────────────

interface ThisWeekSectionProps {
  conversations: number;
  coachStr: string;
  currentStreak: number;
  bestSkill: string;
  focusArea: string;
  metrics: MetricGridItem[];
  mounted: boolean;
}

function ThisWeekSection({ conversations, coachStr, currentStreak, bestSkill, focusArea, metrics, mounted }: ThisWeekSectionProps) {
  return (
    <>
      <span style={SECTION_LABEL}>This Week</span>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
        <div style={{ flex: 1, background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '14px', padding: '12px 8px', textAlign: 'center' as const }}>
          <div style={{ fontSize: '26px', fontWeight: 800, color: '#0F1117', lineHeight: 1, marginBottom: '3px', letterSpacing: '-0.03em' }}>{conversations}</div>
          <div style={{ fontSize: '11px', color: '#6B7280', fontWeight: 500 }}>Sessions</div>
        </div>
        <div style={{ flex: 1, background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '14px', padding: '12px 8px', textAlign: 'center' as const }}>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#0F1117', lineHeight: 1, marginBottom: '3px', letterSpacing: '-0.03em' }}>{coachStr}</div>
          <div style={{ fontSize: '11px', color: '#6B7280', fontWeight: 500 }}>Coached</div>
        </div>
        <div style={{ flex: 1, background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '14px', padding: '12px 8px', textAlign: 'center' as const }}>
          <div style={{ fontSize: '26px', fontWeight: 800, color: '#EA580C', lineHeight: 1, marginBottom: '3px', letterSpacing: '-0.03em' }}>{currentStreak}</div>
          <div style={{ fontSize: '11px', color: '#6B7280', fontWeight: 500 }}>Day streak</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '7px', marginBottom: '14px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#16A34A', background: '#F0FDF4', padding: '4px 10px', borderRadius: '20px', display: 'flex', alignItems: 'center', border: '1px solid #BBF7D0' }}>
          Best: {bestSkill}
          <svg width="8" height="10" viewBox="0 0 8 10" fill="none" style={{ marginLeft: 3 }}>
            <path d="M4 9V1M1 4L4 1L7 4" stroke="#16A34A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#D97706', background: '#FFF7ED', padding: '4px 10px', borderRadius: '20px', border: '1px solid #FDE68A' }}>
          Focus: {focusArea}
        </span>
      </div>
      <div style={{ ...CARD, marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#0F1117', margin: '0 0 14px 0', letterSpacing: '-0.01em' }}>
          This Week&apos;s Growth
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {metrics.map((metric) => (
            <div key={metric.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 108, fontSize: 11, color: '#6B7280', fontWeight: 500, flexShrink: 0 }}>{metric.label}</span>
              <div style={{ flex: 1, height: 8, background: '#E5E7EB', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  width: mounted ? `${metric.value}%` : '0%',
                  height: '100%', background: '#2563EB', borderRadius: 4,
                  transition: 'width 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0F1117' }}>{metric.value}%</span>
                {metric.delta !== 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: metric.delta > 0 ? '#16A34A' : '#D97706' }}>
                    {metric.delta > 0 ? '+' : ''}{metric.delta}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── CoachingTips ────────────────────────────────────────────────────────────

interface Tip {
  title: string;
  body: string;
  tag: string;
  tagColor: string;
  tagBg: string;
}

function CoachingTips({ tips, onMoreResources }: { tips: Tip[]; onMoreResources: () => void }) {
  return (
    <>
      <span style={SECTION_LABEL}>Coaching Tips</span>
      <div style={{
        display: 'flex', gap: 10, overflowX: 'auto', WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none', marginBottom: 20, paddingBottom: 4,
      }}>
        {tips.map((tip) => (
          <div key={tip.title} style={{
            background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '14px',
            padding: '14px', minWidth: 260, maxWidth: 280, flexShrink: 0,
            boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#0F1117', flex: 1 }}>{tip.title}</span>
              <span style={{
                fontSize: 10, fontWeight: 700, color: tip.tagColor, background: tip.tagBg,
                padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' as const,
              }}>{tip.tag}</span>
            </div>
            <p style={{ fontSize: 13, color: '#6B7280', margin: 0, lineHeight: 1.55 }}>{tip.body}</p>
          </div>
        ))}
      </div>
      <button
        onClick={onMoreResources}
        style={{
          background: 'none', border: 'none', fontSize: 13, color: '#2563EB', fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit', padding: '4px 0', marginBottom: 20, display: 'block',
        }}
      >
        More coaching resources
      </button>
    </>
  );
}

// ─── StartSessionCTA ─────────────────────────────────────────────────────────

function StartSessionCTA({ onStartSession, ctaPressed, setCtaPressed }: {
  onStartSession?: () => void;
  ctaPressed: boolean;
  setCtaPressed: (v: boolean) => void;
}) {
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      padding: '12px 18px 20px',
      background: 'linear-gradient(to top, #F8F9FB 70%, transparent)',
      flexShrink: 0,
    }}>
      <button
        onClick={onStartSession}
        onMouseDown={() => setCtaPressed(true)}
        onMouseUp={() => setCtaPressed(false)}
        onMouseLeave={() => setCtaPressed(false)}
        onTouchStart={() => setCtaPressed(true)}
        onTouchEnd={() => setCtaPressed(false)}
        style={{
          width: '100%', height: 56, borderRadius: 16,
          background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',
          border: 'none', color: '#FFFFFF', cursor: 'pointer', fontFamily: 'inherit',
          boxShadow: ctaPressed ? '0 2px 8px rgba(37,99,235,0.18)' : '0 4px 20px rgba(37,99,235,0.35)',
          transform: ctaPressed ? 'scale(0.98)' : 'scale(1)',
          transition: 'transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.01em' }}>Start Coaching Session</span>
        <span style={{ fontSize: 12, fontWeight: 400, color: 'rgba(255,255,255,0.75)' }}>Practice with live haptic feedback</span>
      </button>
    </div>
  );
}

// ─── CoachingScreen ──────────────────────────────────────────────────────────

export default function CoachingScreen({ onSelectSession: _onSelectSession, onBack, onStartSession, onChat }: CoachingScreenProps) {
  const { weeklyStats, device } = demoData;

  const mostRecentSession = [...demoData.sessions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )[0];
  const microGoal = mostRecentSession.insights.microGoal;

  const recentSessions = demoData.sessions.slice(0, 5);
  const avg = (key: keyof typeof recentSessions[0]['metrics']) =>
    Math.round(recentSessions.reduce((s, sess) => s + sess.metrics[key], 0) / recentSessions.length);

  const weekNum = Math.max(1, Math.floor((Date.now() - new Date(demoData.user.joinDate).getTime()) / 604800000) + 1);
  const monthsActive = Math.max(1, Math.floor((Date.now() - new Date(demoData.user.joinDate).getTime()) / (30 * 24 * 60 * 60 * 1000)));

  const [clockTime, setClockTime] = useState(() => {
    const now = new Date();
    const h = now.getHours() % 12 || 12;
    const m = now.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  });
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClockTime(
        now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
          .replace(' AM', '')
          .replace(' PM', '')
      );
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  const hasAnimated = useRef(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (!hasAnimated.current) {
      hasAnimated.current = true;
      const id = setTimeout(() => setMounted(true), 100);
      return () => clearTimeout(id);
    }
  }, []);

  const [ctaPressed, setCtaPressed] = useState(false);

  const prev = demoData.weeklyStats.previousWeekMetrics;

  const METRICS: MetricGridItem[] = [
    { key: 'speechClarity',   label: METRIC_CONFIG.speechClarity.label,   subtitle: METRIC_CONFIG.speechClarity.subtitle,   value: avg('speechClarity'),   delta: avg('speechClarity')   - prev.speechClarity,   color: METRIC_CONFIG.speechClarity.color },
    { key: 'paceConsistency', label: METRIC_CONFIG.paceConsistency.label, subtitle: METRIC_CONFIG.paceConsistency.subtitle, value: avg('paceConsistency'), delta: avg('paceConsistency') - prev.paceConsistency, color: METRIC_CONFIG.paceConsistency.color },
    { key: 'vocalVariety',    label: METRIC_CONFIG.vocalVariety.label,    subtitle: METRIC_CONFIG.vocalVariety.subtitle,    value: avg('vocalVariety'),    delta: avg('vocalVariety')    - prev.vocalVariety,    color: METRIC_CONFIG.vocalVariety.color },
    { key: 'turnTaking',      label: METRIC_CONFIG.turnTaking.label,      subtitle: METRIC_CONFIG.turnTaking.subtitle,      value: avg('turnTaking'),      delta: avg('turnTaking')      - prev.turnTaking,      color: METRIC_CONFIG.turnTaking.color },
  ];

  const streak = demoData.user.currentStreak;
  const coachMins = weeklyStats.totalMinutes;
  const coachHours = Math.floor(coachMins / 60);
  const coachRemain = coachMins % 60;
  const coachStr = coachHours > 0 ? `${coachHours}h ${coachRemain}m` : `${coachMins}m`;

  const allSessions = demoData.sessions;
  const totalSessions = demoData.user.totalSessions ?? allSessions.length;
  const totalMins = demoData.user.totalMinutesCoached ?? allSessions.reduce((s, sess) => s + sess.duration, 0);
  const totalHoursNum = Math.floor(totalMins / 60);
  const totalMinsRemain = totalMins % 60;
  const totalHoursStr = `${totalHoursNum}h ${totalMinsRemain}m`;

  const sessionAvgScore = (sess: typeof allSessions[0]) => {
    const m = sess.metrics;
    return (m.speechClarity + m.paceConsistency + m.vocalVariety + m.turnTaking) / 4;
  };

  const sorted = [...allSessions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const first10 = sorted.slice(0, 10);
  const last10 = sorted.slice(-10);
  const first10Avg = Math.round(first10.reduce((s, sess) => s + sessionAvgScore(sess), 0) / first10.length);
  const last10Avg = Math.round(last10.reduce((s, sess) => s + sessionAvgScore(sess), 0) / last10.length);
  const improvementPct = Math.round(((last10Avg - first10Avg) / first10Avg) * 100);
  const longestStreak = demoData.user.longestStreak ?? 0;

  const history = (weeklyStats.weeklyHistory ?? []).slice().reverse();
  const historyLen = history.length;
  const scoreMin = Math.min(...history.map(h => h.avgScore));
  const scoreMax = Math.max(...history.map(h => h.avgScore));

  const CHART_W = 305;
  const CHART_H = 120;
  const CHART_PAD_L = 38;
  const CHART_PAD_R = 8;
  const CHART_PAD_T = 12;
  const CHART_PAD_B = 20;
  const chartInnerW = CHART_W - CHART_PAD_L - CHART_PAD_R;
  const chartInnerH = CHART_H - CHART_PAD_T - CHART_PAD_B;

  function chartX(i: number): number {
    return CHART_PAD_L + (i / Math.max(historyLen - 1, 1)) * chartInnerW;
  }
  function chartY(score: number): number {
    return CHART_PAD_T + chartInnerH - ((score - 0) / 100) * chartInnerH;
  }

  const polylinePoints = history.map((h, i) => `${chartX(i)},${chartY(h.avgScore)}`).join(' ');
  const areaPath = history.length > 0
    ? `M ${chartX(0)},${chartY(history[0].avgScore)} ` +
      history.slice(1).map((h, i) => `L ${chartX(i + 1)},${chartY(h.avgScore)}`).join(' ') +
      ` L ${chartX(history.length - 1)},${CHART_PAD_T + chartInnerH} L ${chartX(0)},${CHART_PAD_T + chartInnerH} Z`
    : '';

  const CELL = 14;
  const CELL_GAP = 2;
  const COLS = 8;
  const ROWS = Math.ceil(historyLen / COLS);

  function heatColor(sessions: number): string {
    if (sessions === 0) return '#F3F4F6';
    if (sessions === 1) return '#BFDBFE';
    if (sessions <= 3) return '#60A5FA';
    return '#2563EB';
  }

  const heatGrid: Array<Array<HeatCell | null>> = [];
  for (let r = 0; r < ROWS; r++) {
    const row: Array<HeatCell | null> = [];
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      if (idx < historyLen) {
        row.push({ sessions: history[idx].sessions, week: history[idx].week });
      } else {
        row.push(null);
      }
    }
    heatGrid.push(row);
  }

  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb'];
  const sampledMonths = monthLabels
    .map((label, pos) => ({ label, pos }))
    .filter(({ pos }) => pos % Math.ceil(monthLabels.length / COLS) === 0)
    .slice(0, COLS);

  const bestVocalClaritySession = allSessions.reduce((best, sess) => sess.metrics.speechClarity   > best.metrics.speechClarity   ? sess : best);
  const bestSpeakingPaceSession = allSessions.reduce((best, sess) => sess.metrics.paceConsistency > best.metrics.paceConsistency ? sess : best);
  const bestVocalRangeSession   = allSessions.reduce((best, sess) => sess.metrics.vocalVariety    > best.metrics.vocalVariety    ? sess : best);
  const bestConvFlowSession     = allSessions.reduce((best, sess) => sess.metrics.turnTaking      > best.metrics.turnTaking      ? sess : best);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const last5 = sorted.slice(-5);
  const first10Metrics = {
    speechClarity:   Math.round(first10.reduce((s, sess) => s + sess.metrics.speechClarity,   0) / first10.length),
    paceConsistency: Math.round(first10.reduce((s, sess) => s + sess.metrics.paceConsistency, 0) / first10.length),
    vocalVariety:    Math.round(first10.reduce((s, sess) => s + sess.metrics.vocalVariety,    0) / first10.length),
    turnTaking:      Math.round(first10.reduce((s, sess) => s + sess.metrics.turnTaking,      0) / first10.length),
  };
  const last5Metrics = {
    speechClarity:   Math.round(last5.reduce((s, sess) => s + sess.metrics.speechClarity,   0) / last5.length),
    paceConsistency: Math.round(last5.reduce((s, sess) => s + sess.metrics.paceConsistency, 0) / last5.length),
    vocalVariety:    Math.round(last5.reduce((s, sess) => s + sess.metrics.vocalVariety,    0) / last5.length),
    turnTaking:      Math.round(last5.reduce((s, sess) => s + sess.metrics.turnTaking,      0) / last5.length),
  };

  const DEEP_METRICS: DeepMetric[] = [
    { key: 'speechClarity',   label: METRIC_CONFIG.speechClarity.label,   measureNote: METRIC_CONFIG.speechClarity.subtitle,   current: last5Metrics.speechClarity,   start: first10Metrics.speechClarity,   color: METRIC_CONFIG.speechClarity.color },
    { key: 'paceConsistency', label: METRIC_CONFIG.paceConsistency.label, measureNote: METRIC_CONFIG.paceConsistency.subtitle, current: last5Metrics.paceConsistency, start: first10Metrics.paceConsistency, color: METRIC_CONFIG.paceConsistency.color },
    { key: 'vocalVariety',    label: METRIC_CONFIG.vocalVariety.label,    measureNote: METRIC_CONFIG.vocalVariety.subtitle,    current: last5Metrics.vocalVariety,    start: first10Metrics.vocalVariety,    color: METRIC_CONFIG.vocalVariety.color },
    { key: 'turnTaking',      label: METRIC_CONFIG.turnTaking.label,      measureNote: METRIC_CONFIG.turnTaking.subtitle,      current: last5Metrics.turnTaking,      start: first10Metrics.turnTaking,      color: METRIC_CONFIG.turnTaking.color },
  ];

  const last6History = history.slice(-6);

  const TIPS: Tip[] = [
    {
      title: 'Your pace spikes on familiar topics',
      body: `Tizzy noticed your Speaking Pace spikes when you're confident about the material; you scored ${avg('paceConsistency')}% this week. Try 10% slower than feels natural on topics you know well. Your best-paced sessions happened when you stayed deliberate.`,
      tag: 'Speaking Pace', tagColor: METRIC_CONFIG.paceConsistency.color, tagBg: METRIC_CONFIG.paceConsistency.tagBg,
    },
    {
      title: 'You hold turns best in 1-on-1s',
      body: `Tizzy detected that your Conversational Flow score (${avg('turnTaking')}%) is highest during one-on-one conversations. In group settings, try ending 2 of your points with a question, which naturally invites the group back in.`,
      tag: 'Conversational Flow', tagColor: METRIC_CONFIG.turnTaking.color, tagBg: METRIC_CONFIG.turnTaking.tagBg,
    },
    {
      title: 'Vocal Range is your strength',
      body: `Across all your passively recorded conversations, your Vocal Range scores at ${avg('vocalVariety')}%. Tizzy detected you naturally modulate on key words. Keep using emphasis intentionally. It's what keeps listeners engaged longest.`,
      tag: 'Vocal Range', tagColor: METRIC_CONFIG.vocalVariety.color, tagBg: METRIC_CONFIG.vocalVariety.tagBg,
    },
    {
      title: 'Morning clarity is your peak',
      body: `Tizzy found your Vocal Clarity peaks before noon, averaging ${avg('speechClarity')}% in morning sessions. Schedule high-stakes conversations in the morning when your amplitude and projection are naturally strongest.`,
      tag: 'Vocal Clarity', tagColor: METRIC_CONFIG.speechClarity.color, tagBg: METRIC_CONFIG.speechClarity.tagBg,
    },
  ];

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: '#F8F9FB', fontFamily: 'var(--font-dm-sans), var(--font-inter), system-ui, sans-serif',
      overflow: 'hidden',
    }}>
      <CoachingStatusBar clockTime={clockTime} batteryPct={device.battery} />

      {onBack && (
        <div style={{ paddingLeft: 18, paddingRight: 18, paddingBottom: 4, flexShrink: 0, borderBottom: '1px solid #E5E7EB' }}>
          <button
            onClick={onBack}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
              color: '#2563EB', fontFamily: 'inherit', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
              <path d="M7 1L1 7L7 13" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
        </div>
      )}

      <div style={{
        flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        paddingLeft: '18px', paddingRight: '18px', paddingBottom: '100px', scrollbarWidth: 'none',
      }}>
        <CoachingHeader weekNum={weekNum} streak={streak} />
        <CurrentMetricsGrid metrics={METRICS} />
        <GrowthCard
          monthsActive={monthsActive} improvementPct={improvementPct}
          first10Avg={first10Avg} last10Avg={last10Avg}
          totalSessions={totalSessions} totalHoursStr={totalHoursStr}
          longestStreak={longestStreak}
        />
        <ScoreTrendChart
          history={history}
          CHART_W={CHART_W} CHART_H={CHART_H}
          CHART_PAD_L={CHART_PAD_L} CHART_PAD_R={CHART_PAD_R}
          CHART_PAD_T={CHART_PAD_T} CHART_PAD_B={CHART_PAD_B}
          chartX={chartX} chartY={chartY}
          polylinePoints={polylinePoints} areaPath={areaPath}
          scoreMin={scoreMin} scoreMax={scoreMax}
        />
        <ActivityHeatmap
          heatGrid={heatGrid} sampledMonths={sampledMonths}
          heatColor={heatColor} CELL={CELL} CELL_GAP={CELL_GAP}
        />
        <AllTimeBests
          bestVocalClarity={bestVocalClaritySession}
          bestSpeakingPace={bestSpeakingPaceSession}
          bestVocalRange={bestVocalRangeSession}
          bestConvFlow={bestConvFlowSession}
          formatDate={formatDate}
        />
        <MetricBreakdown deepMetrics={DEEP_METRICS} last6History={last6History} />
        <TodaysGoal microGoal={microGoal} />
        <ThisWeekSection
          conversations={weeklyStats.conversations}
          coachStr={coachStr}
          currentStreak={demoData.user.currentStreak}
          bestSkill={weeklyStats.bestSkill}
          focusArea={weeklyStats.focusArea}
          metrics={METRICS}
          mounted={mounted}
        />
        <CoachingTips tips={TIPS} onMoreResources={() => onChat?.()} />
      </div>

      <StartSessionCTA onStartSession={onStartSession} ctaPressed={ctaPressed} setCtaPressed={setCtaPressed} />
    </div>
  );
}
