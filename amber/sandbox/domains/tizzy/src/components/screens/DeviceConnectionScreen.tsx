"use client";

import { useState, useEffect } from 'react';
import { demoData } from '../shared/demoData';

interface DeviceConnectionScreenProps {
  onConnected: () => void;
  onSkip: () => void;
}

// ─── Status Bar ───────────────────────────────────────────────────────────────

function StatusBar() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
          .replace(' AM', '')
          .replace(' PM', '')
      );
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  const [battery] = useState(demoData.device.battery);

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
      <span style={{ fontSize: 15, fontWeight: 600, color: '#0F1117', letterSpacing: '-0.2px' }}>
        {time}
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
        <span style={{ fontSize: 10, fontWeight: 600, color: '#0F1117' }}>{battery}%</span>
        <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="#0F1117" strokeWidth="1" />
          <rect x="2"   y="2"   width="16" height="8"  rx="2"   fill="#0F1117" />
          <path d="M22.5 4 L22.5 8" stroke="#0F1117" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

// ─── Step Indicator Dots ──────────────────────────────────────────────────────

function StepDots({ current }: { current: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 8, paddingBottom: 8 }}>
      {(['s0', 's1', 's2', 's3', 's4'] as const).map((stepId, stepIdx) => {
        const isActive    = stepIdx === current;
        const isCompleted = stepIdx < current;
        return (
          <div
            key={stepId}
            style={{
              width:      isActive ? 20 : 6,
              height:     6,
              borderRadius: 3,
              background: isActive
                ? '#2563EB'
                : isCompleted
                  ? 'rgba(37,99,235,0.5)'
                  : 'rgba(15,17,23,0.15)',
              transition: 'width 0.3s ease, background 0.3s ease',
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Pendant SVG — pulsing when searching ─────────────────────────────────────

function PendantIllustration({ pulse = false }: { pulse?: boolean }) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {pulse && (
        <style>{`
          @keyframes pendantPulse {
            0%, 100% { transform: scale(1);    opacity: 0.55; }
            50%      { transform: scale(1.18); opacity: 0.15; }
          }
          @keyframes pendantRing {
            0%   { transform: scale(0.6); opacity: 0.6; }
            100% { transform: scale(1.6); opacity: 0; }
          }
        `}</style>
      )}
      {/* Outer pulse rings when searching */}
      {pulse && (['ring-0', 'ring-1', 'ring-2'] as const).map((ringId, ringIdx) => (
        <div
          key={ringId}
          style={{
            position: 'absolute',
            width: 100,
            height: 100,
            borderRadius: '50%',
            border: '2px solid #2563EB',
            animation: `pendantRing 2.4s ease-out ${ringIdx * 0.8}s infinite`,
          }}
        />
      ))}
      <svg
        width="80"
        height="96"
        viewBox="0 0 80 96"
        fill="none"
        style={pulse ? { animation: 'pendantPulse 2s ease-in-out infinite' } : undefined}
      >
        <defs>
          <linearGradient id="pdGrad" x1="0" y1="0" x2="80" y2="96" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1E3A8A" />
            <stop offset="100%" stopColor="#0C1445" />
          </linearGradient>
          <linearGradient id="chainGrad2" x1="20" y1="0" x2="60" y2="28" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#3B5FC0" />
            <stop offset="100%" stopColor="#1E3A8A" />
          </linearGradient>
        </defs>
        {/* Chain arc */}
        <path d="M20 28 Q40 4 60 28" stroke="url(#chainGrad2)" strokeWidth="3" strokeLinecap="round" fill="none" />
        {/* Chain connector ring */}
        <ellipse cx="40" cy="28" rx="5" ry="3.5" fill="url(#chainGrad2)" />
        {/* Pendant body */}
        <ellipse cx="40" cy="65" rx="24" ry="27" fill="url(#pdGrad)" />
        {/* Subtle shine */}
        <ellipse cx="33" cy="52" rx="8" ry="6" fill="rgba(255,255,255,0.08)" />
        {/* Outer sensor ring */}
        <circle cx="40" cy="65" r="9" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" fill="none" />
        {/* Center sensor dot */}
        <circle cx="40" cy="65" r="5" fill="rgba(255,255,255,0.22)" />
        <circle cx="40" cy="65" r="2.5" fill="rgba(255,255,255,0.55)" />
      </svg>
    </div>
  );
}

// ─── Signal Strength Bars ─────────────────────────────────────────────────────

function SignalBars({ strength = 4 }: { strength?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2 }}>
      {(['bar-1', 'bar-2', 'bar-3', 'bar-4'] as const).map((barId, idx) => {
        const barStrength = idx + 1;
        return (
          <div
            key={barId}
            style={{
              width: 5,
              height: 4 + barStrength * 3,
              borderRadius: 2,
              background: barStrength <= strength ? '#16A34A' : '#E5E7EB',
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Spinning Arc ─────────────────────────────────────────────────────────────

function SpinningArc() {
  return (
    <div style={{ width: 80, height: 80, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{`
        @keyframes spinArc {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
      <div style={{ animation: 'spinArc 1s linear infinite', position: 'absolute' }}>
        <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
          <circle cx="40" cy="40" r="34" stroke="#E5E7EB" strokeWidth="5" />
          <path d="M40 6 A34 34 0 0 1 74 40" stroke="#2563EB" strokeWidth="5" strokeLinecap="round" fill="none" />
        </svg>
      </div>
      {/* Pendant mini icon in center */}
      <svg width="28" height="34" viewBox="0 0 80 100" fill="none" style={{ zIndex: 1 }}>
        <ellipse cx="40" cy="65" rx="24" ry="28" fill="#1E3A8A" opacity="0.7" />
        <circle cx="40" cy="65" r="5" fill="rgba(255,255,255,0.3)" />
      </svg>
    </div>
  );
}

// ─── Green Checkmark ──────────────────────────────────────────────────────────

function GreenCheckmark() {
  return (
    <div style={{ position: 'relative' }}>
      <style>{`
        @keyframes checkPop {
          0%   { transform: scale(0.5); opacity: 0; }
          70%  { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1);   opacity: 1; }
        }
      `}</style>
      <div style={{ animation: 'checkPop 0.5s ease-out forwards' }}>
        <div style={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: '#F0FDF4',
          border: '2px solid #BBF7D0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <svg width="36" height="28" viewBox="0 0 36 28" fill="none">
            <path d="M3 14L13 24L33 4" stroke="#16A34A" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}

// ─── Haptic Pattern Row ───────────────────────────────────────────────────────

function HapticRow({ label, description }: { label: string; description: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 14px',
      background: '#FFFFFF',
      borderRadius: 12,
      border: '1px solid #E5E7EB',
      marginBottom: 8,
    }}>
      <div style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: '#EFF6FF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M9 2C9 2 5 5 5 9C5 11.76 6.79 14 9 14C11.21 14 13 11.76 13 9C13 5 9 2 9 2Z" fill="#2563EB" opacity="0.2" />
          <circle cx="9" cy="9" r="3" fill="#2563EB" />
        </svg>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#0F1117', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 11, color: '#6B7280' }}>{description}</div>
      </div>
    </div>
  );
}

// ─── Primary Button ───────────────────────────────────────────────────────────

function PrimaryButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        height: 52,
        background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',
        borderRadius: 16,
        border: 'none',
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}

// ─── Device Connection Screen ─────────────────────────────────────────────────

export default function DeviceConnectionScreen({ onConnected, onSkip }: DeviceConnectionScreenProps) {
  const [step, setStep] = useState(0);

  // Step 1 → step 2 after 2.5 s (device found)
  useEffect(() => {
    if (step === 1) {
      const t = setTimeout(() => setStep(2), 2500);
      return () => clearTimeout(t);
    }
  }, [step]);

  // Step 3 → step 4 after 1.8 s (pairing complete)
  useEffect(() => {
    if (step === 3) {
      const t = setTimeout(() => setStep(4), 1800);
      return () => clearTimeout(t);
    }
  }, [step]);

  // Step 4 auto-advance to onConnected after 1000ms
  useEffect(() => {
    if (step === 4) {
      const id = setTimeout(onConnected, 1000);
      return () => clearTimeout(id);
    }
  }, [step, onConnected]);

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
      <StatusBar />
      <StepDots current={step} />

      {/* Main content area */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 28px',
      }}>

        {/* STEP 0: Ready to connect */}
        {step === 0 && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
            <PendantIllustration pulse={false} />
            <div style={{ textAlign: 'center' }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F1117', margin: '0 0 10px 0', letterSpacing: '-0.03em', lineHeight: 1.2 }}>
                Connect Your Tizzy
              </h1>
              <p style={{ fontSize: 14, color: '#6B7280', margin: 0, lineHeight: 1.6 }}>
                Your pendant will automatically sync conversations throughout the day
              </p>
            </div>
            <div style={{ width: '100%', marginTop: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <PrimaryButton label="Pair New Device" onClick={() => setStep(1)} />
              <button
                onClick={onConnected}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 13,
                  color: '#6B7280',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  padding: '4px 8px',
                  fontWeight: 500,
                }}
              >
                I already have Tizzy
              </button>
            </div>
          </div>
        )}

        {/* STEP 1: Searching — pendant pulses */}
        {step === 1 && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
            <PendantIllustration pulse={true} />
            <div style={{ textAlign: 'center' }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F1117', margin: '0 0 10px 0', letterSpacing: '-0.03em', lineHeight: 1.2 }}>
                Searching nearby...
              </h1>
              <p style={{ fontSize: 14, color: '#6B7280', margin: 0, lineHeight: 1.6 }}>
                Looking for your Tizzy Pendant via Bluetooth.
              </p>
            </div>
          </div>
        )}

        {/* STEP 2: Device found */}
        {step === 2 && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
            {/* Device card */}
            <div style={{
              width: '100%',
              background: '#FFFFFF',
              borderRadius: 20,
              border: '1px solid #E5E7EB',
              padding: '20px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}>
              <div style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: 'linear-gradient(145deg, #1E3A8A 0%, #0C1445 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg width="24" height="30" viewBox="0 0 80 100" fill="none">
                  <ellipse cx="40" cy="65" rx="24" ry="28" fill="rgba(255,255,255,0.3)" />
                  <circle cx="40" cy="65" r="5" fill="rgba(255,255,255,0.7)" />
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0F1117', marginBottom: 4 }}>
                  Tizzy Pendant
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#16A34A' }} />
                  <span style={{ fontSize: 12, color: '#16A34A', fontWeight: 600 }}>Available</span>
                </div>
              </div>
              <SignalBars strength={4} />
            </div>

            <div style={{ textAlign: 'center' }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F1117', margin: '0 0 10px 0', letterSpacing: '-0.03em', lineHeight: 1.2 }}>
                Device found
              </h1>
              <p style={{ fontSize: 14, color: '#6B7280', margin: 0, lineHeight: 1.6 }}>
                Your Tizzy Pendant is nearby and ready to pair.
              </p>
            </div>
            <div style={{ width: '100%', marginTop: 4 }}>
              <PrimaryButton label="Connect" onClick={() => setStep(3)} />
            </div>
          </div>
        )}

        {/* STEP 3: Pairing — auto-advances, no controls */}
        {step === 3 && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
            <SpinningArc />
            <div style={{ textAlign: 'center' }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F1117', margin: '0 0 10px 0', letterSpacing: '-0.03em', lineHeight: 1.2 }}>
                Pairing...
              </h1>
              <p style={{ fontSize: 14, color: '#6B7280', margin: 0, lineHeight: 1.6 }}>
                Establishing a secure connection to your pendant.
              </p>
            </div>
          </div>
        )}

        {/* STEP 4: Connected */}
        {step === 4 && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
            <GreenCheckmark />
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F1117', margin: '0 0 6px 0', letterSpacing: '-0.03em', lineHeight: 1.2 }}>
                Tizzy Connected
              </h1>
              <p style={{ fontSize: 13, color: '#16A34A', fontWeight: 600, margin: 0 }}>
                Auto-recording begins now. Your first captures will appear within the hour.
              </p>
            </div>

            {/* Haptic patterns legend */}
            <div style={{ width: '100%' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Haptic Patterns
              </p>
              <HapticRow label="Single pulse" description="New coaching hint available" />
              <HapticRow label="Double pulse" description="Great job. Keep it up!" />
              <HapticRow label="Triple pulse" description="Slow down your pace" />
            </div>

            <div style={{ width: '100%', marginTop: 4 }}>
              <PrimaryButton label="Start using Tizzy" onClick={onConnected} />
            </div>
          </div>
        )}
      </div>

      {/* Set up later — only at steps 0-2 */}
      {step <= 2 && (
        <div style={{ padding: '16px 28px 32px', display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={onSkip}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 14,
              color: '#6B7280',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 500,
              padding: '4px 8px',
            }}
          >
            Set up later
          </button>
        </div>
      )}

      {/* Spacer at steps 3 & 4 */}
      {step > 2 && <div style={{ height: 48 }} />}
    </div>
  );
}
