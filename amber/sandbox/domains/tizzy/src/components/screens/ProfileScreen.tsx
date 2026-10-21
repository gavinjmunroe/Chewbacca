"use client";

import { useState, useEffect, useReducer } from 'react';
import { demoData } from '../shared/demoData';

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div
      role="switch"
      aria-checked={on}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle(); }}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: on ? '#16A34A' : '#D1D5DB',
        position: 'relative',
        flexShrink: 0,
        cursor: 'pointer',
        transition: 'background 0.2s ease',
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#FFFFFF',
          position: 'absolute',
          top: 2,
          left: on ? 22 : 2,
          transition: 'left 0.2s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </div>
  );
}

// Blue accent toggle for regular settings
function BlueToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div
      role="switch"
      aria-checked={on}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle(); }}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: on ? '#2563EB' : '#D1D5DB',
        position: 'relative',
        flexShrink: 0,
        cursor: 'pointer',
        transition: 'background 0.2s ease',
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#FFFFFF',
          position: 'absolute',
          top: 2,
          left: on ? 22 : 2,
          transition: 'left 0.2s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <p
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: '#9CA3AF',
        textTransform: 'uppercase',
        letterSpacing: '0.9px',
        margin: 0,
        marginBottom: 12,
        paddingLeft: 4,
        borderBottom: '1px solid #F3F4F6',
        paddingBottom: 6,
      }}
    >
      {title}
    </p>
  );
}

