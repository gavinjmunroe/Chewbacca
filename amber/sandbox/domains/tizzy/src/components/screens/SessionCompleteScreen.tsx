"use client";

import { useEffect, useState } from 'react';

interface SessionResult {
  duration: number;
  env: string;
  metrics: { speechClarity: number; paceConsistency: number; vocalVariety: number; turnTaking: number };
}

interface SessionCompleteScreenProps {
  result: SessionResult;
  onDone: () => void;
}

// Metric display names and colors per spec
const METRIC_CONFIG: Record<string, { label: string; color: string }> = {
  speechClarity:   { label: 'Vocal Clarity',      color: '#2563EB' },
  paceConsistency: { label: 'Speaking Pace',       color: '#2563EB' },
  vocalVariety:    { label: 'Vocal Range',         color: '#2563EB' },
  turnTaking:      { label: 'Conversational Flow', color: '#2563EB' },
};

function scoreTier(score: number): { label: string; color: string } {
  if (score >= 85) return { label: 'Excellent', color: '#16A34A' };
  if (score >= 75) return { label: 'Good',      color: '#2563EB' };
  if (score >= 65) return { label: 'Fair',       color: '#D97706' };
  return                  { label: 'Needs Work', color: '#D97706' };
}

// Issue 79 - letter grade helper
function letterGrade(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 80) return 'B+';
  if (score >= 75) return 'B';
  if (score >= 70) return 'C+';
  if (score >= 65) return 'C';
  return 'D';
}

function insightBlurb(metrics: Record<string, number>, score: number): string {
  const entries = Object.entries(metrics).sort(([, a], [, b]) => b - a);
  const bestKey = entries[0][0];
  const worstKey = entries[entries.length - 1][0];
  const bestLabel  = METRIC_CONFIG[bestKey]?.label  ?? bestKey.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
  const worstLabel = METRIC_CONFIG[worstKey]?.label ?? worstKey.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
  if (score >= 85) return `Excellent session. Your ${bestLabel} was the standout. Keep building on that momentum.`;
  if (score >= 75) return `Good work. Focus on ${worstLabel} next session to push above 85.`;
  return `Nice effort. Your ${bestLabel} showed promise. Try slowing your pace and pausing more.`;
}


