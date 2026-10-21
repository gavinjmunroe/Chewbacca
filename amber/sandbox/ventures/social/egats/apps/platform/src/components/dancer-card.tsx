import Link from "next/link";
import { MapPin, Star, Play, BookOpen } from "lucide-react";
import VerificationBadge from "./verification-badge";
import type { DancerProfile } from "@/types/database";
import { getInitials } from "@/lib/utils";

interface DancerCardProps {
  dancer: DancerProfile;
  onAddToShortlist?: (id: string) => void;
  inShortlist?: boolean;
}

const AVAIL_CONFIG = {
  available:   { dot: "avail-dot-available",   label: "Available",   color: "#30D158" },
  limited:     { dot: "avail-dot-limited",      label: "Limited",     color: "#FF9F0A" },
  unavailable: { dot: "avail-dot-unavailable",  label: "Unavailable", color: "rgba(120,120,128,0.5)" },
};

export default function DancerCard({ dancer, onAddToShortlist, inShortlist }: DancerCardProps) {
  const name = dancer.profile?.display_name || dancer.stage_name || "Creative";
  const avail = AVAIL_CONFIG[dancer.availability_status];
  const isTier2 = dancer.verification_tier === "2";

  return (
    <div
      className="card card-hover group"
      style={{
        overflow: "hidden", display: "flex", flexDirection: "column",
        ...(isTier2 ? { border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.03)" } : {}),
      }}
    >
      {/* Thumbnail */}
      <div style={{ position: "relative", aspectRatio: "1", background: "#1C1C1E", overflow: "hidden" }}>
        {dancer.clips?.[0]?.thumbnail_url ? (
          // eslint_disable-next-line @next/next/no-img-element
          <img
            src={dancer.clips[0].thumbnail_url}
            alt={name}
            style={{ width: "100%", height: "100%", objectFit: "cover", transition: "transform 400ms cubic-bezier(0.34,1.56,0.64,1)" }}
            className="group-hover:scale-105"
          />
        ) : (
          <div style={{
            width: "100%", height: "100%",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg, rgba(191,90,242,0.15) 0%, rgba(28,28,30,0.9) 100%)",
          }}>
            <span style={{ fontSize: 40, fontWeight: 900, color: "rgba(191,90,242,0.25)" }}>{getInitials(name)}</span>
          </div>
        )}

        {/* Play overlay */}
        {dancer.clips?.length ? (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0)",
            transition: "background 200ms ease",
          }}
          className="group-hover:[background:rgba(0,0,0,0.35)]"
          >
            <div style={{
              width: 44, height: 44, borderRadius: "50%",
              background: "rgba(255,255,255,0.15)",
              backdropFilter: "blur(8px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: 0, transition: "opacity 200ms ease",
            }}
            className="group-hover:opacity-100"
            >
              <Play style={{ width: 18, height: 18, color: "#fff", fill: "#fff", marginLeft: 2 }} />
            </div>
          </div>
        ) : null}

        {/* Tier badge */}
        <div style={{ position: "absolute", top: 10, right: 10 }}>
          <VerificationBadge tier={dancer.verification_tier} size="sm" />
        </div>

        {/* Availability */}
        <div style={{
          position: "absolute", bottom: 10, left: 10,
          display: "flex", alignItems: "center", gap: 5,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(8px)",
          borderRadius: 980,
          padding: "3px 10px 3px 8px",
          fontSize: 10,
          fontWeight: 600,
          color: avail.color,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%" }} className={avail.dot} />
          {avail.label}
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: "14px 16px 16px", flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <Link
            href={`/dashboard/dancers/${dancer.id}`}
            style={{
              fontSize: 14, fontWeight: 600, letterSpacing: "-0.24px",
              color: "#fff", textDecoration: "none",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              transition: "color 150ms ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#BF5AF2")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#fff")}
          >
            {name}
          </Link>
          {dancer.avg_rating ? (
            <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 600, color: "#FFD60A", flexShrink: 0 }}>
              <Star style={{ width: 11, height: 11, fill: "#FFD60A" }} />
              {dancer.avg_rating.toFixed(1)}
            </div>
          ) : null}
        </div>

        {/* Styles */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {dancer.styles.slice(0, 3).map((s) => (
            <span key={s} style={{
              fontSize: 10, fontWeight: 500,
              background: "rgba(191,90,242,0.12)",
              color: "rgba(208,151,245,0.8)",
              padding: "2px 8px",
              borderRadius: 980,
              border: "1px solid rgba(191,90,242,0.2)",
            }}>
              {s}
            </span>
          ))}
          {dancer.styles.length > 3 && (
            <span style={{ fontSize: 10, color: "rgba(235,235,245,0.25)", alignSelf: "center" }}>
              +{dancer.styles.length - 3}
            </span>
          )}
        </div>

        {/* Meta row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto" }}>
          {dancer.total_bookings > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "rgba(235,235,245,0.3)" }}>
              <BookOpen style={{ width: 11, height: 11 }} />
              {dancer.total_bookings} bookings
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "rgba(235,235,245,0.2)", fontStyle: "italic" }}>
              New to EGATS
            </div>
          )}
          {dancer.profile?.location && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "rgba(235,235,245,0.3)" }}>
              <MapPin style={{ width: 11, height: 11 }} />
              {dancer.profile.location}
            </div>
          )}
        </div>

        {onAddToShortlist && (
          <button
            onClick={() => onAddToShortlist(dancer.id)}
            title={inShortlist ? "Remove from Shortlist" : "Add to Shortlist"}
            aria-label={inShortlist ? "Remove from Shortlist" : "Add to Shortlist"}
            style={{
              width: "100%",
              padding: "9px 0",
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "-0.08px",
              border: "1px solid",
              cursor: "pointer",
              transition: "all 180ms cubic-bezier(0.34,1.56,0.64,1)",
              background: inShortlist ? "rgba(191,90,242,0.2)" : "rgba(120,120,128,0.14)",
              color: inShortlist ? "#BF5AF2" : "rgba(235,235,245,0.5)",
              borderColor: inShortlist ? "rgba(191,90,242,0.4)" : "rgba(84,84,88,0.4)",
            }}
          >
            {inShortlist ? "✓ In Shortlist" : "+ Add to Shortlist"}
          </button>
        )}
      </div>
    </div>
  );
}
