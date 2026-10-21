"use client";

import { useState, useEffect, useMemo } from 'react';
import { demoData, formatDate } from '../shared/demoData';

interface SessionsScreenProps {
  onSelectSession: (id: string) => void;
}

// ─── Date-based group helper ──────────────────────────────────────────────────

function getGroup(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'This Week';
  if (diff < 14) return 'Last Week';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ─── Score color helper ───────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 85) return '#16A34A';
  if (score >= 75) return '#2563EB';
  return '#D97706';
}

// ─── Metric color by key ──────────────────────────────────────────────────────

function metricColorByKey(_key: string): string {
  return '#2563EB';
}

// ─── Metric Bar ───────────────────────────────────────────────────────────────

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
        <span style={{ fontSize: '11px', color: '#6B7280', fontWeight: 500 }}>
          {label}
        </span>
        <span style={{ fontSize: '11px', fontWeight: 700, color }}>
          {value}%
        </span>
      </div>
      <div style={{ height: '4px', borderRadius: '3px', background: '#E5E7EB', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, background: '#2563EB', borderRadius: '3px' }} />
      </div>
    </div>
  );
}

// ─── Session Card ─────────────────────────────────────────────────────────────

const envColors: Record<string, { text: string; bg: string }> = {
  'Study Group':          { text: '#2563EB', bg: '#EFF6FF' },
  'Dining Hall':          { text: '#16A34A', bg: '#F0FDF4' },
  'Team Project Meeting': { text: '#6B7280', bg: '#F3F4F6' },
  'Coffee Chat':          { text: '#6B7280', bg: '#F3F4F6' },
  'Team Meeting':         { text: '#6B7280', bg: '#F3F4F6' },
  'Social Event':         { text: '#6B7280', bg: '#F3F4F6' },
  'Class':                { text: '#D97706', bg: '#FFF7ED' },
  'Phone Call':           { text: '#16A34A', bg: '#F0FDF4' },
  'Coffee Shop':          { text: '#6B7280', bg: '#F3F4F6' },
  'Office Meeting':       { text: '#6B7280', bg: '#F3F4F6' },
  'Video Call':           { text: '#2563EB', bg: '#EFF6FF' },
  'Team Standup':         { text: '#6B7280', bg: '#F3F4F6' },
  'Client Presentation':  { text: '#D97706', bg: '#FFF7ED' },
  'Casual Chat':          { text: '#16A34A', bg: '#F0FDF4' },
};

