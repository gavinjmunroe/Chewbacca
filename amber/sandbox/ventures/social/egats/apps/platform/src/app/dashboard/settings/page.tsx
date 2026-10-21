"use client";

import { useState, useEffect, useCallback } from "react";
import { Shield, Lock, UserX, Trash2, ChevronDown, X, AlertTriangle, Bell, KeyRound, AtSign, User, Download, Database, Link2 } from "lucide-react";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://egats.com";
import { useBeforeUnload } from "@/lib/use-before-unload";
import { createClient } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProfileVisibility = "everyone" | "verified_recruiters" | "tier2_recruiters" | "nobody";

interface PrivacySettings {
  user_id: string;
  profile_visible_to: ProfileVisibility;
  show_contact_info: boolean;
  show_phone: boolean;
  allow_ai_matching: boolean;
  allow_direct_messages: boolean;
  updated_at: string;
}

interface BlockedUser {
  blocked_id: string;
  created_at: string;
  blocked_profile: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    role: string;
  };
}

const VALID_CATEGORIES = [
  { value: "harassment", label: "Harassment or Bullying" },
  { value: "inappropriate_content", label: "Inappropriate Content" },
  { value: "fraud", label: "Fraud or Scam" },
  { value: "impersonation", label: "Impersonation" },
  { value: "underage", label: "Underage User" },
  { value: "other", label: "Other" },
] as const;

const VISIBILITY_OPTIONS: { value: ProfileVisibility; label: string; description: string }[] = [
  {
    value: "everyone",
    label: "Everyone",
    description: "Any visitor can see your profile",
  },
  {
    value: "verified_recruiters",
    label: "Verified Recruiters",
    description: "Only verified recruiters can find you",
  },
  {
    value: "tier2_recruiters",
    label: "Tier 2+ Recruiters Only",
    description: "Only top-tier verified recruiters",
  },
  {
    value: "nobody",
    label: "Nobody",
    description: "Your profile is hidden from all searches",
  },
];

// ---------------------------------------------------------------------------
// Toggle component
// ---------------------------------------------------------------------------

