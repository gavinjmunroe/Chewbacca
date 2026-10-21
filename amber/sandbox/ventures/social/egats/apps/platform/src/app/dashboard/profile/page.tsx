"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useBeforeUnload } from "@/lib/use-before-unload";
import { createClient } from "@/lib/supabase/client";
import { CREATIVE_DISCIPLINES } from "@/types/database";
import type { DancerProfile, RecruiterProfile, Profile } from "@/types/database";
import VerificationBadge from "@/components/verification-badge";
import MyReviews from "@/components/my-reviews";
import {
  Camera,
  Save,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Building2,
  User,
  MapPin,
  Globe,
  Phone,
  Briefcase,
  Eye,
  EyeOff,
  Link2,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";

type ProfileData = Profile & {
  dancer_profile?: DancerProfile | null;
  recruiter_profile?: RecruiterProfile | null;
};

const inputCls =
  "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 transition-colors";
const selectCls =
  "w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500/50 transition-colors";
const labelCls = "block text-xs font-semibold text-white/50 uppercase tracking-widest mb-2";
const sectionCls =
  "bg-white/[0.04] border border-white/10 rounded-2xl p-6 space-y-5";

function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-1">
      <Icon className="w-4 h-4 text-violet-400" />
      <h2 className="font-bold text-base">{title}</h2>
    </div>
  );
}

