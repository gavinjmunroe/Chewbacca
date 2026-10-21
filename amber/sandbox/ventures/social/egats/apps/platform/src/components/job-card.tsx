"use client";
import { useState } from "react";
import Link from "next/link";
import { MapPin, Calendar, DollarSign, Users, ChevronRight, Bookmark } from "lucide-react";
import VerificationBadge from "./verification-badge";
import type { Job } from "@/types/database";
import { formatPay, formatDate } from "@/lib/utils";

const ROLE_TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  "Tour":              { bg: "rgba(191,90,242,0.14)", color: "#D097F5" },
  "Music Video":       { bg: "rgba(255,55,95,0.14)",  color: "#FF6B8A" },
  "Commercial":        { bg: "rgba(10,132,255,0.14)", color: "#5AC8FA" },
  "Live Event":        { bg: "rgba(48,209,88,0.14)",  color: "#4CD964" },
  "Award Show":        { bg: "rgba(255,214,10,0.14)", color: "#FFD60A" },
  "TV / Film":         { bg: "rgba(64,203,224,0.14)", color: "#40CBE0" },
  "Teaching / Workshop": { bg: "rgba(255,159,10,0.14)", color: "#FF9F0A" },
};

interface JobCardProps {
  job: Job;
  isDancer?: boolean;
  initialSaved?: boolean;
}

export default function JobCard({ job, isDancer = false, initialSaved = false }: JobCardProps) {
  const roleColor = ROLE_TYPE_COLORS[job.role_type] || { bg: "rgba(120,120,128,0.18)", color: "rgba(235,235,245,0.5)" };

  const [saved, setSaved] = useState(initialSaved);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);

  const isExpired =
    job.status === "closed" &&
    !!job.application_deadline &&
    new Date(job.application_deadline) < new Date();

  async function handleBookmark(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (bookmarkLoading) return;
    setBookmarkLoading(true);
    const optimistic = !saved;
    setSaved(optimistic);
    try {
      const res = await fetch("/api/saved-jobs", {
        method: optimistic ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      if (!res.ok) {
        // Revert on error
        setSaved(!optimistic);
      }
    } catch {
      setSaved(!optimistic);
    } finally {
      setBookmarkLoading(false);
    }
  }

  return (
    <Link
      href={`/dashboard/jobs/${job.id}`}
      style={{
        display: "block",
        background: "#1C1C1E",
        borderRadius: 20,
        padding: "20px 20px 16px",
        textDecoration: "none",
        border: "1px solid rgba(84,84,88,0.5)",
        transition: "transform 220ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 220ms ease, border-color 150ms ease",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.transform = "translateY(-3px) scale(1.005)";
        el.style.boxShadow = "0 16px 48px rgba(0,0,0,0.6)";
        el.style.borderColor = "rgba(191,90,242,0.35)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.transform = "";
        el.style.boxShadow = "";
        el.style.borderColor = "rgba(84,84,88,0.5)";
      }}
    >
      {/* Expired banner */}
      {isExpired && (
        <div style={{
          position: "absolute", top: 12, left: 0, right: 0,
          display: "flex", justifyContent: "center", pointerEvents: "none",
        }}>
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: "0.8px",
            background: "rgba(239,68,68,0.18)", color: "#F87171",
            border: "1px solid rgba(239,68,68,0.3)",
            padding: "2px 8px", borderRadius: 980, textTransform: "uppercase",
          }}>
            EXPIRED
          </span>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Tags row */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.3px",
              padding: "3px 9px", borderRadius: 980,
              background: roleColor.bg, color: roleColor.color,
            }}>
              {job.role_type}
            </span>
            <VerificationBadge tier={job.min_verification_tier} size="sm" />
            {isExpired && (
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.2px",
                padding: "3px 9px", borderRadius: 980,
                background: "rgba(239,68,68,0.15)", color: "#F87171",
                border: "1px solid rgba(239,68,68,0.25)",
              }}>
                Expired
              </span>
            )}
          </div>

          {/* Title */}
          <div style={{
            fontSize: 15, fontWeight: 600, letterSpacing: "-0.24px",
            color: "#fff", marginBottom: 4,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {job.title}
          </div>

          {/* Company */}
          {job.recruiter?.company_name && (
            <div style={{ fontSize: 12, color: "rgba(235,235,245,0.35)", marginBottom: 10 }}>
              {job.recruiter.company_name}
            </div>
          )}

          {/* Styles */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
            {job.styles_needed.slice(0, 4).map((s) => (
              <span key={s} style={{
                fontSize: 10, fontWeight: 500,
                background: "rgba(191,90,242,0.1)",
                color: "rgba(208,151,245,0.7)",
                padding: "2px 8px", borderRadius: 980,
                border: "1px solid rgba(191,90,242,0.18)",
              }}>
                {s}
              </span>
            ))}
            {job.styles_needed.length > 4 && (
              <span style={{ fontSize: 10, color: "rgba(235,235,245,0.25)", alignSelf: "center" }}>
                +{job.styles_needed.length - 4}
              </span>
            )}
          </div>

          {/* Meta */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {(job.city || job.remote_possible) && (
              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "rgba(235,235,245,0.3)" }}>
                <MapPin style={{ width: 10, height: 10 }} />
                {job.remote_possible ? "Remote" : `${job.city}${job.state ? `, ${job.state}` : ""}`}
              </span>
            )}
            {job.start_date && (
              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "rgba(235,235,245,0.3)" }}>
                <Calendar style={{ width: 10, height: 10 }} />
                {formatDate(job.start_date)}
              </span>
            )}
            {(job.pay_range_min_cents || job.pay_range_max_cents) && (
              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "rgba(235,235,245,0.3)" }}>
                <DollarSign style={{ width: 10, height: 10 }} />
                {formatPay(job.pay_range_min_cents, job.pay_range_max_cents, job.pay_type)}
              </span>
            )}
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "rgba(235,235,245,0.3)" }}>
              <Users style={{ width: 10, height: 10 }} />
              {job.head_count} position{job.head_count > 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Right side: bookmark (dancer only) + chevron */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {isDancer && (
            <button
              onClick={handleBookmark}
              disabled={bookmarkLoading}
              title={saved ? "Remove bookmark" : "Save job"}
              style={{
                background: "none", border: "none", cursor: "pointer",
                padding: 4, color: saved ? "#BF5AF2" : "rgba(235,235,245,0.25)",
                transition: "color 150ms ease, transform 120ms ease",
                transform: bookmarkLoading ? "scale(0.85)" : "scale(1)",
              }}
            >
              <Bookmark
                style={{
                  width: 16, height: 16,
                  fill: saved ? "#BF5AF2" : "none",
                  stroke: saved ? "#BF5AF2" : "currentColor",
                }}
              />
            </button>
          )}
          <ChevronRight style={{ width: 16, height: 16, color: "rgba(235,235,245,0.2)", marginTop: isDancer ? 0 : 4, transition: "color 150ms ease" }} />
        </div>
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 16, paddingTop: 14,
        borderTop: "1px solid rgba(84,84,88,0.35)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 11, color: "rgba(235,235,245,0.28)" }}>{job.total_applications} applicants</span>
        <span style={{ fontSize: 11, color: isExpired ? "rgba(248,113,113,0.6)" : "rgba(235,235,245,0.28)" }}>
          {job.application_deadline ? `Deadline: ${formatDate(job.application_deadline)}` : "Rolling applications"}
        </span>
      </div>
    </Link>
  );
}
