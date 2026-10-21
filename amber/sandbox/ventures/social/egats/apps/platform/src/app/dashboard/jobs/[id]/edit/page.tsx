"use client";
import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { DANCE_STYLES, ROLE_TYPES } from "@/types/database";
import type { VerificationTier } from "@/types/database";
import { AlertTriangle, Trash2 } from "lucide-react";

export default function EditJobPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [roleType, setRoleType] = useState("");
  const [stylesNeeded, setStylesNeeded] = useState<string[]>([]);
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [remotePossible, setRemotePossible] = useState(false);
  const [payMin, setPayMin] = useState("");
  const [payMax, setPayMax] = useState("");
  const [payType, setPayType] = useState("flat");
  const [headCount, setHeadCount] = useState(1);
  const [minTier, setMinTier] = useState<VerificationTier>("0");
  const [deadline, setDeadline] = useState("");
  const [requirements, setRequirements] = useState("");
  const [status, setStatus] = useState("open");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/jobs/${id}`);
        if (!res.ok) throw new Error("Failed to load job");
        const job = await res.json();

        setTitle(job.title || "");
        setDescription(job.description || "");
        setRoleType(job.role_type || "");
        setStylesNeeded(job.styles_needed || []);
        setCity(job.city || "");
        setState(job.state || "");
        setRemotePossible(job.remote_possible || false);
        setPayMin(job.pay_range_min_cents != null ? String(job.pay_range_min_cents / 100) : "");
        setPayMax(job.pay_range_max_cents != null ? String(job.pay_range_max_cents / 100) : "");
        setPayType(job.pay_type || "flat");
        setHeadCount(job.head_count || 1);
        setMinTier((String(job.min_verification_tier) as VerificationTier) || "0");
        setDeadline(job.application_deadline ? job.application_deadline.split("T")[0] : "");
        setRequirements(job.requirements?.join("\n") || "");
        setStatus(job.status || "open");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load job");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  function toggleStyle(style: string) {
    setStylesNeeded((prev) =>
      prev.includes(style) ? prev.filter((s) => s !== style) : [...prev, style]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    if (!title.trim()) {
      setError("Title cannot be blank");
      setSaving(false);
      return;
    }
    if (payMin && payMax && parseFloat(payMin) > parseFloat(payMax)) {
      setError("Minimum pay cannot be greater than maximum pay");
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description,
          styles_needed: stylesNeeded,
          city: city || null,
          state: state || null,
          remote_possible: remotePossible,
          pay_min: payMin ? parseFloat(payMin) : null,
          pay_max: payMax ? parseFloat(payMax) : null,
          deadline: deadline || null,
          status,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save changes");
        return;
      }
      router.push(`/dashboard/jobs/${id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to delete job");
        setShowDeleteConfirm(false);
        return;
      }
      router.push("/dashboard/jobs");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-1">Edit Role</h1>
        <p className="text-white/40 text-sm">Update the details for this posting.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic Info */}
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 sm:p-6 space-y-5">
          <h2 className="font-bold text-base">Role Details</h2>
          <div>
            <label className="block text-sm text-white/60 mb-2">Job Title *</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Backup Dancer, World Tour 2026"
              maxLength={200}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50"
            />
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-2">Description *</label>
            <textarea
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder="Describe the role, the project, what a typical day looks like..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 resize-none"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/60 mb-2">Role Type *</label>
              <select
                required
                value={roleType}
                onChange={(e) => setRoleType(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none"
              >
                <option value="" className="bg-zinc-900">Select type...</option>
                {ROLE_TYPES.map((t) => (
                  <option key={t} value={t} className="bg-zinc-900">{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-white/60 mb-2">Positions Available</label>
              <input
                type="number"
                min={1}
                value={headCount}
                onChange={(e) => setHeadCount(parseInt(e.target.value))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-2">Status</label>
            <div className="flex gap-2">
              {["open", "closed"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all capitalize ${
                    status === s
                      ? "bg-violet-600 border-violet-500 text-white"
                      : "bg-white/5 border-white/10 text-white/50 hover:text-white"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Styles */}
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 sm:p-6">
          <h2 className="font-bold text-base mb-2">Styles Needed</h2>
          <p className="text-xs text-white/40 mb-4">Select all that apply. This powers AI matching.</p>
          <div className="flex flex-wrap gap-2">
            {DANCE_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => toggleStyle(style)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                  stylesNeeded.includes(style)
                    ? "bg-violet-600 border-violet-500 text-white"
                    : "bg-white/5 border-white/10 text-white/50 hover:text-white"
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        {/* Location */}
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 sm:p-6 space-y-5">
          <h2 className="font-bold text-base">Location</h2>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="remote"
              checked={remotePossible}
              onChange={(e) => setRemotePossible(e.target.checked)}
              className="w-4 h-4 accent-violet-500"
            />
            <label htmlFor="remote" className="text-sm text-white/70">Remote / virtual possible</label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/60 mb-2">City</label>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Los Angeles"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50"
              />
            </div>
            <div>
              <label className="block text-sm text-white/60 mb-2">State</label>
              <input
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="CA"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50"
              />
            </div>
          </div>
        </div>

        {/* Pay */}
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 sm:p-6 space-y-5">
          <h2 className="font-bold text-base">Compensation</h2>
          <div>
            <label className="block text-sm text-white/60 mb-2">Pay Type</label>
            <div className="flex gap-2">
              {["flat", "hourly", "daily", "union_scale"].map((pt) => (
                <button
                  key={pt}
                  type="button"
                  onClick={() => setPayType(pt)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all capitalize ${
                    payType === pt
                      ? "bg-violet-600 border-violet-500 text-white"
                      : "bg-white/5 border-white/10 text-white/50 hover:text-white"
                  }`}
                >
                  {pt.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/60 mb-2">Pay Min ($)</label>
              <input
                type="number"
                value={payMin}
                onChange={(e) => setPayMin(e.target.value)}
                placeholder="500"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm text-white/60 mb-2">Pay Max ($)</label>
              <input
                type="number"
                value={payMax}
                onChange={(e) => setPayMax(e.target.value)}
                placeholder="1500"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Requirements */}
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 sm:p-6 space-y-5">
          <h2 className="font-bold text-base">Requirements & Trust</h2>
          <div>
            <label className="block text-sm text-white/60 mb-2">Minimum Verification Tier</label>
            <div className="flex gap-2">
              {(["0", "1", "2"] as VerificationTier[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setMinTier(t)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                    minTier === t
                      ? "bg-violet-600 border-violet-500 text-white"
                      : "bg-white/5 border-white/10 text-white/50 hover:text-white"
                  }`}
                >
                  Tier {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-2">Application Deadline</label>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              min={new Date().toISOString().split("T")[0]}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-2">Additional Requirements (one per line)</label>
            <textarea
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              rows={3}
              placeholder="Must have passport&#10;Available for full tour run"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none resize-none"
            />
          </div>
        </div>

        {error && (
          <div role="alert" className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex gap-4">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold py-4 rounded-xl transition-colors"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/dashboard/jobs/${id}`)}
            className="px-8 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold py-4 rounded-xl transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>

      {/* Danger Zone */}
      <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6 space-y-4">
        <h3 className="font-bold text-red-400 text-sm uppercase tracking-widest">Danger Zone</h3>
        <p className="text-white/40 text-sm">Permanently delete this job posting. This cannot be undone and is only allowed if there are no existing bookings.</p>

        {!showDeleteConfirm ? (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete Job
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-red-300 text-sm font-semibold">Are you sure? This action cannot be undone.</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-xl text-sm transition-colors"
              >
                {deleting ? "Deleting..." : "Yes, Delete"}
              </button>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