function SessionCard({
  session,
  onSelect,
}: {
  session: typeof demoData.sessions[0];
  onSelect: () => void;
}) {
  const metricLabels: Record<string, string> = {
    speechClarity:   'Vocal Clarity',
    paceConsistency: 'Speaking Pace',
    vocalVariety:    'Vocal Range',
    turnTaking:      'Conversational Flow',
  };

  const avgScore = Math.round(
    Object.values(session.metrics).reduce((a, b) => a + b, 0) /
    Object.values(session.metrics).length
  );
  const color = scoreColor(avgScore);

  const winsCount = session.insights.whatWentWell.length;
  const oppsCount = session.insights.areasForGrowth.length;

  const displayDuration = session.duration < 120
    ? `${session.duration} min`
    : `${Math.round(session.duration / 60)} min`;

  const isCoaching = session.environment === 'Coaching Session';

  const envStyle = envColors[session.environment] ?? { text: '#6B7280', bg: '#F3F4F6' };

  return (
    <div
      className="tizzy-tap"
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(); }}
      style={{
        background: '#FFFFFF',
        borderRadius: '12px',
        padding: '14px 16px',
        marginBottom: '10px',
        border: '1px solid #E5E7EB',
        borderLeft: `4px solid ${color}`,
        cursor: 'pointer',
      }}
    >
      {/* Header row: env pill + capture pill + score ring + chevron */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '8px' }}>
        {/* Environment pill */}
        <span style={{
          fontSize: '12px',
          fontWeight: 600,
          color: envStyle.text,
          background: envStyle.bg,
          borderRadius: '20px',
          padding: '3px 10px',
          whiteSpace: 'nowrap',
        }}>
          {session.environment}
        </span>

        <div style={{ flex: 1 }} />

        {/* Auto-captured or Coached pill */}
        {isCoaching ? (
          <span style={{
            fontSize: '9px',
            fontWeight: 600,
            color: '#2563EB',
            background: '#EFF6FF',
            borderRadius: '20px',
            padding: '2px 7px',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}>
            Coached
          </span>
        ) : (
          <span style={{
            fontSize: '9px',
            fontWeight: 500,
            color: '#9CA3AF',
            background: '#F3F4F6',
            borderRadius: '20px',
            padding: '2px 7px',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}>
            Auto-captured
          </span>
        )}

        {/* Score ring */}
        <div style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: `2px solid ${color}`,
          background: `${color}15`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color }}>{avgScore}%</span>
        </div>

        {/* Chevron */}
        <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
          <path d="M1 1L6 6L1 11" stroke="#9CA3AF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Date + duration row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{ fontSize: '11px', color: '#9CA3AF' }}>
          {formatDate(session.date)}
        </span>
        <span style={{ fontSize: '11px', color: '#D1D5DB' }}>·</span>
        <span style={{ fontSize: '11px', color: '#9CA3AF' }}>
          {displayDuration}
        </span>
      </div>

      {/* Summary */}
      <p style={{
        fontSize: '13px',
        color: '#6B7280',
        lineHeight: '1.5',
        margin: '0 0 12px 0',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical' as const,
        overflow: 'hidden',
      }}>
        {session.summary}
      </p>

      {/* Metrics — 2-column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', marginBottom: '12px' }}>
        {Object.entries(session.metrics).map(([key, val]) => (
          <MetricBar
            key={key}
            label={metricLabels[key]}
            value={val}
            color={metricColorByKey(key)}
          />
        ))}
      </div>

      {/* Footer: wins/opps badges */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: '10px',
        borderTop: '1px solid #E5E7EB',
      }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <span style={{
            fontSize: '11px',
            fontWeight: 500,
            color: '#15803D',
            background: '#DCFCE7',
            borderRadius: '20px',
            padding: '2px 8px',
          }}>
            {winsCount} wins
          </span>
          <span style={{
            fontSize: '11px',
            fontWeight: 500,
            color: '#B45309',
            background: '#FEF3C7',
            borderRadius: '20px',
            padding: '2px 8px',
          }}>
            {oppsCount} to improve
          </span>
        </div>
      </div>

      {winsCount > 0 && session.insights.whatWentWell[0] && (
        <p style={{ fontSize: 11, color: '#9CA3AF', margin: '6px 0 0 0', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }}>
          {session.insights.whatWentWell[0]}
        </p>
      )}
    </div>
  );
}

// ─── Stats Strip ──────────────────────────────────────────────────────────────

const STRIP_COLORS = ['#2563EB', '#2563EB', '#16A34A', '#D97706', '#6B7280'];

