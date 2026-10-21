"use client";
import { useState } from "react";
import { Sparkles, CheckCircle, X, Clock, Lock, RotateCcw } from "lucide-react";

const APPS_PER_PAGE = 10;
import DancerCard from "@/components/dancer-card";
import type { Application, DancerProfile } from "@/types/database";
import { useToast } from "@/components/toast-provider";
import BulkApplicationActions from "./BulkApplicationActions";

/** Convert raw Supabase/server error strings into friendly messages. */
function friendlyError(msg: string): string {
  if (!msg) return "Something went wrong. Please try again.";
  if (msg.includes("duplicate key value violates")) return "You've already submitted this.";
  if (msg.includes("foreign key constraint")) return "Invalid reference: the related item no longer exists.";
  return msg;
}

interface Props {
  jobId: string;
  jobStatus: string;
  applicationDeadline?: string | null;
  userRole: string;
  hasApplied: boolean;
  applications: Application[];
}

const COVER_NOTE_MAX = 500;
const COVER_NOTE_MIN = 20;

export default function JobActions({ jobId, jobStatus, applicationDeadline, userRole, hasApplied: initialHasApplied, applications: initialApps }: Props) {
  const { showToast } = useToast();
  const [hasApplied, setHasApplied] = useState(initialHasApplied);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [coverNote, setCoverNote] = useState("");
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMatches, setAiMatches] = useState<{ dancer_id: string; score: number; reasons: string[]; concerns: string[] }[]>([]);
  const [applications, setApplications] = useState(initialApps);
  const [statusPages, setStatusPages] = useState<Record<string, number>>({});

  async function handleApply() {
    if (coverNote.trim().length > 0 && coverNote.trim().length < COVER_NOTE_MIN) {
      setApplyError(`Please write at least ${COVER_NOTE_MIN} characters to introduce yourself.`);
      return;
    }
    setApplying(true);
    setApplyError("");
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, coverNote }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = friendlyError(data.error || "Failed to apply");
        setApplyError(msg);
        showToast("error", msg);
        return;
      }
      setHasApplied(true);
      setShowApplyForm(false);
      if (data?.id) setApplicationId(data.id);
      showToast("success", "Application submitted!");
    } catch {
      const msg = "Network error. Please try again.";
      setApplyError(msg);
      showToast("error", msg);
    } finally {
      setApplying(false);
    }
  }

  async function handleWithdraw() {
    if (!applicationId) {
      showToast("error", "Cannot find application to withdraw.");
      return;
    }
    if (!window.confirm("Withdraw your application? This cannot be undone.")) return;
    setWithdrawing(true);
    try {
      const res = await fetch(`/api/applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "withdrawn" }),
      });
      if (res.ok) {
        setHasApplied(false);
        setApplicationId(null);
        showToast("success", "Application withdrawn.");
      } else {
        const data = await res.json();
        showToast("error", data.error ?? "Failed to withdraw application.");
      }
    } catch {
      showToast("error", "Network error. Please try again.");
    } finally {
      setWithdrawing(false);
    }
  }

  async function handleAiMatch() {
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (data.matches) {
        setAiMatches(data.matches);
        showToast("success", "AI matching complete!");
      } else {
        showToast("error", friendlyError(data.error || "AI match failed"));
      }
    } catch {
      showToast("error", "AI match failed. Try again.");
    } finally {
      setAiLoading(false);
    }
  }

  async function updateApplicationStatus(appId: string, status: string) {
    const res = await fetch(`/api/applications/${appId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setApplications(prev => prev.map(a => a.id === appId ? { ...a, status: status as Application["status"] } : a));
      showToast("success", `Moved to ${status.replace(/_/g, " ")}`);
    } else {
      showToast("error", "Failed to update application status");
    }
  }

  function handleBulkStatusUpdated(updatedIds: string[], status: string) {
    setApplications(prev =>
      prev.map(a => updatedIds.includes(a.id) ? { ...a, status: status as Application["status"] } : a)
    );
  }

  const deadlinePassed = !!(applicationDeadline && new Date(applicationDeadline) < new Date());
  const canApply = userRole === "dancer" && !hasApplied && jobStatus === "open" && !deadlinePassed;

  return (
    <div className="w-full">

      {/* Dancer: Apply Now */}
      {canApply && !showApplyForm && (
        <button
          onClick={() => setShowApplyForm(true)}
          className="bg-violet-600 hover:bg-violet-500 text-white font-bold px-8 py-4 rounded-xl text-sm transition-all hover:scale-105"
        >
          Apply Now
        </button>
      )}

      {canApply && showApplyForm && (
        <div className="w-full max-w-md bg-white/[0.04] border border-white/10 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">Apply for this role</h3>
            <button onClick={() => setShowApplyForm(false)} className="text-white/40 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <textarea
            value={coverNote}
            onChange={e => setCoverNote(e.target.value.slice(0, COVER_NOTE_MAX))}
            placeholder="Optional: Introduce yourself, share relevant experience, explain why you're the right fit..."
            rows={4}
            maxLength={COVER_NOTE_MAX}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 resize-none"
          />
          <p className={`text-[11px] text-right mt-1 ${coverNote.length >= COVER_NOTE_MAX ? "text-red-400" : "text-white/25"}`}>
            {coverNote.length} / {COVER_NOTE_MAX}
          </p>
          {applyError && <p className="text-red-400 text-xs">{applyError}</p>}
          <button
            onClick={handleApply}
            disabled={applying}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-colors"
          >
            {applying ? "Submitting..." : "Submit Application"}
          </button>
        </div>
      )}

      {hasApplied && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 text-green-400 px-5 py-3 rounded-xl text-sm font-semibold">
            <CheckCircle className="w-4 h-4" /> Already Applied
          </div>
          {applicationId && (
            <button
              onClick={handleWithdraw}
              disabled={withdrawing}
              className="flex items-center gap-2 px-5 py-2.5 bg-white/[0.05] hover:bg-red-500/10 border border-white/10 hover:border-red-500/20 text-white/40 hover:text-red-400 disabled:opacity-50 rounded-xl text-sm font-medium transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {withdrawing ? "Withdrawing..." : "Withdraw Application"}
            </button>
          )}
        </div>
      )}

      {/* Dancer: Deadline passed */}
      {userRole === "dancer" && !hasApplied && deadlinePassed && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 px-5 py-3 rounded-xl text-sm font-semibold">
          <Clock className="w-4 h-4" /> Deadline Passed
        </div>
      )}

      {/* Dancer: Job closed */}
      {userRole === "dancer" && !hasApplied && !deadlinePassed && jobStatus !== "open" && (
        <div className="flex items-center gap-2 bg-zinc-700/30 border border-zinc-600/30 text-zinc-400 px-5 py-3 rounded-xl text-sm font-semibold">
          <Lock className="w-4 h-4" /> Applications Closed
        </div>
      )}

      {/* Recruiter: AI Match + Application Pipeline */}
      {userRole === "recruiter" && (
        <div className="w-full space-y-6 mt-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-xl">
              Applicants <span className="text-white/30 font-normal text-base ml-2">{applications.length} total</span>
            </h2>
            <button
              onClick={handleAiMatch}
              disabled={aiLoading}
              className="flex items-center gap-2 bg-violet-500/15 border border-violet-500/25 text-violet-300 hover:bg-violet-500/25 disabled:opacity-50 font-semibold px-5 py-2.5 rounded-xl text-sm transition-all"
            >
              <Sparkles className="w-4 h-4" />
              {aiLoading ? "Matching..." : "Run AI Match"}
            </button>
          </div>

          <BulkApplicationActions
            applications={applications}
            onStatusUpdated={handleBulkStatusUpdated}
          />

          {applications.length === 0 ? (
            <div className="text-center py-16 bg-white/[0.02] border border-white/5 rounded-2xl">
              <p className="text-white/40">No applications yet. Share your posting to attract dancers.</p>
            </div>
          ) : (
            <>
              {(["pending", "shortlisted", "audition_requested", "booked"] as const).map((status) => {
                const statusApps = applications.filter(a => a.status === status);
                if (!statusApps.length) return null;
                const currentPage = statusPages[status] ?? 1;
                const totalPages = Math.ceil(statusApps.length / APPS_PER_PAGE);
                const paginatedApps = statusApps.slice((currentPage - 1) * APPS_PER_PAGE, currentPage * APPS_PER_PAGE);
                return (
                  <div key={status}>
                    <div className="text-xs font-bold text-white/30 uppercase tracking-widest mb-3 flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${status === "booked" ? "bg-green-500" : status === "shortlisted" ? "bg-violet-500" : status === "audition_requested" ? "bg-amber-500" : "bg-zinc-600"}`} />
                      {status.replace(/_/g, " ")} ({statusApps.length})
                    </div>
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {paginatedApps.map(app => {
                        const match = aiMatches.find(m => m.dancer_id === app.dancer_id);
                        const displayScore = match?.score ?? app.ai_match_score;
                        return (
                          <div key={app.id} className="relative">
                            {displayScore != null && (
                              <div className="absolute -top-2 -right-2 z-10 text-xs font-bold bg-amber-500 text-black px-2 py-0.5 rounded-full">
                                {Number(displayScore).toFixed(0)}% match
                              </div>
                            )}
                            <DancerCard dancer={app.dancer as unknown as DancerProfile} />
                            {app.cover_note && (
                              <div className="mt-2 px-3 py-2 bg-white/[0.03] border border-white/[0.07] rounded-lg">
                                <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wider mb-1">Cover Note</p>
                                <p className="text-[12px] text-white/60 leading-relaxed line-clamp-3">{app.cover_note}</p>
                              </div>
                            )}
                            {(match?.reasons ?? app.ai_match_reasons)?.slice(0, 2).map(r => (
                              <div key={r} className="mt-1 text-xs text-violet-300/80 flex items-start gap-1.5">
                                <Sparkles className="w-3 h-3 shrink-0 mt-0.5 text-violet-400" />{r}
                              </div>
                            ))}
                            <div className="flex gap-2 mt-2">
                              {status === "pending" && (
                                <>
                                  <button
                                    onClick={() => updateApplicationStatus(app.id, "shortlisted")}
                                    className="flex-1 text-xs bg-violet-600 hover:bg-violet-500 text-white font-semibold py-2 rounded-lg transition-colors"
                                  >Shortlist</button>
                                  <button
                                    onClick={() => updateApplicationStatus(app.id, "rejected")}
                                    className="flex-1 text-xs bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/30 text-white/50 hover:text-red-400 font-semibold py-2 rounded-lg transition-all"
                                  >Pass</button>
                                </>
                              )}
                              {status === "shortlisted" && (
                                <button
                                  onClick={() => updateApplicationStatus(app.id, "audition_requested")}
                                  className="flex-1 text-xs bg-amber-500 hover:bg-amber-400 text-black font-semibold py-2 rounded-lg transition-colors"
                                >Request Audition</button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-6 pt-4 border-t border-white/10">
                        <button
                          onClick={() => setStatusPages(prev => ({ ...prev, [status]: Math.max(1, (prev[status] ?? 1) - 1) }))}
                          disabled={currentPage === 1}
                          className="px-4 py-2 rounded-xl text-sm bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors"
                        >
                          Previous
                        </button>
                        <span className="text-sm text-white/30">
                          Page {currentPage} of {totalPages} ({statusApps.length} applicants)
                        </span>
                        <button
                          onClick={() => setStatusPages(prev => ({ ...prev, [status]: Math.min(totalPages, (prev[status] ?? 1) + 1) }))}
                          disabled={currentPage >= totalPages}
                          className="px-4 py-2 rounded-xl text-sm bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