export default function SessionCompleteScreen({ result, onDone }: SessionCompleteScreenProps) {
  const [visible, setVisible] = useState(false);
  const [shareToast, setShareToast] = useState(false);
  // Issue 82 - press state for the primary CTA button
  const [donePressed, setDonePressed] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(id);
  }, []);

  const mins = Math.floor(result.duration / 60);
  const secs = Math.round(result.duration % 60);
  let timeStr: string;
  if (result.duration < 60) {
    timeStr = 'Less than a minute';
  } else if (result.duration === 60) {
    timeStr = '1 minute';
  } else if (secs === 0) {
    timeStr = `${mins}m`;
  } else {
    timeStr = `${mins}m ${secs}s`;
  }

  const avgScore = Math.round(
    Object.values(result.metrics).reduce((a, b) => a + b, 0) / 4
  );

  const tier = scoreTier(avgScore);

  const headline = 'Coaching Session Complete';

  const envDisplay = result.env.replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(160deg, #0B1120 0%, #0F1F40 60%, #1a3a6b 100%)',
      fontFamily: 'var(--font-dm-sans), var(--font-inter), system-ui, sans-serif',
      padding: '32px 24px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <style>{`
        @keyframes popIn { 0%{opacity:0;transform:scale(0.85)} 60%{transform:scale(1.04)} 100%{opacity:1;transform:scale(1)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes confettiDot0{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-60px) translateX(-20px)}}
        @keyframes confettiDot1{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-80px) translateX(-10px)}}
        @keyframes confettiDot2{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-70px) translateX(0px)}}
        @keyframes confettiDot3{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-80px) translateX(10px)}}
        @keyframes confettiDot4{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-60px) translateX(20px)}}
      `}</style>

      {/* Subtle bg circles */}
      <div style={{ position:'absolute', width:280, height:280, borderRadius:'50%', background:'rgba(37,99,235,0.08)', top:'5%', left:'-20%', pointerEvents:'none' }} />
      <div style={{ position:'absolute', width:200, height:200, borderRadius:'50%', background:'rgba(22,163,74,0.06)', bottom:'10%', right:'-10%', pointerEvents:'none' }} />

      {/* Check circle with position context for confetti */}
      <div style={{ position: 'relative', marginBottom: 20 }}>
        <div style={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: 'rgba(22,163,74,0.15)',
          border: '2px solid rgba(22,163,74,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: visible ? 'popIn 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards' : 'none',
          opacity: 0,
        }}>
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
            <path d="M7 17L14 24L27 10" stroke="#16A34A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        {avgScore >= 80 && visible && (
          <div style={{ position:'absolute', top:'25%', left:'50%', transform:'translateX(-50%)', pointerEvents:'none' }}>
            {(['#2563EB','#16A34A','#D97706','#1D4ED8','#3B82F6'] as string[]).map((color, i) => (
              <div key={color} style={{
                position:'absolute', width:8, height:8, borderRadius:'50%', background:color,
                left: `${(i-2)*20}px`, animation: `confettiDot${i} 1.2s ease ${0.4+i*0.08}s both`,
              }} />
            ))}
          </div>
        )}
      </div>

      {/* Issue 77 - dynamic headline: always "Coaching Session Complete" */}
      <h1 style={{
        fontSize: 26,
        fontWeight: 800,
        color: '#FFFFFF',
        margin: '0 0 6px 0',
        letterSpacing: '-0.04em',
        textAlign: 'center',
        animation: visible ? 'fadeUp 0.45s ease 0.15s both' : 'none',
      }}>
        {headline}
      </h1>

      <p style={{
        fontSize: 14,
        color: 'rgba(255,255,255,0.5)',
        margin: '0 0 4px 0',
        textAlign: 'center',
        animation: visible ? 'fadeUp 0.45s ease 0.2s both' : 'none',
      }}>
        {timeStr} · {envDisplay}
      </p>

      {/* Issue 83 - haptic vibration reference for high scores */}
      {avgScore >= 80 && (
        <p style={{
          fontSize: 12,
          color: 'rgba(255,255,255,0.35)',
          margin: '0 0 20px 0',
          textAlign: 'center',
          animation: visible ? 'fadeUp 0.45s ease 0.25s both' : 'none',
        }}>
          Tizzy vibrated {Math.round(avgScore / 15)} times during your session
        </p>
      )}
      {avgScore < 80 && (
        <div style={{ marginBottom: 20 }} />
      )}

      {/* Score card */}
      <div style={{
        width: '100%',
        background: 'rgba(255,255,255,0.05)',
        borderRadius: 18,
        border: '1px solid rgba(255,255,255,0.08)',
        padding: '18px 18px 14px',
        marginBottom: 14,
        animation: visible ? 'fadeUp 0.45s ease 0.25s both' : 'none',
      }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 14 }}>
          <span style={{ fontSize:12, fontWeight:700, color:'rgba(255,255,255,0.4)', textTransform:'uppercase', letterSpacing:'0.8px' }}>
            Session Score
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            <span style={{ fontSize:22, fontWeight:800, color: tier.color, letterSpacing:'-0.03em' }}>
              {avgScore}%
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: tier.color }}>
              {tier.label}
            </span>
            {/* Issue 79 - letter grade */}
            <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.35)' }}>
              {letterGrade(avgScore)}
            </span>
          </div>
        </div>

        {/* Issue 78 - metric bars animate in via visible state — metric colors for score numbers, unified blue for bar fills */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 18px' }}>
          {(Object.entries(result.metrics) as [string, number][]).map(([key, val]) => {
            const cfg = METRIC_CONFIG[key];
            const scoreColor = cfg?.color ?? '#2563EB';
            const label = cfg?.label ?? key;
            return (
              <div key={key}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <span style={{ fontSize:10, color:'rgba(255,255,255,0.45)', fontWeight:500 }}>{label}</span>
                  <span style={{ fontSize:11, fontWeight:700, color: scoreColor }}>{Math.round(val)}%</span>
                </div>
                <div style={{ height:4, borderRadius:2, background:'rgba(255,255,255,0.07)', overflow:'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: visible ? `${Math.round(val)}%` : '0%',
                    background: '#2563EB',
                    borderRadius: 2,
                    transition: 'width 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Coaching session context blurb */}
      <div style={{
        width: '100%',
        background: 'rgba(22,163,74,0.07)',
        borderRadius: 14,
        border: '1px solid rgba(22,163,74,0.15)',
        padding: '11px 14px',
        marginBottom: 28,
        animation: visible ? 'fadeUp 0.45s ease 0.32s both' : 'none',
      }}>
        <p style={{ fontSize:13, color:'rgba(255,255,255,0.6)', margin:'0 0 6px 0', lineHeight:1.5 }}>
          {insightBlurb(result.metrics, avgScore)}
        </p>
        <p style={{ fontSize:12, color:'rgba(255,255,255,0.4)', margin:0, lineHeight:1.5 }}>
          You just completed a focused practice session. Your pendant continues capturing conversations in the background.
        </p>
      </div>

      {/* Issue 82 - Primary CTA: "Back to Dashboard" */}
      <button
        onClick={onDone}
        onMouseDown={() => setDonePressed(true)}
        onMouseUp={() => setDonePressed(false)}
        onMouseLeave={() => setDonePressed(false)}
        onTouchStart={() => setDonePressed(true)}
        onTouchEnd={() => setDonePressed(false)}
        style={{
          width: '100%',
          height: 52,
          borderRadius: 16,
          background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',
          border: 'none',
          color: '#FFFFFF',
          fontSize: 16,
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'inherit',
          boxShadow: '0 4px 20px rgba(37,99,235,0.4)',
          animation: visible ? 'fadeUp 0.45s ease 0.4s both' : 'none',
          letterSpacing: '0.01em',
          transform: donePressed ? 'scale(0.97)' : 'scale(1)',
          transition: 'transform 0.1s ease',
        }}
      >
        Back to Dashboard
      </button>

      {/* Share Results */}
      <button
        onClick={() => {
          const best = Object.entries(result.metrics).sort(([, a], [, b]) => b - a)[0];
          const bestLabel = METRIC_CONFIG[best[0]]?.label ?? best[0].replace(/([A-Z])/g, ' $1').trim();
          const text = `Just finished a coaching session with Tizzy! Average score: ${avgScore}%. Best metric: ${bestLabel} at ${Math.round(best[1])}%.`;
          if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
          setShareToast(true);
          setTimeout(() => setShareToast(false), 2000);
        }}
        style={{
          width: '100%',
          height: 44,
          borderRadius: 16,
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.12)',
          color: 'rgba(255,255,255,0.6)',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
          marginTop: 10,
          animation: visible ? 'fadeUp 0.45s ease 0.48s both' : 'none',
          letterSpacing: '0.01em',
        }}
      >
        Share Results
      </button>

      {/* Toast */}
      {shareToast && (
        <div style={{
          position: 'absolute',
          bottom: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(30,40,60,0.95)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 12,
          padding: '10px 18px',
          fontSize: 13,
          fontWeight: 600,
          color: 'rgba(255,255,255,0.85)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>
          Results copied to clipboard
        </div>
      )}
    </div>
  );
}