function StatsStrip() {
  const allSessions = demoData.sessions;

  const overallAvg = Math.round(
    allSessions.reduce((sum, s) => {
      const vals = Object.values(s.metrics);
      return sum + vals.reduce((a, b) => a + b, 0) / vals.length;
    }, 0) / allSessions.length
  );

  const totalMinutes = allSessions.reduce((sum, s) => {
    const mins = s.duration < 120 ? s.duration : Math.round(s.duration / 60);
    return sum + mins;
  }, 0);
  const totalHours = Math.round(totalMinutes / 60);

  const envCounts: Record<string, number> = {};
  for (const s of allSessions) {
    envCounts[s.environment] = (envCounts[s.environment] ?? 0) + 1;
  }
  const topEnv = Object.entries(envCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  const cards = [
    { value: `${demoData.user.totalSessions ?? allSessions.length}`, label: 'All time', sub: 'Total Captures' },
    { value: `${overallAvg}%`, label: 'Avg score', sub: '' },
    { value: `${totalHours}h`, label: 'Time captured', sub: '' },
    { value: `${demoData.user.longestStreak ?? 0} days`, label: 'Best streak', sub: '' },
    { value: `#1`, label: 'Most common', sub: topEnv },
  ];

  return (
    <div style={{
      display: 'flex',
      overflowX: 'auto',
      gap: 8,
      paddingLeft: 0,
      paddingRight: 18,
      paddingBottom: 8,
      scrollbarWidth: 'none',
      marginBottom: 16,
      marginLeft: -18,
      paddingTop: 2,
    }}>
      <style>{`.tizzy-stats-strip::-webkit-scrollbar { display: none; }`}</style>
      {cards.map((card, i) => (
        <div
          key={card.label}
          style={{
            background: '#FFFFFF',
            border: '1px solid #E5E7EB',
            borderLeft: `3px solid ${STRIP_COLORS[i]}`,
            borderRadius: 12,
            padding: '10px 14px',
            minWidth: 95,
            flexShrink: 0,
            marginLeft: i === 0 ? 18 : 0,
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 800, color: i === 4 ? '#0F1117' : STRIP_COLORS[i], lineHeight: 1.2 }}>
            {card.value}
          </div>
          {card.sub && (
            <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 500, lineHeight: 1.3 }}>
              {card.sub}
            </div>
          )}
          <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
            {card.label}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Shared Status Bar ────────────────────────────────────────────────────────

function SessionsStatusBar({ clockTime }: { clockTime: string }) {
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
      <span style={{ fontSize: 15, fontWeight: 600, color: '#0F1117', letterSpacing: '-0.2px' }}>{clockTime}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
          <rect x="0"    y="8" width="3" height="4"  rx="1" fill="#0F1117" />
          <rect x="4.5"  y="5" width="3" height="7"  rx="1" fill="#0F1117" />
          <rect x="9"    y="2" width="3" height="10" rx="1" fill="#0F1117" />
          <rect x="13.5" y="0" width="3" height="12" rx="1" fill="#0F1117" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
          <path d="M8 9.5 L8 9.5" stroke="#0F1117" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M5.5 7.2 Q8 5.2 10.5 7.2" stroke="#0F1117" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          <path d="M3 4.8 Q8 1 13 4.8" stroke="#0F1117" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="#0F1117" strokeWidth="1" />
          <rect x="2"   y="2"   width="16" height="8"  rx="2"   fill="#0F1117" />
          <path d="M22.5 4 L22.5 8" stroke="#0F1117" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

function SessionsHeader({ totalSessions }: { totalSessions: number }) {
  return (
    <div style={{ paddingTop: '12px', marginBottom: '14px' }}>
      <h1 style={{
        fontSize: '28px',
        fontWeight: 900,
        color: '#0F1117',
        margin: '0 0 3px 0',
        letterSpacing: '-0.03em',
      }}>
        Captures
      </h1>
      <p style={{ fontSize: '11px', color: '#9CA3AF', margin: '0 0 2px 0', fontWeight: 400 }}>
        Auto-detected by your pendant
      </p>
      <p style={{ fontSize: '13px', color: '#6B7280', margin: 0, fontWeight: 500 }}>
        {totalSessions} captures recorded
      </p>
    </div>
  );
}

function FilterBar({
  activeFilter,
  sortBy,
  onFilterChange,
  onSortToggle,
}: {
  activeFilter: FilterType;
  sortBy: SortType;
  onFilterChange: (f: FilterType) => void;
  onSortToggle: () => void;
}) {
  const filterLabels: FilterType[] = ['All', 'This Week', 'Favorites'];
  return (
    <div style={{
      display: 'flex',
      gap: '7px',
      marginBottom: '12px',
      overflowX: 'auto',
      scrollbarWidth: 'none',
      paddingBottom: '4px',
      alignItems: 'center',
    }}>
      {filterLabels.map((label) => (
        <button
          key={label}
          onClick={() => onFilterChange(label)}
          style={{
            flexShrink: 0,
            padding: '6px 16px',
            borderRadius: '20px',
            border: 'none',
            background: activeFilter === label ? '#2563EB' : '#F3F4F6',
            color: activeFilter === label ? '#FFFFFF' : '#6B7280',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            boxShadow: activeFilter === label ? '0 2px 8px rgba(37,99,235,0.25)' : 'none',
          }}
        >
          {label}
        </button>
      ))}
      <button
        onClick={onSortToggle}
        style={{
          flexShrink: 0,
          padding: '6px 12px',
          borderRadius: 20,
          border: 'none',
          background: '#F3F4F6',
          color: '#6B7280',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginRight: 4 }}>
          <path d="M1 2H9M2 5H8M3.5 8H6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        {sortBy === 'date' ? 'Date' : 'Score'}
      </button>
    </div>
  );
}

function SearchInput({
  search,
  onSearchChange,
}: {
  search: string;
  onSearchChange: (val: string) => void;
}) {
  return (
    <div style={{ position: 'relative', marginBottom: '16px' }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
        style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
        <circle cx="7" cy="7" r="4.5" stroke="#9CA3AF" strokeWidth="1.5" />
        <path d="M11 11L14 14" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        className="tizzy-search"
        value={search}
        onChange={e => onSearchChange(e.target.value)}
        placeholder="Search captures..."
        style={{
          width: '100%',
          height: 40,
          borderRadius: 12,
          border: '1px solid #E5E7EB',
          background: '#F3F4F6',
          paddingLeft: 36,
          paddingRight: search ? 36 : 14,
          fontSize: 14,
          color: '#0F1117',
          fontFamily: 'inherit',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
      {search !== '' && (
        <button
          onClick={() => onSearchChange('')}
          style={{
            position: 'absolute',
            right: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            padding: 0,
            color: '#9CA3AF',
            fontSize: 16,
            cursor: 'pointer',
            lineHeight: 1,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
        </button>
      )}
    </div>
  );
}

function EmptySessionsState({ activeFilter, search }: { activeFilter: FilterType; search: string }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: '60px',
    }}>
      <div style={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        background: '#F3F4F6',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="7" stroke="#9CA3AF" strokeWidth="2"/>
          <path d="M16.5 16.5L21 21" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </div>
      <p style={{ fontSize: 15, fontWeight: 600, color: '#0F1117', marginTop: 12, marginBottom: 0 }}>
        {activeFilter === 'Favorites' ? 'No favorites yet' : 'No captures found'}
      </p>
      <p style={{ fontSize: 13, color: '#9CA3AF', marginTop: 4, marginBottom: 0 }}>
        {activeFilter === 'Favorites'
          ? 'No favorites yet. Long press a capture to favorite it.'
          : search
            ? 'Try a different search term'
            : 'No captures in this period'}
      </p>
    </div>
  );
}

function SessionGroup({
  label,
  sessions: groupSessions,
  onSelectSession,
}: {
  label: string;
  sessions: typeof demoData.sessions;
  onSelectSession: (id: string) => void;
}) {
  const avg = groupAvgScore(groupSessions);
  return (
    <div>
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 2,
        background: 'transparent',
        paddingTop: 6,
        paddingBottom: 4,
        paddingLeft: 0,
        paddingRight: 0,
        borderRadius: 0,
        borderBottom: '1px solid #E5E7EB',
        marginBottom: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#6B7280',
          textTransform: 'uppercase' as const,
          letterSpacing: '0.5px',
        }}>
          {label}
        </span>
        <span style={{
          background: '#EFF6FF',
          borderRadius: 6,
          padding: '2px 8px',
          fontSize: 11,
          color: '#2563EB',
          fontWeight: 600,
        }}>
          {avg}% avg
        </span>
      </div>
      {groupSessions.map(session => (
        <SessionCard
          key={session.id}
          session={session}
          onSelect={() => onSelectSession(session.id)}
        />
      ))}
    </div>
  );
}

// ─── Captures Screen ──────────────────────────────────────────────────────────

type FilterType = 'All' | 'This Week' | 'Favorites';
type SortType = 'date' | 'score';

const FIXED_ORDER = ['Today', 'Yesterday', 'This Week', 'Last Week'];

function groupAvgScore(sessions: typeof demoData.sessions): number {
  if (sessions.length === 0) return 0;
  const total = sessions.reduce((sum, s) => {
    const vals = Object.values(s.metrics);
    return sum + vals.reduce((a, b) => a + b, 0) / vals.length;
  }, 0);
  return Math.round(total / sessions.length);
}

export default function SessionsScreen({ onSelectSession }: SessionsScreenProps) {
  const { sessions } = demoData;

  const [activeFilter, setActiveFilter] = useState<FilterType>('All');
  const [search, setSearch] = useState('');
  const [clockTime, setClockTime] = useState('');
  const [sortBy, setSortBy] = useState<SortType>('date');

  useEffect(() => {
    function tick() {
      const now = new Date();
      const h = now.getHours() % 12 || 12;
      const m = now.getMinutes().toString().padStart(2, '0');
      setClockTime(`${h}:${m}`);
    }
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  const { filteredSessions, groups } = useMemo(() => {
    let filtered = sessions.filter(s => {
      const matchesSearch = search === '' ||
        s.environment.toLowerCase().includes(search.toLowerCase()) ||
        (s.summary ?? '').toLowerCase().includes(search.toLowerCase());

      const diff = Math.floor((Date.now() - new Date(s.date).getTime()) / 86400000);
      const matchesFilter =
        activeFilter === 'All' ||
        (activeFilter === 'This Week' && diff < 7) ||
        (activeFilter === 'Favorites' && s.favorite === true);

      return matchesSearch && matchesFilter;
    });

    if (sortBy === 'score') {
      filtered = [...filtered].sort((a, b) => {
        const avgA = Math.round(Object.values(a.metrics).reduce((s, v) => s + v, 0) / Object.values(a.metrics).length);
        const avgB = Math.round(Object.values(b.metrics).reduce((s, v) => s + v, 0) / Object.values(b.metrics).length);
        return avgB - avgA;
      });
    }

    const groupMap: Record<string, typeof demoData.sessions> = {};
    for (const s of filtered) {
      const g = getGroup(s.date);
      if (!groupMap[g]) groupMap[g] = [];
      groupMap[g].push(s);
    }

    const allGroupKeys = [...new Set(filtered.map(s => getGroup(s.date)))];
    const orderedKeys = [
      ...FIXED_ORDER.filter(k => groupMap[k]),
      ...allGroupKeys.filter(k => !FIXED_ORDER.includes(k)).sort((a, b) => new Date(b + ' 1').getTime() - new Date(a + ' 1').getTime()),
    ];
    const grps = orderedKeys.filter(g => groupMap[g]).map(g => ({ label: g, sessions: groupMap[g] }));

    return { filteredSessions: filtered, groups: grps };
  }, [sessions, activeFilter, search, sortBy]);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#F8F9FB',
      fontFamily: 'var(--font-dm-sans), var(--font-inter), system-ui, sans-serif',
      overflow: 'hidden',
    }}>
      <style>{`
        .tizzy-search::placeholder { color: #9CA3AF; }
        .tizzy-search:focus { border-color: #2563EB !important; outline: none; }
      `}</style>

      <SessionsStatusBar clockTime={clockTime} />

      <div style={{
        flex: 1,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        paddingLeft: '18px',
        paddingRight: '18px',
        paddingBottom: '84px',
        scrollbarWidth: 'none',
      }}>
        <SessionsHeader totalSessions={demoData.user.totalSessions ?? sessions.length} />

        <FilterBar
          activeFilter={activeFilter}
          sortBy={sortBy}
          onFilterChange={setActiveFilter}
          onSortToggle={() => setSortBy(s => s === 'date' ? 'score' : 'date')}
        />

        {activeFilter === 'All' && search === '' && <StatsStrip />}

        {activeFilter !== 'All' && (
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: '0 0 8px 0', fontWeight: 500 }}>
            {filteredSessions.length} {filteredSessions.length === 1 ? 'capture' : 'captures'} {activeFilter === 'This Week' ? 'this week' : 'favorited'}
          </p>
        )}

        <SearchInput search={search} onSearchChange={setSearch} />

        {filteredSessions.length === 0 ? (
          <EmptySessionsState activeFilter={activeFilter} search={search} />
        ) : (
          groups.map(({ label, sessions: groupSessions }) => (
            <SessionGroup
              key={label}
              label={label}
              sessions={groupSessions}
              onSelectSession={onSelectSession}
            />
          ))
        )}
      </div>
    </div>
  );
}