function ProfileCompleteness({ profile, styles, avatarUrl, experienceYears }: {
  profile: ProfileData;
  styles: string[];
  avatarUrl: string | null;
  experienceYears: number;
}) {
  const hasClips = (profile.dancer_profile?.clips?.length ?? 0) > 0;
  const fields = [
    { label: "Display name", done: !!profile.display_name },
    { label: "Bio", done: !!profile.bio },
    { label: "Location", done: !!profile.location },
    { label: "Creative disciplines", done: styles.length > 0 },
    { label: "Experience years", done: experienceYears > 0 },
    { label: "Portfolio clip", done: hasClips },
    { label: "Avatar", done: !!avatarUrl },
  ];
  const done = fields.filter((f) => f.done).length;
  const pct = Math.round((done / fields.length) * 100);

  return (
    <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Profile Completeness</h3>
        <span className="text-sm font-bold text-violet-400">{pct}%</span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-violet-500 to-violet-400 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      {pct < 100 && (
        <p className="text-xs text-white/40 mt-2">
          Missing: {fields.filter((f) => !f.done).map((f) => f.label).join(", ")}
        </p>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [showPhone, setShowPhone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Shared fields
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Dancer-specific
  const [stageName, setStageName] = useState("");
  const [styles, setStyles] = useState<string[]>([]);
  const [experienceYears, setExperienceYears] = useState(0);
  const [availabilityStatus, setAvailabilityStatus] = useState("available");
  const [travelWillingness, setTravelWillingness] = useState("regional");
  const [heightCm, setHeightCm] = useState<number | "">("");
  const [unionMember, setUnionMember] = useState(false);
  const [represented, setRepresented] = useState(false);
  const [representedBy, setRepresentedBy] = useState("");

  // Social links
  const [instagramHandle, setInstagramHandle] = useState("");
  const [tiktokHandle, setTiktokHandle] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");

  // Recruiter-specific
  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [companyIndustry, setCompanyIndustry] = useState("");
  const [recruiterType, setRecruiterType] = useState("agency");
  const [yearsInIndustry, setYearsInIndustry] = useState(0);

  const markDirty = useCallback(() => setIsDirty(true), []);

  // Warn the user before navigating away with unsaved changes
  useBeforeUnload(isDirty);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/profile");
        if (!res.ok) throw new Error("Failed to load profile");
        const data: ProfileData = await res.json();
        setProfileData(data);

        setDisplayName(data.display_name || "");
        setBio(data.bio || "");
        setLocation(data.location || "");
        setWebsiteUrl(data.website_url || "");
        setPhone(data.phone || "");
        setAvatarUrl(data.avatar_url || null);
        setInstagramHandle(data.instagram_handle || "");
        setTiktokHandle(data.tiktok_handle || "");
        setYoutubeUrl((data as typeof data & { youtube_url?: string | null }).youtube_url || "");

        if (data.dancer_profile) {
          const d = data.dancer_profile;
          setStageName((d as DancerProfile & { stage_name?: string }).stage_name || "");
          setStyles(d.styles || []);
          setExperienceYears(d.experience_years || 0);
          setAvailabilityStatus(d.availability_status || "available");
          setTravelWillingness(d.travel_willingness || "regional");
          setHeightCm(d.height_cm ?? "");
          setUnionMember(d.union_member || false);
          setRepresented(d.represented || false);
          setRepresentedBy((d as DancerProfile & { represented_by?: string }).represented_by || "");
        }

        if (data.recruiter_profile) {
          const r = data.recruiter_profile;
          setCompanyName(r.company_name || "");
          setCompanyWebsite(r.website || "");
          setCompanyDescription(data.bio || "");
          setCompanySize((r as RecruiterProfile & { company_size?: string }).company_size || "");
          setCompanyIndustry((r as RecruiterProfile & { industry?: string }).industry || "");
          setRecruiterType(r.company_type || "agency");
          setYearsInIndustry(
            (r as RecruiterProfile & { years_in_industry?: number }).years_in_industry || 0
          );
        }
      } catch (err) {
        showToast("error", "Failed to load profile");
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      showToast("error", "Please select an image file (JPEG, PNG, or WebP)");
      return;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      showToast("error", `Image is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 5MB allowed.`);
      return;
    }

    // Show preview immediately
    const previewUrl = URL.createObjectURL(file);
    setAvatarPreview(previewUrl);
    setUploadingAvatar(true);
    setUploadProgress(0);

    // Simulate progress in increments while uploading
    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => prev < 85 ? prev + 10 : prev);
    }, 150);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${user.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });

      if (uploadError) throw uploadError;

      clearInterval(progressInterval);
      setUploadProgress(100);

      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      setAvatarUrl(publicUrl);
      setAvatarPreview(null);
      URL.revokeObjectURL(previewUrl);
      markDirty();
      showToast("success", "Photo ready. Save your profile to apply it.");
    } catch (err) {
      clearInterval(progressInterval);
      setAvatarPreview(null);
      URL.revokeObjectURL(previewUrl);
      console.error(err);
      showToast("error", "Failed to upload photo");
    } finally {
      setUploadingAvatar(false);
      setUploadProgress(0);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        display_name: displayName.trim(),
        bio: bio.trim(),
        location: location.trim(),
        website_url: websiteUrl.trim(),
        phone: phone.trim(),
        avatar_url: avatarUrl,
        instagram_handle: instagramHandle.trim() || null,
        tiktok_handle: tiktokHandle.trim() || null,
        youtube_url: youtubeUrl.trim() || null,
      };

      if (profileData?.role === "dancer" || profileData?.role === "creative") {
        body.dancer = {
          stage_name: stageName.trim().slice(0, 50) || null,
          styles,
          experience_years: experienceYears,
          availability_status: availabilityStatus,
          travel_willingness: travelWillingness,
          height_cm: heightCm === "" ? null : Number(heightCm),
          union_member: unionMember,
          represented,
          represented_by: represented ? representedBy.trim() : null,
        };
      } else if (profileData?.role === "recruiter") {
        // Store company description in bio (profiles table)
        body.bio = companyDescription.trim();
        body.recruiter = {
          company_name: companyName.trim(),
          company_website: companyWebsite.trim(),
          company_size: companySize || null,
          industry: companyIndustry || null,
          recruiter_type: recruiterType,
          years_in_industry: yearsInIndustry,
        };
      }

      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save failed");
      }

      setIsDirty(false);
      showToast("success", "Profile saved");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function toggleStyle(style: string) {
    setStyles((prev) =>
      prev.includes(style) ? prev.filter((s) => s !== style) : [...prev, style]
    );
    markDirty();
  }

  const initials = displayName.slice(0, 2).toUpperCase() || "??";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isDancer = profileData?.role === "dancer" || profileData?.role === "creative";
  const isRecruiter = profileData?.role === "recruiter";

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-1">My Profile</h1>
          <p className="text-white/40 text-sm">Your professional identity on EGATS</p>
        </div>
        {isDancer && profileData?.dancer_profile && (
          <VerificationBadge
            tier={profileData.dancer_profile.verification_tier}
            size="lg"
            showLabel
          />
        )}
      </div>

      {/* Unsaved changes banner */}
      {isDirty && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-sm text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          You have unsaved changes
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm ${
            toast.type === "success"
              ? "bg-green-500/10 border border-green-500/30 text-green-300"
              : "bg-red-500/10 border border-red-500/30 text-red-300"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 shrink-0" />
          )}
          {toast.message}
        </div>
      )}

      {/* Avatar */}
      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          {/* Circular progress ring */}
          {uploadingAvatar && (
            <svg className="absolute inset-0 w-20 h-20 -rotate-90 z-10" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="36" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
              <circle
                cx="40" cy="40" r="36"
                fill="none"
                stroke="rgb(139,92,246)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 36}`}
                strokeDashoffset={`${2 * Math.PI * 36 * (1 - uploadProgress / 100)}`}
                className="transition-all duration-200"
              />
            </svg>
          )}
          {/* Preview or current avatar */}
          {avatarPreview ? (
            <img
              src={avatarPreview}
              alt="Preview"
              className="w-20 h-20 rounded-full object-cover border border-violet-500/40 opacity-70"
            />
          ) : avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="w-20 h-20 rounded-full object-cover border border-white/10"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-violet-500/30 flex items-center justify-center text-2xl font-bold text-violet-300 border border-violet-500/20">
              {initials}
            </div>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="absolute -bottom-1 -right-1 w-8 h-8 bg-zinc-800 border border-white/15 rounded-full flex items-center justify-center hover:bg-violet-600 transition-colors disabled:opacity-50 z-20"
          >
            {uploadingAvatar ? (
              <span className="text-[9px] font-bold text-white/70">{uploadProgress}%</span>
            ) : (
              <Camera className="w-3.5 h-3.5 text-white/70" />
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleAvatarUpload}
          />
        </div>
        <div>
          <div className="font-bold text-lg leading-snug">{displayName || "—"}</div>
          <div className="text-sm text-white/40 capitalize mt-0.5">{profileData?.role}</div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="text-xs text-violet-400 hover:text-violet-300 mt-1 transition-colors disabled:opacity-50"
          >
            {uploadingAvatar ? `Uploading... ${uploadProgress}%` : "Upload Photo"}
          </button>
          <p className="text-[10px] text-white/20 mt-0.5">Max 5MB · JPEG, PNG, WebP</p>
        </div>
      </div>

      {/* Profile Completeness — dancer only */}
      {isDancer && profileData && (
        <ProfileCompleteness
          profile={profileData}
          styles={styles}
          avatarUrl={avatarUrl}
          experienceYears={experienceYears}
        />
      )}

      {/* ── DANCER SECTIONS ── */}
      {isDancer && (
        <>
          {/* Basic Info */}
          <div className={sectionCls}>
            <SectionHeader icon={User} title="Basic Info" />
            <div>
              <label className={labelCls}>Display Name</label>
              <input
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); markDirty(); }}
                placeholder="Your name"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Stage Name <span className="normal-case text-white/30 font-normal">(optional)</span></label>
              <input
                value={stageName}
                onChange={(e) => { setStageName(e.target.value.slice(0, 50)); markDirty(); }}
                placeholder="The name you perform under"
                maxLength={50}
                className={inputCls}
              />
              <p className="text-xs text-white/30 mt-1.5">Your professional performance name, if different from your display name. {stageName.length}/50</p>
            </div>
            <div>
              <label className={labelCls}>Bio</label>
              <textarea
                value={bio}
                onChange={(e) => { setBio(e.target.value); markDirty(); }}
                rows={3}
                placeholder="Tell recruiters about yourself..."
                className={`${inputCls} resize-none`}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>
                  <MapPin className="inline w-3 h-3 mr-1 -mt-0.5" />
                  Location
                </label>
                <input
                  value={location}
                  onChange={(e) => { setLocation(e.target.value); markDirty(); }}
                  placeholder="Los Angeles, CA"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>
                  <Globe className="inline w-3 h-3 mr-1 -mt-0.5" />
                  Website
                </label>
                <input
                  value={websiteUrl}
                  onChange={(e) => { setWebsiteUrl(e.target.value); markDirty(); }}
                  placeholder="https://yoursite.com"
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>
                <Phone className="inline w-3 h-3 mr-1 -mt-0.5" />
                Phone
              </label>
              <div className="relative">
                <input
                  type={showPhone ? "text" : "password"}
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); markDirty(); }}
                  placeholder="+1 (555) 000-0000"
                  className={`${inputCls} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPhone((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 transition-colors"
                >
                  {showPhone ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-white/30 mt-1.5">Only visible to recruiters who have booked you</p>
            </div>
          </div>

          {/* Creative Profile */}
          <div className={sectionCls}>
            <SectionHeader icon={Briefcase} title="Creative Profile" />
            <div>
              <label className={labelCls}>Creative Disciplines</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {CREATIVE_DISCIPLINES.map((style) => (
                  <button
                    key={style}
                    type="button"
                    onClick={() => toggleStyle(style)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                      styles.includes(style)
                        ? "bg-violet-600 border-violet-500 text-white"
                        : "bg-white/5 border-white/10 text-white/50 hover:text-white hover:border-white/25"
                    }`}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Years Experience</label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={experienceYears}
                  onChange={(e) => { setExperienceYears(parseInt(e.target.value) || 0); markDirty(); }}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Height (cm)</label>
                <input
                  type="number"
                  min={100}
                  max={250}
                  value={heightCm}
                  onChange={(e) => { setHeightCm(e.target.value === "" ? "" : parseInt(e.target.value)); markDirty(); }}
                  placeholder="e.g. 170"
                  className={inputCls}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Union Member</label>
                <div className="flex items-center gap-3 mt-2">
                  <button
                    type="button"
                    onClick={() => { setUnionMember((v) => !v); markDirty(); }}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      unionMember ? "bg-violet-600" : "bg-white/10"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        unionMember ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                  <span className="text-sm text-white/60">{unionMember ? "Yes" : "No"}</span>
                </div>
              </div>
              <div>
                <label className={labelCls}>Represented</label>
                <div className="flex items-center gap-3 mt-2">
                  <button
                    type="button"
                    onClick={() => { setRepresented((v) => !v); markDirty(); }}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      represented ? "bg-violet-600" : "bg-white/10"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        represented ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                  <span className="text-sm text-white/60">{represented ? "Yes" : "No"}</span>
                </div>
              </div>
            </div>
            {represented && (
              <div>
                <label className={labelCls}>Represented By</label>
                <input
                  value={representedBy}
                  onChange={(e) => { setRepresentedBy(e.target.value); markDirty(); }}
                  placeholder="Agency or management company name"
                  className={inputCls}
                />
              </div>
            )}
          </div>

          {/* Availability & Travel */}
          <div className={sectionCls}>
            <SectionHeader icon={MapPin} title="Availability & Travel" />
            {/* Quick toggle */}
            <div className="flex items-center justify-between py-2 border-b border-white/5 mb-1">
              <div>
                <div className="text-sm font-medium">Available for Bookings</div>
                <div className="text-xs text-white/40">Let recruiters know you&apos;re open to work</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = availabilityStatus === "unavailable" ? "available" : "unavailable";
                  setAvailabilityStatus(next);
                  markDirty();
                }}
                className={`relative w-11 h-6 rounded-full transition-colors ${availabilityStatus !== "unavailable" ? "bg-green-600" : "bg-white/10"}`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${availabilityStatus !== "unavailable" ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Availability Status</label>
                <select
                  value={availabilityStatus}
                  onChange={(e) => { setAvailabilityStatus(e.target.value); markDirty(); }}
                  className={selectCls}
                >
                  <option value="available">Available Now</option>
                  <option value="limited">Limited Availability</option>
                  <option value="unavailable">Not Available</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Travel Willingness</label>
                <select
                  value={travelWillingness}
                  onChange={(e) => { setTravelWillingness(e.target.value); markDirty(); }}
                  className={selectCls}
                >
                  <option value="local_only">Local Only</option>
                  <option value="regional">Regional</option>
                  <option value="national">National</option>
                  <option value="international">International</option>
                </select>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── RECRUITER SECTIONS ── */}
      {isRecruiter && (
        <>
          {/* Personal Info */}
          <div className={sectionCls}>
            <SectionHeader icon={User} title="Personal Info" />
            <div>
              <label className={labelCls}>Display Name</label>
              <input
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); markDirty(); }}
                placeholder="Your name"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Bio</label>
              <textarea
                value={bio}
                onChange={(e) => { setBio(e.target.value); markDirty(); }}
                rows={3}
                placeholder="Tell creatives about your work..."
                className={`${inputCls} resize-none`}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>
                  <MapPin className="inline w-3 h-3 mr-1 -mt-0.5" />
                  Location
                </label>
                <input
                  value={location}
                  onChange={(e) => { setLocation(e.target.value); markDirty(); }}
                  placeholder="Los Angeles, CA"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>
                  <Globe className="inline w-3 h-3 mr-1 -mt-0.5" />
                  Website
                </label>
                <input
                  value={websiteUrl}
                  onChange={(e) => { setWebsiteUrl(e.target.value); markDirty(); }}
                  placeholder="https://yoursite.com"
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>
                <Phone className="inline w-3 h-3 mr-1 -mt-0.5" />
                Phone
              </label>
              <div className="relative">
                <input
                  type={showPhone ? "text" : "password"}
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); markDirty(); }}
                  placeholder="+1 (555) 000-0000"
                  className={`${inputCls} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPhone((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 transition-colors"
                >
                  {showPhone ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Company Details */}
          <div className={sectionCls}>
            <SectionHeader icon={Building2} title="Company Details" />
            {profileData?.recruiter_profile?.is_verified && (
              <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/25 rounded-xl px-4 py-2.5 text-sm text-green-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Verified recruiter: identity and company confirmed by EGATS
              </div>
            )}
            <div>
              <label className={labelCls}>Company Name</label>
              <input
                value={companyName}
                onChange={(e) => { setCompanyName(e.target.value); markDirty(); }}
                placeholder="Company or agency name"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Company Description</label>
              <textarea
                value={companyDescription}
                onChange={(e) => {
                  if (e.target.value.length <= 300) {
                    setCompanyDescription(e.target.value);
                    markDirty();
                  }
                }}
                rows={3}
                maxLength={300}
                placeholder="Describe your company, what you do, and the kind of talent you seek..."
                className={`${inputCls} resize-none`}
              />
              <p className="text-xs text-white/30 mt-1.5 text-right">{companyDescription.length}/300</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Company Size</label>
                <select
                  value={companySize}
                  onChange={(e) => { setCompanySize(e.target.value); markDirty(); }}
                  className={selectCls}
                >
                  <option value="">Select size</option>
                  <option value="1-10">1–10 employees</option>
                  <option value="11-50">11–50 employees</option>
                  <option value="51-200">51–200 employees</option>
                  <option value="200+">200+ employees</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Industry</label>
                <select
                  value={companyIndustry}
                  onChange={(e) => { setCompanyIndustry(e.target.value); markDirty(); }}
                  className={selectCls}
                >
                  <option value="">Select industry</option>
                  <option value="Entertainment">Entertainment</option>
                  <option value="Music Industry">Music Industry</option>
                  <option value="Film/TV">Film/TV</option>
                  <option value="Theater">Theater</option>
                  <option value="Fashion">Fashion</option>
                  <option value="Advertising">Advertising</option>
                  <option value="Events">Events</option>
                  <option value="Sports">Sports</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Company Type</label>
                <select
                  value={recruiterType}
                  onChange={(e) => { setRecruiterType(e.target.value); markDirty(); }}
                  className={selectCls}
                >
                  <option value="agency">Agency</option>
                  <option value="production">Production</option>
                  <option value="brand">Brand</option>
                  <option value="label">Label</option>
                  <option value="independent">Independent</option>
                  <option value="casting">Casting</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Years in Industry</label>
                <input
                  type="number"
                  min={0}
                  value={yearsInIndustry}
                  onChange={(e) => { setYearsInIndustry(parseInt(e.target.value) || 0); markDirty(); }}
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>
                <Globe className="inline w-3 h-3 mr-1 -mt-0.5" />
                Company Website
              </label>
              <input
                value={companyWebsite}
                onChange={(e) => { setCompanyWebsite(e.target.value); markDirty(); }}
                placeholder="https://yourcompany.com"
                className={inputCls}
              />
            </div>
          </div>
        </>
      )}

      {/* Social Links — shown for both roles */}
      <div className={sectionCls}>
        <SectionHeader icon={Link2} title="Social Links" />
        <div>
          <label className={labelCls}>Instagram</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 text-sm select-none">@</span>
            <input
              value={instagramHandle}
              onChange={(e) => { setInstagramHandle(e.target.value.replace(/^@/, "")); markDirty(); }}
              placeholder="yourhandle"
              className={`${inputCls} pl-8`}
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>TikTok</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 text-sm select-none">@</span>
            <input
              value={tiktokHandle}
              onChange={(e) => { setTiktokHandle(e.target.value.replace(/^@/, "")); markDirty(); }}
              placeholder="yourhandle"
              className={`${inputCls} pl-8`}
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>YouTube URL</label>
          <input
            value={youtubeUrl}
            onChange={(e) => { setYoutubeUrl(e.target.value); markDirty(); }}
            placeholder="https://youtube.com/@yourchannel"
            className={inputCls}
          />
        </div>
      </div>

      {/* My Reviews — read-only, shown for both roles */}
      <MyReviews />

      {/* Verification Status — dancer only */}
      {isDancer && profileData?.dancer_profile && (
        <div className={sectionCls}>
          <SectionHeader icon={ShieldCheck} title="Verification Status" />
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs text-white/40 mb-2">Current tier</p>
              <VerificationBadge
                tier={profileData.dancer_profile.verification_tier}
                size="md"
                showLabel
              />
            </div>
            <a
              href="/dashboard/verification"
              className="flex items-center gap-1.5 text-sm text-violet-400 hover:text-violet-300 transition-colors font-medium"
            >
              View history &amp; apply
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
          {profileData.dancer_profile.verification_tier === "0" && (
            <p className="text-xs text-white/35 leading-relaxed mt-1">
              Get verified to unlock premium job listings, appear higher in search results, and show recruiters you&apos;re a legitimate professional.
            </p>
          )}
        </div>
      )}

      {/* Save */}
      <div className="flex items-center gap-4 pb-4">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold px-8 py-3.5 rounded-xl transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : "Save Profile"}
        </button>
        {isDirty && !saving && (
          <span className="text-xs text-white/30">Unsaved changes</span>
        )}
      </div>
    </div>
  );
}