function SettingRow({
  label,
  right,
  borderBottom = true,
}: {
  label: string;
  right: React.ReactNode;
  borderBottom?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 13,
        paddingBottom: 13,
        paddingLeft: 16,
        paddingRight: 16,
        borderBottom: borderBottom ? '1px solid #F3F4F6' : 'none',
        minHeight: 48,
      }}
    >
      <span style={{ fontSize: 14, color: '#0F1117', fontWeight: 500 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{right}</div>
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid #E5E7EB',
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── Lock overlay icon ─────────────────────────────────────────────────────────

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <rect x="1.5" y="4.5" width="7" height="5" rx="1.2" fill="#9CA3AF" />
      <path d="M3 4.5V3C3 1.9 3.9 1 5 1C6.1 1 7 1.9 7 3V4.5" stroke="#9CA3AF" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

// ─── Badge icon components (clean minimal designs) ─────────────────────────────

// "First Step": triangle/arrow pointing right
function IconFirstStep({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path d="M6 4L18 11L6 18V4Z" fill={color} />
    </svg>
  );
}

// "Week Warrior": calendar with "7"
function IconWeekWarrior({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x="2" y="4" width="18" height="15" rx="2.5" stroke={color} strokeWidth="1.6" />
      <path d="M2 9H20" stroke={color} strokeWidth="1.6" />
      <path d="M7 2V6M15 2V6" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <text x="11" y="17" textAnchor="middle" fontSize="7" fontWeight="700" fill={color} fontFamily="system-ui,sans-serif">7</text>
    </svg>
  );
}

// "Century Club": bold "100" text
function IconCenturyClub({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <text x="11" y="15" textAnchor="middle" fontSize="9" fontWeight="800" fill={color} fontFamily="system-ui,sans-serif">100</text>
    </svg>
  );
}

// "Consistency": three equal vertical bars
function IconConsistency({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x="3"  y="5" width="4" height="12" rx="2" fill={color} />
      <rect x="9"  y="5" width="4" height="12" rx="2" fill={color} />
      <rect x="15" y="5" width="4" height="12" rx="2" fill={color} />
    </svg>
  );
}

// "Voice Pro": simple microphone silhouette
function IconVoicePro({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x="8" y="2" width="6" height="10" rx="3" fill={color} />
      <path d="M4 11C4 15.4 7.1 19 11 19C14.9 19 18 15.4 18 11" stroke={color} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M11 19V21" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// "Social": two overlapping circles
function IconSocial({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <circle cx="8"  cy="10" r="5" stroke={color} strokeWidth="1.6" fill="none" />
      <circle cx="14" cy="10" r="5" stroke={color} strokeWidth="1.6" fill="none" />
    </svg>
  );
}

// "Night Owl": simple crescent moon
function IconNightOwl({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path d="M17 13C16 16 13 18 9.5 18C6 18 3 15 3 11.5C3 8.5 5 6 8 5C6 8 7 12 10 14C12.5 15.5 15.5 15 17 13Z" fill={color} />
    </svg>
  );
}

// "Perfect Week" — checkmark circle (locked badge, not redefined here; reused for fallback)
function IconCheckCircle({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="8" stroke={color} strokeWidth="1.6" />
      <path d="M7.5 11L10 13.5L14.5 8.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// "Iron Streak" — lightning bolt
function IconLightning({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path d="M13 3L6 13H11L9 19L16 9H11L13 3Z" fill={color} />
    </svg>
  );
}

// "Marathon" — runner
function IconRunner({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <circle cx="14" cy="4.5" r="1.8" stroke={color} strokeWidth="1.4" />
      <path d="M11 8L8 18" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M11 8L14 12L18 10" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 8L9 12L6 12" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 18L6 21M8 18L10.5 20.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// ─── Badge data ────────────────────────────────────────────────────────────────

interface BadgeData {
  name: string;
  criteria: string;
  isEarned: boolean;
  Icon: React.ComponentType<{ color: string }>;
  accentColor: string;
  bgColor: string;
}

// ─── Badge Card ────────────────────────────────────────────────────────────────

function BadgeCard({ badge }: { badge: BadgeData }) {
  const iconColor    = badge.isEarned ? badge.accentColor : '#D1D5DB';
  const circleBg     = badge.isEarned
    ? `linear-gradient(135deg, ${badge.bgColor} 0%, ${badge.accentColor}22 100%)`
    : 'transparent';
  const circleBorder = badge.isEarned ? `1.5px solid ${badge.accentColor}50` : '1.5px solid #E5E7EB';
  const circleGlow   = badge.isEarned ? `0 2px 8px ${badge.accentColor}30` : 'none';

  return (
    <div style={{
      width: 80,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
      padding: '12px 6px',
      background: '#FFFFFF',
      border: '1px solid #E5E7EB',
      borderRadius: 14,
      position: 'relative',
    }}>
      {/* 48×48 circle badge */}
      <div style={{
        position: 'relative',
        width: 48,
        height: 48,
        borderRadius: '50%',
        background: circleBg,
        border: circleBorder,
        boxShadow: circleGlow,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <badge.Icon color={iconColor} />
        {/* Lock overlay bottom-right */}
        {!badge.isEarned && (
          <div style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            background: '#F3F4F6',
            borderRadius: '50%',
            width: 16,
            height: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid #E5E7EB',
          }}>
            <LockIcon />
          </div>
        )}
      </div>
      {/* Badge name */}
      <span style={{
        fontSize: badge.isEarned ? 11 : 10,
        fontWeight: 700,
        color: badge.isEarned ? '#0F1117' : '#6B7280',
        textAlign: 'center',
        lineHeight: 1.2,
      }}>
        {badge.name}
      </span>
      {/* Criteria subtitle */}
      <span style={{
        fontSize: 9,
        color: '#9CA3AF',
        textAlign: 'center',
        lineHeight: 1.3,
      }}>
        {badge.criteria}
      </span>
    </div>
  );
}

// ─── Achievements Section ──────────────────────────────────────────────────────

function AchievementsSection() {
  const allSessions = demoData.sessions;
  const totalSessions = demoData.user.totalSessions ?? allSessions.length;
  const longestStreak = demoData.user.longestStreak ?? 0;

  // Voice Pro: avg Vocal Clarity over last 5 sessions >= 80
  const last5 = allSessions.slice(0, 5);
  const avgClarity = Math.round(
    last5.reduce((s, sess) => s + sess.metrics.speechClarity, 0) / last5.length,
  );

  // Night Owl: any session after 9pm (hour >= 21)
  const hasNightSession = allSessions.some(s => {
    const h = new Date(s.date).getHours();
    return h >= 21;
  });

  // Social: captured in 5+ distinct environments
  const distinctEnvs = new Set(allSessions.map(s => s.environment)).size;

  // Sort sessions chronologically (oldest first)
  const sortedSessions = [...allSessions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  // 100th session date
  const hundredthDate = sortedSessions[99]
    ? new Date(sortedSessions[99].date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : 'N/A';

  // 30-day streak date: first date where 30 consecutive calendar days each had a session
  function findFirstStreakDate(n: number): string | null {
    const uniqueDates = [...new Set(sortedSessions.map(s => s.date.slice(0, 10)))];
    let streak = 1;
    for (let i = 1; i < uniqueDates.length; i++) {
      const diff =
        (new Date(uniqueDates[i]).getTime() - new Date(uniqueDates[i - 1]).getTime()) / 86400000;
      if (diff === 1) {
        streak++;
        if (streak >= n) {
          return new Date(uniqueDates[i]).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        }
      } else {
        streak = 1;
      }
    }
    return null;
  }
  const thirtyStreakLabel = findFirstStreakDate(30) ?? 'N/A';

  const hasIronStreak = longestStreak >= 60;

  const firstSessionDate = new Date(demoData.user.joinDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const joinMonthYear = new Date(demoData.user.joinDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const sessionsTo200 = Math.max(0, 200 - totalSessions);

  const BADGES: BadgeData[] = [
    { name: 'First Step',   criteria: 'Complete your first capture',       isEarned: totalSessions >= 1,   Icon: IconFirstStep,   accentColor: '#2563EB', bgColor: '#EFF6FF' },
    { name: 'Week Warrior', criteria: '7-day wearing streak',              isEarned: longestStreak >= 7,   Icon: IconWeekWarrior, accentColor: '#2563EB', bgColor: '#EFF6FF' },
    { name: 'Century Club', criteria: '100 conversations captured',        isEarned: totalSessions >= 100, Icon: IconCenturyClub, accentColor: '#2563EB', bgColor: '#EFF6FF' },
    { name: 'Consistency',  criteria: '30-day wearing streak',             isEarned: longestStreak >= 30,  Icon: IconConsistency, accentColor: '#2563EB', bgColor: '#EFF6FF' },
    { name: 'Voice Pro',    criteria: 'Average Vocal Clarity above 80%',  isEarned: avgClarity >= 80,     Icon: IconVoicePro,    accentColor: '#2563EB', bgColor: '#EFF6FF' },
    { name: 'Social',       criteria: 'Capture 5+ conversation partners', isEarned: distinctEnvs >= 5,    Icon: IconSocial,      accentColor: '#2563EB', bgColor: '#EFF6FF' },
    { name: 'Night Owl',    criteria: 'Capture a conversation after 9pm', isEarned: hasNightSession,      Icon: IconNightOwl,    accentColor: '#2563EB', bgColor: '#EFF6FF' },
    { name: 'Perfect Week', criteria: '5/5 daily goal for 4 weeks',       isEarned: false,                Icon: IconCheckCircle, accentColor: '#2563EB', bgColor: '#EFF6FF' },
    { name: 'Iron Streak',  criteria: '60-day wearing streak',            isEarned: hasIronStreak,        Icon: IconLightning,   accentColor: '#2563EB', bgColor: '#EFF6FF' },
    { name: 'Marathon',     criteria: '200 conversations captured',       isEarned: totalSessions >= 200, Icon: IconRunner,      accentColor: '#2563EB', bgColor: '#EFF6FF' },
  ];

  const milestones = [
    { reached: totalSessions >= 1,   text: 'First session completed', date: firstSessionDate },
    { reached: longestStreak >= 7,   text: '7-day streak achieved',   date: joinMonthYear    },
    { reached: totalSessions >= 100, text: '100th session',           date: hundredthDate    },
    { reached: longestStreak >= 30,  text: '30-day streak',           date: thirtyStreakLabel },
    { reached: false, text: '200 sessions',                           date: sessionsTo200 > 0 ? `Upcoming · ${sessionsTo200} away` : 'Achieved' },
  ];

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionHeader title="Achievements" />

      {/* Badge horizontal scroll */}
      <div
        className="tizzy-badges-scroll"
        style={{
          display: 'flex',
          overflowX: 'auto',
          gap: 8,
          paddingLeft: 0,
          paddingRight: 18,
          paddingBottom: 4,
          scrollbarWidth: 'none',
          marginBottom: 12,
          marginLeft: -4,
        }}
      >
        <style>{`.tizzy-badges-scroll::-webkit-scrollbar { display: none; }`}</style>
        {BADGES.map((badge, i) => (
          <div key={badge.name} style={{ marginLeft: i === 0 ? 4 : 0 }}>
            <BadgeCard badge={badge} />
          </div>
        ))}
      </div>

      {/* Milestones card */}
      <div style={{
        background: '#FFFFFF',
        border: '1px solid #E5E7EB',
        borderRadius: 16,
        padding: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        position: 'relative',
      }}>
        {/* Title row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#0F1117' }}>Your Journey</span>
          <span style={{ fontSize: 11, color: '#9CA3AF' }}>Jan 2025 &rarr; Today</span>
        </div>

        {/* Vertical timeline connector line */}
        <div style={{
          position: 'absolute',
          left: 19,
          top: 44,
          bottom: 16,
          width: 1,
          background: '#E5E7EB',
        }} />

        {/* Milestone rows — date bold + primary, milestone text secondary */}
        {milestones.map((m, i) => (
          <div
            key={m.date ?? `milestone-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: i < milestones.length - 1 ? 12 : 0,
            }}
          >
            {/* Dot */}
            {m.reached ? (
              <div style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#16A34A',
                boxShadow: '0 0 0 3px #DCFCE7',
                flexShrink: 0,
              }} />
            ) : (
              <div style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#E5E7EB',
                flexShrink: 0,
              }} />
            )}
            {/* Milestone text — secondary */}
            <span style={{
              flex: 1,
              fontSize: 13,
              color: m.reached ? '#6B7280' : '#9CA3AF',
              fontWeight: 400,
            }}>
              {m.text}
            </span>
            {/* Date — bold, primary color */}
            <span style={{
              fontSize: 12,
              color: m.reached ? '#0F1117' : '#9CA3AF',
              fontWeight: m.reached ? 700 : 400,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}>
              {m.date}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ProfileStatusBar ──────────────────────────────────────────────────────────

function ProfileStatusBar({ clockTime, batteryFillWidth }: { clockTime: string; batteryFillWidth: number }) {
  return (
    <div
      style={{
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: 20,
        paddingRight: 20,
        flexShrink: 0,
        background: '#F8F9FB',
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 600, color: '#0F1117', letterSpacing: '-0.2px' }}>
        {clockTime}
      </span>
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
          <rect x="2" y="2" width={`${batteryFillWidth}`} height="8" rx="2" fill="#0F1117" />
          <path d="M22.5 4 L22.5 8" stroke="#0F1117" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

// ─── ProfileHeader ─────────────────────────────────────────────────────────────

function ProfileHeader({ initials, name, email, joinDateFormatted, weekNum, totalCaptures }: {
  initials: string; name: string; email: string;
  joinDateFormatted: string; weekNum: number; totalCaptures: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 24,
        paddingBottom: 28,
      }}
    >
      <div
        title="Photo upload coming soon"
        style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'linear-gradient(135deg, #1D4ED8, #2563EB)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
        }}
      >
        <div style={{
          width: 72, height: 72, borderRadius: '50%', background: '#2563EB',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(37,99,235,0.3)',
        }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: '#FFFFFF' }}>{initials}</span>
        </div>
      </div>
      <h2 style={{ fontSize: 24, fontWeight: 800, color: '#0F1117', margin: 0, marginBottom: 4, letterSpacing: '-0.4px' }}>
        {name}
      </h2>
      <p style={{ fontSize: 14, color: '#9CA3AF', margin: 0, marginBottom: 4 }}>{email}</p>
      <p style={{ fontSize: 11, color: '#9CA3AF', margin: 0, marginBottom: 12 }}>Member since {joinDateFormatted}</p>
      <span style={{
        fontSize: 12, fontWeight: 600, color: '#2563EB',
        background: 'linear-gradient(135deg, #EFF6FF, #F5F3FF)', border: '1px solid #DBEAFE',
        paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5,
        borderRadius: 20, flexWrap: 'nowrap', whiteSpace: 'nowrap',
      }}>
        Week {weekNum} · {totalCaptures} captures
      </span>
    </div>
  );
}

// ─── ProfileStatsCard ──────────────────────────────────────────────────────────

function ProfileStatsCard({ totalCaptures, currentStreak, longestStreak, hoursCoached }: {
  totalCaptures: number; currentStreak: number; longestStreak: number; hoursCoached: number;
}) {
  const STAT_CELLS = [
    { label: 'Total Captures', value: String(totalCaptures),  bg: '#EFF6FF', color: '#2563EB' },
    { label: 'Current Streak', value: `${currentStreak}d`,    bg: '#FFF7ED', color: '#EA580C' },
    { label: 'Longest Streak', value: `${longestStreak}d`,    bg: '#FEF3C7', color: '#D97706' },
    { label: 'Hours Captured', value: `${hoursCoached}h`,     bg: '#F0FDF4', color: '#16A34A' },
  ];
  return (
    <div style={{ marginBottom: 20 }}>
      <SectionHeader title="Stats" />
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          {STAT_CELLS.map((stat, i) => (
            <div
              key={stat.label}
              style={{
                padding: '16px 16px',
                background: stat.bg,
                borderRight: i % 2 === 0 ? '1px solid #F3F4F6' : 'none',
                borderBottom: i < 2 ? '1px solid #F3F4F6' : 'none',
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 800, color: stat.color, letterSpacing: '-0.5px', marginBottom: 2 }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 500 }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── AppSettingsCard ───────────────────────────────────────────────────────────

interface AppSettingsCardProps {
  notifications: boolean;
  autoStart: boolean;
  sensitivity: number;
  onToggleNotifications: () => void;
  onToggleAutoStart: () => void;
  onSetSensitivity: (v: number) => void;
}

function AppSettingsCard({
  notifications, autoStart, sensitivity,
  onToggleNotifications, onToggleAutoStart, onSetSensitivity,
}: AppSettingsCardProps) {
  return (
    <div style={{ marginBottom: 20 }}>
      <SectionHeader title="App Settings" />
      <Card>
        {/* Passive Recording — always-on green toggle */}
        <div style={{ paddingTop: 13, paddingBottom: 0, paddingLeft: 16, paddingRight: 16, borderBottom: '1px solid #F3F4F6' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingBottom: 4 }}>
            <span style={{ fontSize: 14, color: '#0F1117', fontWeight: 600 }}>Passive Recording</span>
            <div style={{ width: 44, height: 24, borderRadius: 12, background: '#16A34A', position: 'relative', flexShrink: 0, cursor: 'default' }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#FFFFFF', position: 'absolute', top: 2, left: 22, boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
            </div>
          </div>
          <p style={{ fontSize: 11, color: '#9CA3AF', margin: 0, lineHeight: 1.5, paddingBottom: 10 }}>
            Pendant captures conversations automatically
          </p>
        </div>
        <SettingRow
          label="Notifications"
          right={<BlueToggle on={notifications} onToggle={onToggleNotifications} />}
        />
        <div style={{ paddingLeft: 16, paddingRight: 16, paddingBottom: 10, borderBottom: '1px solid #F3F4F6' }}>
          <p style={{ fontSize: 11, color: '#9CA3AF', margin: 0, lineHeight: 1.5 }}>
            Receive reminders to practice and celebrate streak milestones.
          </p>
        </div>
        <SettingRow
          label="Session Auto-Start"
          right={<BlueToggle on={autoStart} onToggle={onToggleAutoStart} />}
        />
        <div style={{ paddingLeft: 16, paddingRight: 16, paddingBottom: 10, borderBottom: '1px solid #F3F4F6' }}>
          <p style={{ fontSize: 11, color: '#9CA3AF', margin: 0, lineHeight: 1.5 }}>
            Automatically begins recording when the pendant detects conversation.
          </p>
        </div>
        <SettingRow
          label="Coach Sensitivity"
          borderBottom={false}
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 140 }}>
              <span style={{ fontSize: 10, color: '#9CA3AF', flexShrink: 0 }}>Less</span>
              <input
                type="range" min={0} max={100} value={sensitivity}
                onChange={e => onSetSensitivity(Number(e.target.value))}
                style={{ flex: 1, accentColor: '#2563EB', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 10, color: '#9CA3AF', flexShrink: 0 }}>More</span>
              <span style={{ fontSize: 13, color: '#6B7280', minWidth: 30, textAlign: 'right' }}>{sensitivity}%</span>
            </div>
          }
        />
        <div style={{ paddingLeft: 16, paddingRight: 16, paddingBottom: 12 }}>
          <p style={{ fontSize: 11, color: '#9CA3AF', margin: 0, lineHeight: 1.5 }}>
            Higher sensitivity means more frequent haptic coaching cues during sessions.
          </p>
        </div>
      </Card>
    </div>
  );
}

// ─── PrivacySettingsCard ───────────────────────────────────────────────────────

function PrivacySettingsCard({ rawAudio, dataSharing, onToggleRawAudio, onToggleDataSharing }: {
  rawAudio: boolean; dataSharing: boolean;
  onToggleRawAudio: () => void; onToggleDataSharing: () => void;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <SectionHeader title="Privacy Settings" />
      <Card>
        <SettingRow
          label="Audio Processing"
          right={
            <span style={{ fontSize: 12, fontWeight: 600, color: '#16A34A', display: 'flex', alignItems: 'center', gap: 4 }}>
              On-device only
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ display: 'block' }}>
                <circle cx="6.5" cy="6.5" r="6.5" fill="#16A34A" />
                <path d="M3.5 6.5 L5.5 8.5 L9.5 4.5" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          }
        />
        <SettingRow
          label="Raw Audio Storage"
          right={
            <>
              <span style={{ fontSize: 12, color: '#6B7280' }}>{rawAudio ? 'Stores locally' : 'Never stored'}</span>
              <BlueToggle on={rawAudio} onToggle={onToggleRawAudio} />
            </>
          }
        />
        <SettingRow
          label="Data Sharing"
          borderBottom={false}
          right={
            <>
              <span style={{ fontSize: 12, color: '#6B7280' }}>{dataSharing ? 'Anonymized' : 'Not shared'}</span>
              <BlueToggle on={dataSharing} onToggle={onToggleDataSharing} />
            </>
          }
        />
      </Card>
    </div>
  );
}

// ─── HapticSettingsCard ────────────────────────────────────────────────────────

function HapticSettingsCard({ haptic, onToggleHaptic }: { haptic: boolean; onToggleHaptic: () => void }) {
  const COACHING_PATTERNS = [
    { pattern: '· slow pulse',     meaning: 'Slow down'    },
    { pattern: '·· double pulse',  meaning: 'Your turn'    },
    { pattern: '··· triple pulse', meaning: 'Great moment' },
  ];
  return (
    <div style={{ marginBottom: 20 }}>
      <SectionHeader title="Haptic Coaching" />
      <Card>
        <SettingRow
          label="Haptic Feedback"
          right={<BlueToggle on={haptic} onToggle={onToggleHaptic} />}
        />
        <div style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 16, background: '#F8F9FB', borderTop: '1px solid #F3F4F6' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', margin: 0, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.7px' }}>
            Coaching Patterns
          </p>
          {COACHING_PATTERNS.map((row, i, arr) => (
            <div
              key={row.pattern}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: i < arr.length - 1 ? 8 : 0 }}
            >
              <span style={{ fontSize: 13, color: '#6B7280', fontFamily: 'monospace', fontWeight: 600, letterSpacing: '1.5px' }}>
                {row.pattern}
              </span>
              <span style={{ fontSize: 12, color: '#6B7280', background: '#F3F4F6', paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 20 }}>
                {row.meaning}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── DataManagementCard ────────────────────────────────────────────────────────

function DataManagementCard({ onExport, onDelete }: { onExport: () => void; onDelete: () => void }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <SectionHeader title="Data Management" />
      <Card>
        <div
          role="button" tabIndex={0}
          onClick={onExport}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onExport(); }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, paddingBottom: 14, paddingLeft: 16, paddingRight: 16, borderBottom: '1px solid #F3F4F6', cursor: 'pointer' }}
        >
          <span style={{ fontSize: 14, color: '#2563EB', fontWeight: 600 }}>Export My Data</span>
          <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
            <path d="M1 1L6 6L1 11" stroke="#2563EB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div
          role="button" tabIndex={0}
          onClick={onDelete}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onDelete(); }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, paddingBottom: 14, paddingLeft: 16, paddingRight: 16, cursor: 'pointer' }}
        >
          <span style={{ fontSize: 14, color: '#D97706', fontWeight: 600 }}>Delete Account</span>
          <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
            <path d="M1 1L6 6L1 11" stroke="#D97706" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </Card>
    </div>
  );
}

// ─── ProfileFooter ─────────────────────────────────────────────────────────────

function ProfileFooter({ onTapVersion, onShowTerms, onShowPrivacy }: {
  onTapVersion: () => void; onShowTerms: () => void; onShowPrivacy: () => void;
}) {
  return (
    <div style={{ textAlign: 'center' }}>
      <p
        role="button" tabIndex={0}
        style={{ fontSize: 12, color: '#9CA3AF', margin: 0, marginBottom: 4, cursor: 'default' }}
        title="Tap 5 times for debug mode"
        onClick={onTapVersion}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onTapVersion(); }}
      >
        Tizzy · v0.4 demo
      </p>
      <p style={{ fontSize: 10, color: '#E5E7EB', margin: 0, marginBottom: 4 }}>
        © 2026 Tizzy, Inc.
      </p>
      <p style={{ fontSize: 12, margin: 0 }}>
        <span
          role="button" tabIndex={0}
          onClick={onShowTerms}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onShowTerms(); }}
          style={{ color: '#9CA3AF', cursor: 'pointer', textDecoration: 'underline' }}
        >
          Terms
        </span>
        <span style={{ color: '#9CA3AF' }}>{' · '}</span>
        <span
          role="button" tabIndex={0}
          onClick={onShowPrivacy}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onShowPrivacy(); }}
          style={{ color: '#9CA3AF', cursor: 'pointer', textDecoration: 'underline' }}
        >
          Privacy
        </span>
      </p>
    </div>
  );
}

// ─── LegalModal ───────────────────────────────────────────────────────────────

function LegalModal({ modal, onClose }: { modal: 'terms' | 'privacy'; onClose: () => void }) {
  return (
    <div
      role="button" tabIndex={0}
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }}
    >
      <div
        role="button" tabIndex={0}
        onClick={e => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); }}
        style={{ width: '100%', background: '#FFFFFF', borderRadius: '22px 22px 0 0', padding: '20px 22px 36px', maxHeight: '70%', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F1117', margin: 0 }}>
            {modal === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', padding: 4, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>
        {modal === 'terms' ? (
          <div>
            <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, margin: 0, marginBottom: 12 }}>
              Tizzy is a demo application for conversation coaching. By using this app, you agree to our terms.
            </p>
            <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, margin: 0, marginBottom: 12 }}>
              This demo does not collect real user data. All session data is simulated for demonstration purposes.
            </p>
            <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, margin: 0 }}>
              © 2026 Tizzy. All rights reserved.
            </p>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, margin: 0, marginBottom: 12 }}>
              We take your privacy seriously. This demo app does not transmit personal data to any servers.
            </p>
            <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, margin: 0, marginBottom: 12 }}>
              Session recordings are processed locally on your device. No audio data leaves your phone.
            </p>
            <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, margin: 0 }}>
              For questions, contact privacy@tizzy.app
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── LogoutModal ───────────────────────────────────────────────────────────────

function LogoutModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm?: () => void }) {
  return (
    <div
      role="button" tabIndex={0}
      onClick={onCancel}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }}
    >
      <div
        role="button" tabIndex={0}
        onClick={e => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); }}
        style={{ width: '100%', background: '#FFFFFF', borderRadius: '22px 22px 0 0', padding: '24px 22px 36px' }}
      >
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F1117', margin: '0 0 8px 0' }}>Log out?</h3>
        <p style={{ fontSize: 14, color: '#6B7280', margin: '0 0 20px 0' }}>You can log back in anytime.</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{ flex: 1, height: 48, borderRadius: 14, background: '#F3F4F6', border: 'none', fontSize: 15, fontWeight: 600, color: '#6B7280', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={onConfirm} style={{ flex: 1, height: 48, borderRadius: 14, background: '#D97706', border: 'none', fontSize: 15, fontWeight: 700, color: '#FFFFFF', cursor: 'pointer', fontFamily: 'inherit' }}>Log Out</button>
        </div>
      </div>
    </div>
  );
}

// ─── Profile Screen ────────────────────────────────────────────────────────────

// ─── ProfileScreen reducer ────────────────────────────────────────────────────

interface ProfileSettings {
  rawAudio: boolean;
  dataSharing: boolean;
  haptic: boolean;
  notifications: boolean;
  autoStart: boolean;
  sensitivity: number;
}

interface ProfileUiState {
  showModal: 'terms' | 'privacy' | null;
  toast: string | null;
  confirmLogout: boolean;
  versionTaps: number;
}

type ProfileState = ProfileSettings & ProfileUiState;

type ProfileAction =
  | { type: 'TOGGLE_RAW_AUDIO' }
  | { type: 'TOGGLE_DATA_SHARING' }
  | { type: 'TOGGLE_HAPTIC' }
  | { type: 'TOGGLE_NOTIFICATIONS' }
  | { type: 'TOGGLE_AUTO_START' }
  | { type: 'SET_SENSITIVITY'; value: number }
  | { type: 'SHOW_MODAL'; modal: 'terms' | 'privacy' | null }
  | { type: 'SHOW_TOAST'; message: string }
  | { type: 'CLEAR_TOAST' }
  | { type: 'SET_CONFIRM_LOGOUT'; value: boolean }
  | { type: 'TAP_VERSION' }
  | { type: 'LOAD_SETTINGS'; settings: Partial<ProfileSettings> };

function profileReducer(state: ProfileState, action: ProfileAction): ProfileState {
  switch (action.type) {
    case 'TOGGLE_RAW_AUDIO':    return { ...state, rawAudio: !state.rawAudio };
    case 'TOGGLE_DATA_SHARING': return { ...state, dataSharing: !state.dataSharing };
    case 'TOGGLE_HAPTIC':       return { ...state, haptic: !state.haptic };
    case 'TOGGLE_NOTIFICATIONS':return { ...state, notifications: !state.notifications };
    case 'TOGGLE_AUTO_START':   return { ...state, autoStart: !state.autoStart };
    case 'SET_SENSITIVITY':     return { ...state, sensitivity: action.value };
    case 'SHOW_MODAL':          return { ...state, showModal: action.modal };
    case 'SHOW_TOAST':          return { ...state, toast: action.message };
    case 'CLEAR_TOAST':         return { ...state, toast: null };
    case 'SET_CONFIRM_LOGOUT':  return { ...state, confirmLogout: action.value };
    case 'TAP_VERSION': {
      const taps = state.versionTaps + 1;
      if (taps >= 5) return { ...state, versionTaps: 0, toast: 'You found the debug mode!' };
      return { ...state, versionTaps: taps };
    }
    case 'LOAD_SETTINGS':       return { ...state, ...action.settings };
    default:                    return state;
  }
}

const INITIAL_PROFILE_STATE: ProfileState = {
  rawAudio: false, dataSharing: false, haptic: true, notifications: false,
  autoStart: false, sensitivity: 70, showModal: null, toast: null,
  confirmLogout: false, versionTaps: 0,
};

interface ProfileScreenProps {
  onLogOut?: () => void;
}

export default function ProfileScreen({ onLogOut }: ProfileScreenProps) {
  const { user } = demoData;

  const [profileState, dispatch] = useReducer(profileReducer, INITIAL_PROFILE_STATE);
  const { rawAudio, dataSharing, haptic, notifications, autoStart, sensitivity, showModal, toast, confirmLogout } = profileState;
  const [clockTime, setClockTime] = useState('');

  const joinDateFormatted = new Date(demoData.user.joinDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const joinDate = new Date(demoData.user.joinDate);
  const weekNum  = Math.max(1, Math.floor((Date.now() - joinDate.getTime()) / 604800000) + 1);

  // Load persisted toggle states from sessionStorage on mount
  useEffect(() => {
    const saved = sessionStorage.getItem('tz_profile_settings');
    if (saved) {
      try {
        const s = JSON.parse(saved);
        dispatch({ type: 'LOAD_SETTINGS', settings: s });
      } catch {}
    }
  }, []);

  // Persist toggle states to sessionStorage on every change
  useEffect(() => {
    sessionStorage.setItem('tz_profile_settings', JSON.stringify({
      rawAudio, dataSharing, haptic, notifications, autoStart, sensitivity,
    }));
  }, [rawAudio, dataSharing, haptic, notifications, autoStart, sensitivity]);

  const showToast = (msg: string) => {
    dispatch({ type: 'SHOW_TOAST', message: msg });
    setTimeout(() => dispatch({ type: 'CLEAR_TOAST' }), 2500);
  };

  // Live clock
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

  const batteryFillWidth = (demoData.device.battery / 100) * 17;
  const totalCaptures = demoData.user.totalSessions ?? demoData.sessions.length;

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: '#F8F9FB', fontFamily: 'var(--font-dm-sans), var(--font-inter), system-ui, sans-serif',
      overflow: 'hidden',
    }}>
      <ProfileStatusBar clockTime={clockTime} batteryFillWidth={batteryFillWidth} />

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
        <div style={{ padding: 20, paddingBottom: 36 }}>
          <ProfileHeader
            initials={user.initials}
            name={user.name}
            email={user.email}
            joinDateFormatted={joinDateFormatted}
            weekNum={weekNum}
            totalCaptures={totalCaptures}
          />
          <ProfileStatsCard
            totalCaptures={totalCaptures}
            currentStreak={user.currentStreak}
            longestStreak={user.longestStreak ?? 0}
            hoursCoached={Math.round((user.totalMinutesCoached ?? 0) / 60)}
          />
          <AchievementsSection />
          <AppSettingsCard
            notifications={notifications}
            autoStart={autoStart}
            sensitivity={sensitivity}
            onToggleNotifications={() => dispatch({ type: 'TOGGLE_NOTIFICATIONS' })}
            onToggleAutoStart={() => dispatch({ type: 'TOGGLE_AUTO_START' })}
            onSetSensitivity={(v) => dispatch({ type: 'SET_SENSITIVITY', value: v })}
          />
          <PrivacySettingsCard
            rawAudio={rawAudio}
            dataSharing={dataSharing}
            onToggleRawAudio={() => dispatch({ type: 'TOGGLE_RAW_AUDIO' })}
            onToggleDataSharing={() => dispatch({ type: 'TOGGLE_DATA_SHARING' })}
          />
          <HapticSettingsCard haptic={haptic} onToggleHaptic={() => dispatch({ type: 'TOGGLE_HAPTIC' })} />
          <DataManagementCard
            onExport={() => showToast('Export feature coming soon')}
            onDelete={() => showToast('Account deletion requires email confirmation. Check your inbox.')}
          />
          <button
            onClick={() => dispatch({ type: 'SET_CONFIRM_LOGOUT', value: true })}
            style={{
              width: '100%', height: 48, borderRadius: 14, background: '#FFFFFF',
              border: '1.5px solid #E5E7EB', cursor: 'pointer', fontSize: 15, fontWeight: 600,
              color: '#EF4444', fontFamily: 'inherit', marginBottom: 28,
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            Log Out
          </button>
          <ProfileFooter
            onTapVersion={() => dispatch({ type: 'TAP_VERSION' })}
            onShowTerms={() => dispatch({ type: 'SHOW_MODAL', modal: 'terms' })}
            onShowPrivacy={() => dispatch({ type: 'SHOW_MODAL', modal: 'privacy' })}
          />
        </div>
      </div>

      {/* Toast notification */}
      <div style={{
        position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
        background: '#0F1117', color: '#FFFFFF', fontSize: 13, fontWeight: 500,
        paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 10,
        borderRadius: 20, pointerEvents: 'none', whiteSpace: 'nowrap',
        opacity: toast ? 1 : 0, transition: 'opacity 0.3s ease', zIndex: 300,
      }}>
        {toast}
      </div>

      {showModal && (
        <LegalModal
          modal={showModal}
          onClose={() => dispatch({ type: 'SHOW_MODAL', modal: null })}
        />
      )}

      {confirmLogout && (
        <LogoutModal
          onCancel={() => dispatch({ type: 'SET_CONFIRM_LOGOUT', value: false })}
          onConfirm={onLogOut}
        />
      )}
    </div>
  );
}