function Toggle({
  enabled,
  onChange,
  label,
  description,
}: {
  enabled: boolean;
  onChange: (val: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium text-white/85">{label}</p>
        {description && <p className="text-[12px] text-white/40 mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none ${
          enabled ? "bg-violet-500" : "bg-white/[0.12]"
        }`}
        aria-checked={enabled}
        role="switch"
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report Modal
// ---------------------------------------------------------------------------

function ReportModal({ onClose }: { onClose: () => void }) {
  const [reportedUserId, setReportedUserId] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!reportedUserId.trim()) {
      setError("Please enter the user ID to report.");
      return;
    }
    if (!category) {
      setError("Please select a category.");
      return;
    }
    if (description.trim().length < 20) {
      setError("Description must be at least 20 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportedUserId: reportedUserId.trim(),
          category,
          description: description.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to submit report.");
        return;
      }

      setSuccess(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-lg bg-[#1c1c1e] border border-white/[0.1] rounded-2xl shadow-2xl p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white/85 hover:bg-white/[0.08] transition-all"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className="text-[18px] font-bold text-white mb-1">Report a User</h2>
        <p className="text-[13px] text-white/40 mb-5">
          All reports are confidential and reviewed by our safety team.
        </p>

        {success ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-green-500/15 flex items-center justify-center mx-auto mb-3">
              <Shield className="w-6 h-6 text-green-400" />
            </div>
            <p className="text-[15px] font-semibold text-white">Report Submitted</p>
            <p className="text-[13px] text-white/40 mt-1 mb-4">
              Our team will review this within 24 hours.
            </p>
            <button
              onClick={onClose}
              className="px-5 py-2 bg-violet-500 hover:bg-violet-600 rounded-xl text-[13px] font-semibold text-white transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-[12px] font-medium text-white/50 uppercase tracking-wider mb-1.5">
                User ID to Report
              </label>
              <input
                type="text"
                value={reportedUserId}
                onChange={(e) => setReportedUserId(e.target.value)}
                placeholder="Paste user ID (e.g. from their profile URL)"
                className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-violet-500/60"
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-white/50 uppercase tracking-wider mb-1.5">
                Category
              </label>
              <div className="relative">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full appearance-none bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-[14px] text-white focus:outline-none focus:ring-1 focus:ring-violet-500/60"
                >
                  <option value="" disabled className="bg-[#1c1c1e]">
                    Select a category...
                  </option>
                  {VALID_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value} className="bg-[#1c1c1e]">
                      {cat.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-white/50 uppercase tracking-wider mb-1.5">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what happened (minimum 20 characters)..."
                rows={4}
                className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-violet-500/60 resize-none"
              />
              <p className="text-[11px] text-white/25 mt-1">{description.trim().length} / 20 min</p>
            </div>

            {error && (
              <div role="alert" className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5">
                <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-[13px] text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 bg-white/[0.06] hover:bg-white/[0.1] rounded-xl text-[14px] font-medium text-white/60 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-[14px] font-semibold text-white transition-colors"
              >
                {submitting ? "Submitting..." : "Submit Report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete Account Modal
// ---------------------------------------------------------------------------

function DeleteAccountModal({ onClose }: { onClose: () => void }) {
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const REQUIRED_TEXT = "DELETE MY ACCOUNT";

  async function handleDelete() {
    if (confirmText !== REQUIRED_TEXT) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to delete account.");
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-[#1c1c1e] border border-red-500/20 rounded-2xl shadow-2xl p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white/85 hover:bg-white/[0.08] transition-all"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center shrink-0">
            <Trash2 className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-[17px] font-bold text-white">Delete Account</h2>
            <p className="text-[12px] text-red-400">This action is permanent and cannot be undone.</p>
          </div>
        </div>

        <p className="text-[13px] text-white/50 mb-4">
          All your data, bookings, reviews, portfolio clips, and profile information will be
          permanently deleted. To confirm, type{" "}
          <span className="font-mono font-bold text-white/80">{REQUIRED_TEXT}</span> below.
        </p>

        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={REQUIRED_TEXT}
          className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/20 font-mono focus:outline-none focus:ring-1 focus:ring-red-500/60 mb-4"
        />

        {error && (
          <div role="alert" className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-[13px] text-red-400">{error}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-white/[0.06] hover:bg-white/[0.1] rounded-xl text-[14px] font-medium text-white/60 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={confirmText !== REQUIRED_TEXT || deleting}
            className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-[14px] font-semibold text-white transition-colors"
          >
            {deleting ? "Deleting..." : "Delete Forever"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

interface NotificationPrefs {
  notification_email_bookings: boolean;
  notification_email_applications: boolean;
  notification_email_messages: boolean;
  notification_push_enabled: boolean;
}

const NOTIFICATION_DEFAULTS: NotificationPrefs = {
  notification_email_bookings: true,
  notification_email_applications: true,
  notification_email_messages: true,
  notification_push_enabled: false,
};

export default function SettingsPage() {
  const [privacy, setPrivacy] = useState<PrivacySettings | null>(null);
  const [privacyLoading, setPrivacyLoading] = useState(true);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacySaved, setPrivacySaved] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [privacyDirty, setPrivacyDirty] = useState(false);

  // Warn before navigating away with unsaved privacy changes
  useBeforeUnload(privacyDirty);

  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [blockedLoading, setBlockedLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  const [showReportModal, setShowReportModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Password change state
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState(false);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (newPw.length < 8) { setPwError("Password must be at least 8 characters"); return; }
    if (newPw !== confirmPw) { setPwError("Passwords don't match"); return; }
    setPwSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwSaving(false);
    if (error) { setPwError(error.message); return; }
    setPwSaved(true);
    setCurrentPw(""); setNewPw(""); setConfirmPw("");
    setTimeout(() => setPwSaved(false), 3000);
  }

  // Email change state
  const [newEmail, setNewEmail] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  async function handleEmailChange(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);
    setEmailSuccess(null);
    if (!newEmail.trim()) { setEmailError("Please enter a new email address"); return; }
    setEmailSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ email: newEmail });
    setEmailSaving(false);
    if (error) { setEmailError(error.message); return; }
    setEmailSuccess("Confirmation sent to " + newEmail + ". Check your inbox.");
    setNewEmail("");
  }

  // Username state
  const [username, setUsername] = useState("");
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameSaved, setUsernameSaved] = useState(false);

  const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

  async function checkUsernameAvailability(val: string) {
    if (!USERNAME_RE.test(val)) { setUsernameAvailable(null); return; }
    setUsernameChecking(true);
    try {
      const res = await fetch(`/api/check-username?u=${encodeURIComponent(val)}`);
      const data = await res.json();
      setUsernameAvailable(data.available);
    } catch {
      setUsernameAvailable(null);
    } finally {
      setUsernameChecking(false);
    }
  }

  function handleUsernameInput(val: string) {
    const clean = val.toLowerCase().replace(/[^a-z0-9_]/g, "");
    setUsername(clean);
    setUsernameAvailable(null);
    setUsernameError(null);
    setUsernameSaved(false);
  }

  async function handleUsernameSave(e: React.FormEvent) {
    e.preventDefault();
    setUsernameError(null);
    if (!USERNAME_RE.test(username)) {
      setUsernameError("Username must be 3-30 characters, lowercase letters, numbers, and underscores only");
      return;
    }
    if (usernameAvailable === false) { setUsernameError("That username is already taken"); return; }
    setUsernameSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok) { setUsernameError(data.error ?? "Failed to save username"); return; }
      setUsernameSaved(true);
      setTimeout(() => setUsernameSaved(false), 3000);
    } catch {
      setUsernameError("Network error. Please try again.");
    } finally {
      setUsernameSaving(false);
    }
  }

  // Notification preferences state
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(NOTIFICATION_DEFAULTS);
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifSaving, setNotifSaving] = useState<string | null>(null); // key being saved

  // Referral state
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);

  // Fetch privacy settings
  const fetchPrivacy = useCallback(async () => {
    setPrivacyLoading(true);
    try {
      const res = await fetch("/api/privacy");
      if (res.ok) {
        const data = await res.json();
        setPrivacy(data);
      }
    } finally {
      setPrivacyLoading(false);
    }
  }, []);

  // Fetch blocked users
  const fetchBlocked = useCallback(async () => {
    setBlockedLoading(true);
    try {
      const res = await fetch("/api/privacy/block");
      if (res.ok) {
        const data = await res.json();
        setBlockedUsers(data);
      }
    } finally {
      setBlockedLoading(false);
    }
  }, []);

  // Fetch notification preferences
  const fetchNotifPrefs = useCallback(async () => {
    setNotifLoading(true);
    try {
      const res = await fetch("/api/notification-preferences");
      if (res.ok) {
        const data = await res.json();
        setNotifPrefs({ ...NOTIFICATION_DEFAULTS, ...data });
      }
    } finally {
      setNotifLoading(false);
    }
  }, []);

  async function handleNotifToggle(key: keyof NotificationPrefs, value: boolean) {
    // Optimistic update
    setNotifPrefs((prev) => ({ ...prev, [key]: value }));
    setNotifSaving(key);
    try {
      await fetch("/api/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
    } catch {
      // Revert on error
      setNotifPrefs((prev) => ({ ...prev, [key]: !value }));
    } finally {
      setNotifSaving(null);
    }
  }

  // Fetch referral code
  const fetchReferralCode = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("referral_code")
        .eq("id", user.id)
        .single();
      if (data?.referral_code) setReferralCode(data.referral_code);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchPrivacy();
    fetchBlocked();
    fetchNotifPrefs();
    fetchReferralCode();
  }, [fetchPrivacy, fetchBlocked, fetchNotifPrefs, fetchReferralCode]);

  async function savePrivacy() {
    if (!privacy) return;
    setPrivacySaving(true);
    setPrivacyError(null);
    setPrivacySaved(false);
    try {
      const res = await fetch("/api/privacy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileVisibleTo: privacy.profile_visible_to,
          showContactInfo: privacy.show_contact_info,
          showPhone: privacy.show_phone,
          allowAiMatching: privacy.allow_ai_matching,
          allowDirectMessages: privacy.allow_direct_messages,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPrivacyError(data.error ?? "Failed to save settings.");
        return;
      }
      setPrivacy(data);
      setPrivacyDirty(false);
      setPrivacySaved(true);
      setTimeout(() => setPrivacySaved(false), 3000);
    } catch {
      setPrivacyError("Network error. Please try again.");
    } finally {
      setPrivacySaving(false);
    }
  }

  async function handleUnblock(userId: string) {
    setUnblockingId(userId);
    try {
      const res = await fetch("/api/privacy/block", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) {
        setBlockedUsers((prev) => prev.filter((b) => b.blocked_id !== userId));
      }
    } finally {
      setUnblockingId(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-[26px] font-bold text-white tracking-tight">Settings</h1>
        <p className="text-[14px] text-white/40 mt-1">
          Manage your privacy, safety, and account preferences.
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* NOTIFICATIONS                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section className="bg-white/[0.04] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.07] flex items-center gap-2.5">
          <Bell className="w-4 h-4 text-violet-400" />
          <h2 className="text-[15px] font-semibold text-white">Notifications</h2>
        </div>

        <div className="px-6 py-4">
          {notifLoading ? (
            <div className="space-y-3 py-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-10 bg-white/[0.05] rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              <Toggle
                enabled={notifPrefs.notification_email_bookings}
                onChange={(v) => handleNotifToggle("notification_email_bookings", v)}
                label="Booking notifications"
                description={notifSaving === "notification_email_bookings" ? "Saving…" : "Email me when a booking is confirmed or updated"}
              />
              <div className="border-t border-white/[0.06]" />
              <Toggle
                enabled={notifPrefs.notification_email_applications}
                onChange={(v) => handleNotifToggle("notification_email_applications", v)}
                label="Application notifications"
                description={notifSaving === "notification_email_applications" ? "Saving…" : "Email me when someone applies to my job posts"}
              />
              <div className="border-t border-white/[0.06]" />
              <Toggle
                enabled={notifPrefs.notification_email_messages}
                onChange={(v) => handleNotifToggle("notification_email_messages", v)}
                label="Message notifications"
                description={notifSaving === "notification_email_messages" ? "Saving…" : "Email me when I receive a direct message"}
              />
              <div className="border-t border-white/[0.06]" />
              <Toggle
                enabled={notifPrefs.notification_push_enabled}
                onChange={(v) => handleNotifToggle("notification_push_enabled", v)}
                label="Push notifications"
                description={notifSaving === "notification_push_enabled" ? "Saving…" : "Receive push notifications in your browser"}
              />
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* PRIVACY & VISIBILITY                                                 */}
      {/* ------------------------------------------------------------------ */}
      <section className="bg-white/[0.04] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.07] flex items-center gap-2.5">
          <Lock className="w-4 h-4 text-violet-400" />
          <h2 className="text-[15px] font-semibold text-white">Privacy &amp; Visibility</h2>
        </div>

        <div className="px-6 py-4">
          {privacyLoading ? (
            <div className="space-y-3 py-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 bg-white/[0.05] rounded-xl animate-pulse" />
              ))}
            </div>
          ) : privacy ? (
            <div className="space-y-1">
              {/* Profile visibility */}
              <div className="py-3">
                <p className="text-[14px] font-medium text-white/85 mb-1.5">Profile visible to</p>
                <p className="text-[12px] text-white/40 mb-2.5">
                  Control who can find and view your dancer profile.
                </p>
                <div className="relative">
                  <select
                    value={privacy.profile_visible_to}
                    onChange={(e) => {
                      setPrivacy((prev) =>
                        prev ? { ...prev, profile_visible_to: e.target.value as ProfileVisibility } : prev
                      );
                      setPrivacyDirty(true);
                    }}
                    className="w-full appearance-none bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-[14px] text-white focus:outline-none focus:ring-1 focus:ring-violet-500/60"
                  >
                    {VISIBILITY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value} className="bg-[#1c1c1e]">
                        {opt.label}: {opt.description}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                </div>
              </div>

              <div className="border-t border-white/[0.06]" />

              <Toggle
                enabled={privacy.show_contact_info}
                onChange={(v) => { setPrivacy((prev) => (prev ? { ...prev, show_contact_info: v } : prev)); setPrivacyDirty(true); }}
                label="Share contact info with recruiters"
                description="Allows verified recruiters to see your email address"
              />

              <div className="border-t border-white/[0.06]" />

              <Toggle
                enabled={privacy.show_phone}
                onChange={(v) => { setPrivacy((prev) => (prev ? { ...prev, show_phone: v } : prev)); setPrivacyDirty(true); }}
                label="Show phone number"
                description="Displays your phone number on your profile"
              />

              <div className="border-t border-white/[0.06]" />

              <Toggle
                enabled={privacy.allow_ai_matching}
                onChange={(v) => { setPrivacy((prev) => (prev ? { ...prev, allow_ai_matching: v } : prev)); setPrivacyDirty(true); }}
                label="Allow AI matching"
                description="Let EGATS AI recommend you for relevant jobs and opportunities"
              />

              <div className="border-t border-white/[0.06]" />

              <Toggle
                enabled={privacy.allow_direct_messages}
                onChange={(v) => {
                  setPrivacy((prev) => (prev ? { ...prev, allow_direct_messages: v } : prev));
                  setPrivacyDirty(true);
                }}
                label="Allow direct messages"
                description="Recruiters and collaborators can message you directly"
              />

              {privacyError && (
                <div role="alert" className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5 mt-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                  <p className="text-[13px] text-red-400">{privacyError}</p>
                </div>
              )}

              <div className="pt-3 flex items-center gap-3">
                <button
                  onClick={savePrivacy}
                  disabled={privacySaving}
                  className="px-5 py-2 bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-[13px] font-semibold text-white transition-colors"
                >
                  {privacySaving ? "Saving..." : "Save Changes"}
                </button>
                {privacySaved && (
                  <div className="flex items-center gap-1.5 text-green-400">
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-[13px] font-semibold">Saved!</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-white/40 py-4">Failed to load privacy settings.</p>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* SAFETY                                                               */}
      {/* ------------------------------------------------------------------ */}
      <section className="bg-white/[0.04] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.07] flex items-center gap-2.5">
          <Shield className="w-4 h-4 text-violet-400" />
          <h2 className="text-[15px] font-semibold text-white">Safety</h2>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Report a User */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[14px] font-medium text-white/85">Report a User</p>
              <p className="text-[12px] text-white/40 mt-0.5">
                Report harassment, fraud, inappropriate behavior, or other violations.
              </p>
            </div>
            <button
              onClick={() => setShowReportModal(true)}
              className="shrink-0 px-4 py-2 bg-red-500/15 hover:bg-red-500/25 border border-red-500/20 rounded-xl text-[13px] font-semibold text-red-400 transition-colors"
            >
              Report
            </button>
          </div>

          <div className="border-t border-white/[0.07]" />

          {/* Blocked Users */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <UserX className="w-4 h-4 text-white/40" />
              <p className="text-[14px] font-medium text-white/85">Blocked Users</p>
              {blockedUsers.length > 0 && (
                <span className="ml-auto text-[11px] font-semibold bg-white/[0.08] text-white/40 px-2 py-0.5 rounded-full">
                  {blockedUsers.length}
                </span>
              )}
            </div>

            {blockedLoading ? (
              <div className="space-y-2">
                {[...Array(2)].map((_, i) => (
                  <div key={i} className="h-12 bg-white/[0.04] rounded-xl animate-pulse" />
                ))}
              </div>
            ) : blockedUsers.length === 0 ? (
              <p className="text-[13px] text-white/30 py-2">You have not blocked anyone.</p>
            ) : (
              <ul className="space-y-2">
                {blockedUsers.map((b) => (
                  <li
                    key={b.blocked_id}
                    className="flex items-center gap-3 bg-white/[0.04] rounded-xl px-3.5 py-2.5"
                  >
                    <div className="w-8 h-8 rounded-full bg-white/[0.08] flex items-center justify-center text-[11px] font-bold text-white/40 shrink-0 overflow-hidden">
                      {b.blocked_profile.avatar_url ? (
                        // eslint_disable-next-line @next/next/no-img-element
                        <img
                          src={b.blocked_profile.avatar_url}
                          alt={b.blocked_profile.display_name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        b.blocked_profile.display_name.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-white/80 truncate">
                        {b.blocked_profile.display_name}
                      </p>
                      <p className="text-[11px] text-white/30 capitalize">{b.blocked_profile.role}</p>
                    </div>
                    <button
                      onClick={() => handleUnblock(b.blocked_id)}
                      disabled={unblockingId === b.blocked_id}
                      className="shrink-0 px-3 py-1.5 bg-white/[0.07] hover:bg-white/[0.12] disabled:opacity-50 rounded-lg text-[12px] font-medium text-white/50 transition-colors"
                    >
                      {unblockingId === b.blocked_id ? "Unblocking..." : "Unblock"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-white/[0.07]" />

          {/* Your Data — brief note; full controls in Privacy & Data section below */}
          <div>
            <p className="text-[14px] font-medium text-white/85 mb-1">Your Data</p>
            <p className="text-[13px] text-white/40 leading-relaxed">
              You have the right to access, correct, or delete your personal data at any time. See
              the <span className="text-violet-400">Privacy &amp; Data</span> section below to download
              your data. To contact our privacy team, email{" "}
              <a
                href="mailto:privacy@egats.com"
                className="text-violet-400 hover:text-violet-300 underline underline-offset-2"
              >
                privacy@egats.com
              </a>
              .
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* PRIVACY & DATA                                                       */}
      {/* ------------------------------------------------------------------ */}
      <section className="bg-white/[0.04] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.07] flex items-center gap-2.5">
          <Database className="w-4 h-4 text-violet-400" />
          <h2 className="text-[15px] font-semibold text-white">Privacy &amp; Data</h2>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-[13px] text-white/40 leading-relaxed">
            Your data export includes your profile, applications, bookings, reviews, and notification history.
            Under GDPR and similar regulations, you have the right to a copy of all your personal data.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="/api/export/my-data"
              download
              className="flex items-center gap-2 px-5 py-2.5 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/25 rounded-xl text-[13px] font-semibold text-violet-300 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download My Data
            </a>
            <a
              href="/api/export/bookings"
              download
              className="flex items-center gap-2 px-5 py-2.5 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] rounded-xl text-[13px] font-semibold text-white/60 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download Bookings CSV
            </a>
          </div>

          <p className="text-[11px] text-white/25">
            Downloads are generated in real-time and include all data associated with your account.
            For deletion requests, contact{" "}
            <a href="mailto:privacy@egats.com" className="text-violet-400/70 hover:text-violet-400 underline underline-offset-2">
              privacy@egats.com
            </a>.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* ACCOUNT — CHANGE EMAIL                                               */}
      {/* ------------------------------------------------------------------ */}
      <section className="bg-white/[0.04] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.07] flex items-center gap-2.5">
          <AtSign className="w-4 h-4 text-violet-400" />
          <h2 className="text-[15px] font-semibold text-white">Change Email</h2>
        </div>

        <form onSubmit={handleEmailChange} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-white/50 uppercase tracking-wider mb-1.5">
              New Email Address
            </label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => { setNewEmail(e.target.value); setEmailError(null); setEmailSuccess(null); }}
              placeholder="your@newemail.com"
              className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-violet-500/60"
            />
            <p className="text-[11px] text-white/25 mt-1.5">A confirmation link will be sent to your new address before the change takes effect.</p>
          </div>

          {emailError && (
            <div role="alert" className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-[13px] text-red-400">{emailError}</p>
            </div>
          )}
          {emailSuccess && (
            <div className="flex items-start gap-2.5 bg-green-500/10 border border-green-500/20 rounded-xl px-3.5 py-2.5">
              <svg className="w-4 h-4 text-green-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-[13px] text-green-400">{emailSuccess}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={emailSaving || !newEmail.trim()}
            className="px-5 py-2 bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-[13px] font-semibold text-white transition-colors"
          >
            {emailSaving ? "Sending..." : "Send Confirmation"}
          </button>
        </form>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* ACCOUNT — CHANGE PASSWORD                                            */}
      {/* ------------------------------------------------------------------ */}
      <section className="bg-white/[0.04] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.07] flex items-center gap-2.5">
          <KeyRound className="w-4 h-4 text-violet-400" />
          <h2 className="text-[15px] font-semibold text-white">Change Password</h2>
        </div>

        <form onSubmit={handlePasswordChange} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-white/50 uppercase tracking-wider mb-1.5">
              Current Password
            </label>
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              placeholder="Your current password"
              autoComplete="current-password"
              className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-violet-500/60"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-white/50 uppercase tracking-wider mb-1.5">
              New Password
            </label>
            <input
              type="password"
              value={newPw}
              onChange={(e) => { setNewPw(e.target.value); setPwError(null); }}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-violet-500/60"
            />
            {/* Strength indicator */}
            {newPw.length > 0 && (
              <div className="mt-2 space-y-1">
                <div className="flex gap-1">
                  {[
                    newPw.length >= 8,
                    /[A-Z]/.test(newPw),
                    /[0-9]/.test(newPw),
                    /[^A-Za-z0-9]/.test(newPw),
                  ].map((met, i) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        met
                          ? [newPw.length >= 8, /[A-Z]/.test(newPw), /[0-9]/.test(newPw), /[^A-Za-z0-9]/.test(newPw)].filter(Boolean).length >= 4
                            ? "bg-green-500"
                            : [newPw.length >= 8, /[A-Z]/.test(newPw), /[0-9]/.test(newPw), /[^A-Za-z0-9]/.test(newPw)].filter(Boolean).length >= 2
                            ? "bg-amber-500"
                            : "bg-red-500"
                          : "bg-white/[0.1]"
                      }`}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-white/30">
                  {(() => {
                    const score = [newPw.length >= 8, /[A-Z]/.test(newPw), /[0-9]/.test(newPw), /[^A-Za-z0-9]/.test(newPw)].filter(Boolean).length;
                    return score >= 4 ? "Strong password" : score >= 2 ? "Fair. Add uppercase, numbers, or symbols." : "Weak. Needs more length, uppercase, and numbers.";
                  })()}
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="block text-[12px] font-medium text-white/50 uppercase tracking-wider mb-1.5">
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => { setConfirmPw(e.target.value); setPwError(null); }}
              placeholder="Repeat new password"
              autoComplete="new-password"
              className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-violet-500/60"
            />
            {confirmPw.length > 0 && newPw !== confirmPw && (
              <p className="text-[11px] text-red-400 mt-1">Passwords don&apos;t match</p>
            )}
          </div>

          {pwError && (
            <div role="alert" className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-[13px] text-red-400">{pwError}</p>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={pwSaving || !newPw || !confirmPw}
              className="px-5 py-2 bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-[13px] font-semibold text-white transition-colors"
            >
              {pwSaving ? "Updating..." : "Update Password"}
            </button>
            {pwSaved && (
              <div className="flex items-center gap-1.5 text-green-400">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-[13px] font-semibold">Password updated!</span>
              </div>
            )}
          </div>
        </form>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* ACCOUNT — USERNAME                                                   */}
      {/* ------------------------------------------------------------------ */}
      <section className="bg-white/[0.04] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.07] flex items-center gap-2.5">
          <User className="w-4 h-4 text-violet-400" />
          <h2 className="text-[15px] font-semibold text-white">Username</h2>
        </div>

        <form onSubmit={handleUsernameSave} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-white/50 uppercase tracking-wider mb-1.5">
              Set Your Username
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 text-[14px] select-none">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) => handleUsernameInput(e.target.value)}
                onBlur={() => username.length >= 3 && checkUsernameAvailability(username)}
                placeholder="yourhandle"
                maxLength={30}
                className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl pl-8 pr-3.5 py-2.5 text-[14px] text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-violet-500/60"
              />
              {usernameChecking && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border border-white/30 border-t-transparent rounded-full animate-spin" />
              )}
              {!usernameChecking && usernameAvailable === true && (
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {!usernameChecking && usernameAvailable === false && (
                <X className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-400" />
              )}
            </div>
            <p className="text-[11px] text-white/25 mt-1.5">
              3–30 characters. Lowercase letters, numbers, and underscores only.
              {usernameAvailable === true && <span className="text-green-400 ml-1">Username is available!</span>}
              {usernameAvailable === false && <span className="text-red-400 ml-1">Already taken.</span>}
            </p>
          </div>

          {usernameError && (
            <div role="alert" className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-[13px] text-red-400">{usernameError}</p>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={usernameSaving || !username || usernameAvailable === false || !USERNAME_RE.test(username)}
              className="px-5 py-2 bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-[13px] font-semibold text-white transition-colors"
            >
              {usernameSaving ? "Saving..." : "Save Username"}
            </button>
            {usernameSaved && (
              <div className="flex items-center gap-1.5 text-green-400">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-[13px] font-semibold">Username saved!</span>
              </div>
            )}
          </div>
        </form>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* REFER A FRIEND                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section className="bg-white/[0.04] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.07] flex items-center gap-2.5">
          <Link2 className="w-4 h-4 text-violet-400" />
          <h2 className="text-[15px] font-semibold text-white">Refer a Friend</h2>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-[13px] text-white/50">
            Share your referral link and invite friends to join EGATS.
          </p>

          {referralCode ? (
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-white/50 uppercase tracking-wider mb-1.5">
                  Your Referral Link
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`${APP_URL}/signup?ref=${referralCode}`}
                    className="flex-1 bg-white/[0.06] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-[13px] text-white/70 font-mono focus:outline-none select-all"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`${APP_URL}/signup?ref=${referralCode}`).then(() => {
                        setReferralCopied(true);
                        setTimeout(() => setReferralCopied(false), 2500);
                      });
                    }}
                    className="shrink-0 px-4 py-2.5 bg-violet-500 hover:bg-violet-600 rounded-xl text-[13px] font-semibold text-white transition-colors"
                  >
                    {referralCopied ? "Copied!" : "Copy Link"}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-white/30">
                <span className="font-semibold text-white/50">0 friends joined</span>
                <span>via your link so far</span>
              </div>
            </div>
          ) : (
            <div className="h-10 bg-white/[0.03] rounded-xl animate-pulse" />
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* ACCOUNT — DANGER ZONE                                                */}
      {/* ------------------------------------------------------------------ */}
      <section className="bg-white/[0.04] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.07]">
          <h2 className="text-[15px] font-semibold text-white">Account</h2>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Delete Account */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[14px] font-medium text-red-400">Delete Account</p>
              <p className="text-[12px] text-white/40 mt-0.5">
                Permanently delete your account and all associated data. This cannot be undone.
              </p>
            </div>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/15 rounded-xl text-[13px] font-medium text-red-400 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        </div>
      </section>

      {/* Modals */}
      {showReportModal && <ReportModal onClose={() => setShowReportModal(false)} />}
      {showDeleteModal && <DeleteAccountModal onClose={() => setShowDeleteModal(false)} />}
    </div>
  );
}
