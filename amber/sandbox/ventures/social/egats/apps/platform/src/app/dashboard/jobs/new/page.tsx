"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DANCE_STYLES, ROLE_TYPES } from "@/types/database";
import type { VerificationTier } from "@/types/database";

interface JobTemplate {
  id: string;
  name: string;
  data: Record<string, unknown>;
  created_at: string;
}

export default function PostJobPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [roleType, setRoleType] = useState("");
  const [stylesNeeded, setStylesNeeded] = useState<string[]>([]);
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [remotePossible, setRemotePossible] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [payMin, setPayMin] = useState("");
  const [payMax, setPayMax] = useState("");
  const [payType, setPayType] = useState("flat");
  const [headCount, setHeadCount] = useState(1);
  const [minTier, setMinTier] = useState<VerificationTier>("0");
  const [deadline, setDeadline] = useState("");
  const [requirements, setRequirements] = useState("");

  // Template state
  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);

  useEffect(() => {
    fetch("/api/job-templates")
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => { });
  }, []);

  function getFormData() {
    return {
      title, description, roleType, stylesNeeded, city, state,
      remotePossible, startDate, endDate, payMin, payMax, payType,
      headCount, minTier, deadline, requirements,
    };
  }

  function applyTemplateData(data: Record<string, unknown>) {
    if (typeof data.title === "string") setTitle(data.title);
    if (typeof data.description === "string") setDescription(data.description);
    if (typeof data.roleType === "string") setRoleType(data.roleType);
    if (Array.isArray(data.stylesNeeded)) setStylesNeeded(data.stylesNeeded as string[]);
    if (typeof data.city === "string") setCity(data.city);
    if (typeof data.state === "string") setState(data.state);
    if (typeof data.remotePossible === "boolean") setRemotePossible(data.remotePossible);
    if (typeof data.startDate === "string") setStartDate(data.startDate);
    if (typeof data.endDate === "string") setEndDate(data.endDate);
    if (typeof data.payMin === "string") setPayMin(data.payMin);
    if (typeof data.payMax === "string") setPayMax(data.payMax);
    if (typeof data.payType === "string") setPayType(data.payType);
    if (typeof data.headCount === "number") setHeadCount(data.headCount);
    if (typeof data.minTier === "string") setMinTier(data.minTier as VerificationTier);
    if (typeof data.deadline === "string") setDeadline(data.deadline);
    if (typeof data.requirements === "string") setRequirements(data.requirements);
  }

  async function handleSaveTemplate() {
    const name = window.prompt("Template name:", title || "New Template");
    if (!name) return;
    setSavingTemplate(true);
    try {
      const res = await fetch("/api/job-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, data: getFormData() }),
      });
      if (res.ok) {
        const saved = await res.json() as JobTemplate;
        setTemplates((prev) => [saved, ...prev]);
      } else {
        const err = await res.json() as { error?: string };
        alert("Failed to save template: " + (err.error ?? "Unknown error"));
      }
    } catch {
      alert("Failed to save template.");
    } finally {
      setSavingTemplate(false);
    }
  }

  function handleLoadTemplate(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    if (!id) return;
    const tpl = templates.find((t) => t.id === id);
    if (tpl) applyTemplateData(tpl.data);
    e.target.value = "";
  }

  function toggleStyle(style: string) {
    setStylesNeeded((prev) =>
      prev.includes(style) ? prev.filter((s) => s !== style) : [...prev, style]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();

    if (!title.trim()) { setError("Title cannot be blank"); setLoading(false); return; }
    if (payMin && payMax && parseFloat(payMin) > parseFloat(payMax)) {
      setError("Minimum pay cannot be greater than maximum pay");
      setLoading(false);
      return;
    }
    if (payMin && parseFloat(payMin) < 0) {
      setError("Minimum pay cannot be negative");
      setLoading(false);
      return;
    }
    if (payMax && parseFloat(payMax) < 0) {
      setError("Maximum pay cannot be negative");
      setLoading(false);
      return;
    }
    if (headCount < 1) {
      setError("Positions available must be at least 1");
      setLoading(false);
      return;
    }
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      setError("Start date cannot be after end date");
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not logged in"); setLoading(false); return; }

    const { data: recruiter } = await supabase.from("recruiter_profiles").select("id").eq("user_id", user.id).single();
    if (!recruiter) {
      // Auto-create recruiter profile
      const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
      await supabase.from("recruiter_profiles").insert({
        user_id: user.id,
        company_name: profile?.display_name || "My Company",
        company_type: "independent",
      });
    }

    const { data: recruiterFresh } = await supabase.from("recruiter_profiles").select("id").eq("user_id", user.id).single();
    if (!recruiterFresh) { setError("Could not find recruiter profile"); setLoading(false); return; }

    const { error: insertError } = await supabase.from("jobs").insert({
      recruiter_id: recruiterFresh.id,
      title: title.trim(),
      description: description.trim(),
      role_type: roleType,
      styles_needed: stylesNeeded,
      city: city.trim() || null,
      state: state.trim() || null,
      remote_possible: remotePossible,
      start_date: startDate || null,
      end_date: endDate || null,
      pay_range_min_cents: payMin ? Math.round(parseFloat(payMin) * 100) : null,
      pay_range_max_cents: payMax ? Math.round(parseFloat(payMax) * 100) : null,
      pay_type: payType,
      head_count: headCount,
      min_verification_tier: minTier,
      application_deadline: deadline || null,
      requirements: requirements ? requirements.split("\n").map((r) => r.trim()).filter(Boolean) : null,
      status: "open",
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
    } else {
      router.push("/dashboard/jobs");
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-1">Post a Role</h1>
        <p className="text-white/40 text-sm">EGATS will surface your role to matched, verified talent.</p>
      </div>

      {/* Load Template */}
      {templates.length > 0 && (
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 flex items-center gap-4">
          <span className="text-sm text-white/60 shrink-0">Load Template</span>
          <select
            onChange={handleLoadTemplate}
            defaultValue=""
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-violet-500/50"
          >
            <option value="" className="bg-zinc-900">Select a saved template...</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id} className="bg-zinc-900">{tpl.name}</option>
            ))}
          </select>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic Info */}
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 sm:p-6 space-y-5">
          <h2 className="font-bold text-base">Role Details</h2>
          <div>
            <label className="block text-sm text-white/60 mb-2">Job Title *</label>
            <input required value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Backup Dancer, World Tour 2026"
              maxLength={200}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50" />
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-2">Description *</label>
            <textarea required value={description} onChange={(e) => setDescription(e.target.value)}
              rows={5} placeholder="Describe the role, the project, what a typical day looks like, what you're looking for in a dancer..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 resize-none" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/60 mb-2">Role Type *</label>
              <select required value={roleType} onChange={(e) => setRoleType(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none">
                <option value="" className="bg-zinc-900">Select type...</option>
                {ROLE_TYPES.map((t) => <option key={t} value={t} className="bg-zinc-900">{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-white/60 mb-2">Positions Available</label>
              <input type="number" min={1} value={headCount} onChange={(e) => setHeadCount(parseInt(e.target.value))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none" />
            </div>
          </div>
        </div>

        {/* Styles */}
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 sm:p-6">
          <h2 className="font-bold text-base mb-2">Styles Needed</h2>
          <p className="text-xs text-white/40 mb-4">Select all that apply. This powers AI matching.</p>
          <div className="flex flex-wrap gap-2">
            {DANCE_STYLES.map((style) => (
              <button key={style} type="button" onClick={() => toggleStyle(style)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${stylesNeeded.includes(style) ? "bg-violet-600 border-violet-500 text-white" : "bg-white/5 border-white/10 text-white/50 hover:text-white"
                  }`}>
                {style}
              </button>
            ))}
          </div>
        </div>

        {/* Location & Dates */}
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 sm:p-6 space-y-5">
          <h2 className="font-bold text-base">Location & Schedule</h2>
          <div className="flex items-center gap-3">
            <input type="checkbox" id="remote" checked={remotePossible} onChange={(e) => setRemotePossible(e.target.checked)}
              className="w-4 h-4 accent-violet-500" />
            <label htmlFor="remote" className="text-sm text-white/70">Remote / virtual possible</label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/60 mb-2">City</label>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Los Angeles"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50" />
            </div>
            <div>
              <label className="block text-sm text-white/60 mb-2">State</label>
              <input value={state} onChange={(e) => setState(e.target.value)} placeholder="CA"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/60 mb-2">Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm text-white/60 mb-2">End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none" />
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
                <button key={pt} type="button" onClick={() => setPayType(pt)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all capitalize ${payType === pt ? "bg-violet-600 border-violet-500 text-white" : "bg-white/5 border-white/10 text-white/50 hover:text-white"}`}>
                  {pt.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/60 mb-2">Pay Min ($)</label>
              <input type="number" value={payMin} onChange={(e) => setPayMin(e.target.value)} placeholder="500"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm text-white/60 mb-2">Pay Max ($)</label>
              <input type="number" value={payMax} onChange={(e) => setPayMax(e.target.value)} placeholder="1500"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none" />
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
                <button key={t} type="button" onClick={() => setMinTier(t)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all ${minTier === t ? "bg-violet-600 border-violet-500 text-white" : "bg-white/5 border-white/10 text-white/50 hover:text-white"}`}>
                  Tier {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-2">Application Deadline</label>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-2">Additional Requirements (one per line)</label>
            <textarea value={requirements} onChange={(e) => setRequirements(e.target.value)}
              rows={3} placeholder="Must have passport&#10;Available for full tour run&#10;Prior tour experience preferred"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none resize-none" />
          </div>
        </div>

        {error && (
          <div role="alert" aria-live="assertive" className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>
        )}

        <div className="flex gap-4">
          <button type="submit" disabled={loading}
            className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold py-4 rounded-xl transition-colors">
            {loading ? "Posting..." : "Post Role"}
          </button>
          <button type="button" onClick={handleSaveTemplate} disabled={savingTemplate}
            className="px-6 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white font-semibold py-4 rounded-xl transition-colors disabled:opacity-50">
            {savingTemplate ? "Saving..." : "Save as Template"}
          </button>
          <button type="button" onClick={() => router.back()}
            className="px-8 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold py-4 rounded-xl transition-colors">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
