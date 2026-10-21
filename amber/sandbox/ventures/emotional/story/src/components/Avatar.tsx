"use client";

interface AvatarProps {
  userId: string;
  color: string;
  size?: number;
  border?: string;
}

function AvatarIcon({ userId, size }: { userId: string; size: number }) {
  const s = size * 0.45;
  const c = `${size / 2}`;
  const iconColor = "rgba(255,255,255,0.85)";

  switch (userId) {
    case "caleb":
      // Compass: circle + crosshairs
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="8" stroke={iconColor} strokeWidth="1.6"/>
          <line x1="10" y1="2" x2="10" y2="18" stroke={iconColor} strokeWidth="1.4" strokeLinecap="round"/>
          <line x1="2" y1="10" x2="18" y2="10" stroke={iconColor} strokeWidth="1.4" strokeLinecap="round"/>
          <circle cx="10" cy="10" r="2" fill={iconColor}/>
        </svg>
      );
    case "marcus":
      // Open book
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <path d="M10 5v12M10 5C10 5 7 3 4 4v11c3-1 6 1 6 1M10 5c0 0 3-2 6-1v11c-3-1-6 1-6 1" stroke={iconColor} strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
      );
    case "priya":
      // Diamond / gem
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <path d="M10 2L18 8L10 18L2 8Z" stroke={iconColor} strokeWidth="1.6" strokeLinejoin="round"/>
          <path d="M2 8h16" stroke={iconColor} strokeWidth="1.2"/>
          <path d="M6 8L10 2M14 8L10 2" stroke={iconColor} strokeWidth="1.2"/>
        </svg>
      );
    case "daniel":
      // Waveform bars
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <rect x="2" y="8" width="2.5" height="4" rx="1.2" fill={iconColor}/>
          <rect x="6" y="5" width="2.5" height="10" rx="1.2" fill={iconColor}/>
          <rect x="10" y="3" width="2.5" height="14" rx="1.2" fill={iconColor}/>
          <rect x="14" y="6" width="2.5" height="8" rx="1.2" fill={iconColor}/>
          <rect x="17.5" y="9" width="1.5" height="2" rx="0.75" fill={iconColor}/>
        </svg>
      );
    case "aisha":
      // Leaf
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <path d="M10 17C10 17 4 14 4 8C4 5 7 3 10 3C13 3 16 5 16 8C16 14 10 17 10 17Z" stroke={iconColor} strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M10 17V9" stroke={iconColor} strokeWidth="1.3" strokeLinecap="round"/>
          <path d="M10 11C10 11 7.5 9.5 7 8" stroke={iconColor} strokeWidth="1.1" strokeLinecap="round"/>
          <path d="M10 13C10 13 12.5 11.5 13 10" stroke={iconColor} strokeWidth="1.1" strokeLinecap="round"/>
        </svg>
      );
    case "sam":
      // Flame
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <path d="M10 18C6.5 18 4 15.5 4 12C4 9 7 7 7 7C7 7 6.5 10 9 11C9 11 8 8.5 10 6C10 6 10.5 9.5 13 10.5C14 11 16 12.5 16 14.5C16 16.5 13.5 18 10 18Z" stroke={iconColor} strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
      );
    case "kenji":
      // Three columns (architecture/design)
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <rect x="3" y="5" width="3" height="12" rx="0.8" stroke={iconColor} strokeWidth="1.4"/>
          <rect x="8.5" y="3" width="3" height="14" rx="0.8" stroke={iconColor} strokeWidth="1.4"/>
          <rect x="14" y="5" width="3" height="12" rx="0.8" stroke={iconColor} strokeWidth="1.4"/>
          <line x1="2" y1="17.5" x2="18" y2="17.5" stroke={iconColor} strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      );
    case "leila":
      // Atom / nodes
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="2" fill={iconColor}/>
          <ellipse cx="10" cy="10" rx="8" ry="3.5" stroke={iconColor} strokeWidth="1.3"/>
          <ellipse cx="10" cy="10" rx="8" ry="3.5" stroke={iconColor} strokeWidth="1.3" transform="rotate(60 10 10)"/>
          <ellipse cx="10" cy="10" rx="8" ry="3.5" stroke={iconColor} strokeWidth="1.3" transform="rotate(120 10 10)"/>
        </svg>
      );
    case "dani":
      // Camera aperture
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7.5" stroke={iconColor} strokeWidth="1.5"/>
          <circle cx="10" cy="10" r="3" stroke={iconColor} strokeWidth="1.2"/>
          <line x1="10" y1="2.5" x2="10" y2="7" stroke={iconColor} strokeWidth="1.2" strokeLinecap="round"/>
          <line x1="10" y1="13" x2="10" y2="17.5" stroke={iconColor} strokeWidth="1.2" strokeLinecap="round"/>
          <line x1="2.5" y1="10" x2="7" y2="10" stroke={iconColor} strokeWidth="1.2" strokeLinecap="round"/>
          <line x1="13" y1="10" x2="17.5" y2="10" stroke={iconColor} strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      );
    case "yara":
      // Heart
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <path d="M10 16.5C10 16.5 3 12 3 7C3 4.5 5 3 7.5 3C8.8 3 10 4 10 4C10 4 11.2 3 12.5 3C15 3 17 4.5 17 7C17 12 10 16.5 10 16.5Z" stroke={iconColor} strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
      );
    case "riku":
      // Arch (architecture)
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <path d="M4 17V10C4 6.7 6.7 4 10 4C13.3 4 16 6.7 16 10V17" stroke={iconColor} strokeWidth="1.6" strokeLinecap="round"/>
          <line x1="2" y1="17" x2="18" y2="17" stroke={iconColor} strokeWidth="1.4" strokeLinecap="round"/>
          <path d="M7 17V11.5C7 9.6 8.3 8 10 8C11.7 8 13 9.6 13 11.5V17" stroke={iconColor} strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      );
    case "amara":
      // Speech bubble
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <path d="M4 4H16C17.1 4 18 4.9 18 6V12C18 13.1 17.1 14 16 14H8L4 17V6C4 4.9 4.9 4 4 4Z" stroke={iconColor} strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
      );
    case "theo":
      // Bar chart (economics)
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <rect x="3" y="10" width="3" height="8" rx="0.8" stroke={iconColor} strokeWidth="1.4"/>
          <rect x="8.5" y="6" width="3" height="12" rx="0.8" stroke={iconColor} strokeWidth="1.4"/>
          <rect x="14" y="3" width="3" height="15" rx="0.8" stroke={iconColor} strokeWidth="1.4"/>
          <line x1="2" y1="18" x2="18" y2="18" stroke={iconColor} strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      );
    case "preet":
      // Code brackets
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <path d="M7 6L3 10L7 14" stroke={iconColor} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M13 6L17 10L13 14" stroke={iconColor} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
          <line x1="11.5" y1="5" x2="8.5" y2="15" stroke={iconColor} strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      );
    default:
      // Generic person silhouette
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="7" r="3.5" stroke={iconColor} strokeWidth="1.5"/>
          <path d="M3.5 18c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      );
  }
  void c;
}

export default function Avatar({ userId, color, size = 38, border }: AvatarProps) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: "50%",
      backgroundColor: color,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      border: border ?? "none",
    }}>
      <AvatarIcon userId={userId} size={size} />
    </div>
  );
}
