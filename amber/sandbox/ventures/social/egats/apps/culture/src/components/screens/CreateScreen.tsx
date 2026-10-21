"use client";
import React, { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CultureChallenge } from "@/lib/types";

interface Props {
  dispatch: React.Dispatch<{ type: "SET_TAB"; tab: "feed" }>;
  style: React.CSSProperties;
  challenge?: CultureChallenge | null;
}

const STEPS = ["Performance Clip", "Story & Credits", "Publish"];
const DANCE_STYLES = [
  "Hip-Hop", "Breaking", "Waacking", "Voguing", "House", "Krump",
  "Contemporary", "Popping", "Locking", "Afrobeats", "Ballet", "Dancehall",
];

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

export default function CreateScreen({ dispatch, style, challenge }: Props) {
  const [step, setStep] = useState(0);
  const [content, setContent] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setIsLoggedIn(!!data.user);
    });
  }, []);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setError("Video must be under 500MB");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setError(null);
    setSelectedFileName(file.name);
    setUploading(true);
    setUploadProgress(0);
    try {
      const supabase = createClient();
      const timestamp = Date.now();
      const random = Math.random().toString(36).slice(2, 8);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `posts/${timestamp}-${random}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("culture-media")
        .upload(path, file, { upsert: false });
      if (uploadError) {
        throw uploadError;
      }
      const { data: urlData } = supabase.storage
        .from("culture-media")
        .getPublicUrl(path);
      setMediaUrl(urlData.publicUrl);
      setUploadProgress(100);
    } catch {
      setError("Upload failed — please try a URL instead");
      setSelectedFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setUploading(false);
    }
  }

  function toggleStyle(s: string) {
    setSelectedStyles((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  async function handlePublish() {
    if (!content.trim()) {
      setError("Please add a caption describing your post.");
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch("/api/culture/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: content.trim(),
          media_url: mediaUrl.trim() || null,
          styles: selectedStyles,
          ...(challenge ? { challenge_id: challenge.id } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error || "Failed to publish post");
      } else {
        setPublished(true);
        setStep(3);
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setPublishing(false);
    }
  }

  // Auth loading state
  if (isLoggedIn === null) {
    return (
      <div style={{ ...style, background: "#050507", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid rgba(168,85,247,0.3)", borderTopColor: "#A855F7", animation: "spin 0.8s linear infinite" }} />
      </div>
    );
  }

  // Not logged in state
  if (isLoggedIn === false) {
    return (
      <div style={{ ...style, background: "#050507", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "52px 14px 12px", display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={() => dispatch({ type: "SET_TAB", tab: "feed" })} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2"><path d="M19 12H5m7-7-7 7 7 7"/></svg>
          </button>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>New Post</div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: "0 28px" }}>
          <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#A855F7" strokeWidth="1.5">
              <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
            </svg>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 8 }}>Sign in to post</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.7 }}>
              Join EGATS Culture to share your dance with context, credits, and community.
            </div>
          </div>
          <a href={process.env.NEXT_PUBLIC_PLATFORM_URL || "#"}
            style={{ width: "100%", padding: "14px 0", borderRadius: 14, background: "linear-gradient(135deg, #7C3AED, #EC4899)", border: "none", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", textDecoration: "none", textAlign: "center", display: "block", boxShadow: "0 8px 30px rgba(124,58,237,0.4)" }}>
            Sign In / Sign Up →
          </a>
        </div>
      </div>
    );
  }

  // Success state
  if (published || step === 3) {
    return (
      <div style={{ ...style, background: "#050507", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 28px", gap: 20 }}>
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: "linear-gradient(135deg, #7C3AED, #EC4899)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 8 }}>Posted!</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
            Your post is live on the EGATS Culture feed.
          </div>
        </div>
        <button
          onClick={() => dispatch({ type: "SET_TAB", tab: "feed" })}
          style={{ width: "100%", padding: "16px 0", borderRadius: 14, background: "linear-gradient(135deg, #7C3AED, #EC4899)", border: "none", color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer", boxShadow: "0 8px 30px rgba(124,58,237,0.4)" }}>
          Back to Feed
        </button>
      </div>
    );
  }

  const stepContent = () => {
    // Step 0: Media URL + caption
    if (step === 0) return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 20, padding: "0 16px 16px", overflowY: "auto" }}>
        {/* File upload */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 8 }}>
            Upload Video (optional)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileSelect}
            disabled={uploading}
            style={{ display: "none" }}
            id="video-upload-input"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{
              width: "100%", padding: "10px 14px", borderRadius: 12, boxSizing: "border-box",
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              color: uploading ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.7)",
              fontSize: 13, cursor: uploading ? "default" : "pointer", textAlign: "left",
              display: "flex", alignItems: "center", gap: 8, opacity: uploading ? 0.7 : 1,
            }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
            </svg>
            {uploading ? "Uploading…" : selectedFileName ? selectedFileName : "Choose video file"}
          </button>
          {uploading && (
            <div style={{ marginTop: 8, height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: "60%", background: "linear-gradient(135deg, #7C3AED, #EC4899)", borderRadius: 4, animation: "pulse 1.2s ease-in-out infinite" }} />
            </div>
          )}
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 5, lineHeight: 1.5 }}>
            Max 500MB. Or paste a URL below instead.
          </div>
        </div>

        {/* Error for file size */}
        {error && step === 0 && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 12, color: "#EF4444" }}>{error}</div>
          </div>
        )}

        {/* Media URL fallback */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 8 }}>
            Or Media URL
          </label>
          <input
            value={selectedFileName ? "" : mediaUrl}
            onChange={(e) => { setMediaUrl(e.target.value); setSelectedFileName(null); }}
            placeholder="https://your-video-or-image-url.com/..."
            disabled={!!selectedFileName}
            style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "10px 12px", color: "#fff", fontSize: 13, outline: "none", boxSizing: "border-box", opacity: selectedFileName ? 0.4 : 1 }}
          />
        </div>

        {/* Preview if URL given */}
        {mediaUrl.trim() && !selectedFileName && (
          <div style={{ aspectRatio: "1", borderRadius: 16, overflow: "hidden", background: "#111", border: "1px solid rgba(255,255,255,0.08)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaUrl.trim()} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          </div>
        )}

        {!mediaUrl.trim() && !selectedFileName && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", aspectRatio: "1", borderRadius: 16, background: "rgba(168,85,247,0.08)", border: "2px dashed rgba(168,85,247,0.25)", gap: 12 }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(168,85,247,0.5)" strokeWidth="1.5">
              <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
            </svg>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>Upload a video or add a media URL to preview your clip</div>
          </div>
        )}

        <div style={{ background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#A855F7", marginBottom: 6 }}>EGATS Culture requires 2 clips:</div>
          {["1. Your performance — the actual dance", "2. Your story — inspiration, influences, credits"].map((q) => (
            <div key={q} style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>{q}</div>
          ))}
        </div>
      </div>
    );

    // Step 1: Caption + styles
    if (step === 1) return (
      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 8 }}>
            Caption & Story *
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            placeholder="Describe your piece — what inspired it, who influenced you, who taught you this, what you want viewers to notice..."
            style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "10px 12px", color: "#fff", fontSize: 13, resize: "none", outline: "none", boxSizing: "border-box", lineHeight: 1.6 }}
          />
          <div style={{ fontSize: 10, color: content.length > 20 ? "#A855F7" : "rgba(255,255,255,0.25)", marginTop: 4 }}>
            {content.length} characters
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 8 }}>
            Dance Styles
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {DANCE_STYLES.map((s) => (
              <button key={s} onClick={() => toggleStyle(s)} style={{ padding: "5px 12px", borderRadius: 20, background: selectedStyles.includes(s) ? "#7C3AED" : "rgba(255,255,255,0.06)", border: selectedStyles.includes(s) ? "none" : "1px solid rgba(255,255,255,0.08)", color: selectedStyles.includes(s) ? "#fff" : "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 12, color: "#EF4444" }}>{error}</div>
          </div>
        )}
      </div>
    );

    // Step 2: Preview & publish
    if (step === 2) return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: "0 24px" }}>
        {/* Preview card */}
        <div style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, overflow: "hidden" }}>
          {mediaUrl.trim() && (
            <div style={{ aspectRatio: "1.5", background: "#111", overflow: "hidden" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrl.trim()} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            </div>
          )}
          <div style={{ padding: "14px 16px" }}>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.6, marginBottom: 8 }}>{content || "(No caption)"}</p>
            {selectedStyles.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {selectedStyles.map((s) => (
                  <span key={s} style={{ fontSize: 10, color: "#A855F7", background: "rgba(168,85,247,0.1)", borderRadius: 20, padding: "2px 8px" }}>#{s.toLowerCase()}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div style={{ width: "100%", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 12, color: "#EF4444" }}>{error}</div>
          </div>
        )}

        <button
          onClick={handlePublish}
          disabled={publishing || !content.trim()}
          style={{ width: "100%", padding: "16px 0", borderRadius: 14, background: content.trim() ? "linear-gradient(135deg, #7C3AED, #EC4899)" : "rgba(255,255,255,0.08)", border: "none", color: content.trim() ? "#fff" : "rgba(255,255,255,0.3)", fontSize: 15, fontWeight: 800, cursor: content.trim() ? "pointer" : "default", boxShadow: content.trim() ? "0 8px 30px rgba(124,58,237,0.4)" : "none", opacity: publishing ? 0.7 : 1 }}>
          {publishing ? "Posting..." : "Post to EGATS Culture"}
        </button>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", textAlign: "center", lineHeight: 1.5 }}>
          By posting, you confirm you have rights to all content and have credited all collaborators.
        </p>
      </div>
    );
  };

  return (
    <div style={{ ...style, background: "#050507", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "52px 14px 12px", display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={() => step > 0 ? setStep((s) => s - 1) : dispatch({ type: "SET_TAB", tab: "feed" })} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2"><path d="M19 12H5m7-7-7 7 7 7"/></svg>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>New Post</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Step {step + 1} of {STEPS.length}: {STEPS[step]}</div>
        </div>
      </div>

      {/* Challenge banner — shown when posting to a challenge */}
      {challenge && (
        <div style={{ margin: "0 14px 4px", background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.3)", borderRadius: 10, padding: "9px 12px", display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A855F7" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#A855F7", textTransform: "uppercase", letterSpacing: 0.4 }}>Submitting to challenge</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{challenge.title}</div>
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div style={{ height: 3, background: "rgba(255,255,255,0.07)", margin: "0 14px" }}>
        <div style={{ height: "100%", background: "linear-gradient(135deg, #7C3AED, #EC4899)", borderRadius: 2, width: `${((step + 1) / STEPS.length) * 100}%`, transition: "width 0.3s ease" }} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", paddingTop: 24 }}>
        {stepContent()}
      </div>

      {/* Navigation — only show next button on steps 0 and 1 */}
      {step < 2 && (
        <div style={{ padding: "12px 16px 24px" }}>
          <button
            onClick={() => setStep((s) => s + 1)}
            disabled={uploading}
            style={{ width: "100%", padding: "12px 0", borderRadius: 12, background: uploading ? "rgba(255,255,255,0.08)" : "#7C3AED", border: "none", color: uploading ? "rgba(255,255,255,0.3)" : "#fff", fontSize: 14, fontWeight: 700, cursor: uploading ? "default" : "pointer", opacity: uploading ? 0.6 : 1 }}>
            {uploading ? "Uploading..." : step === 1 ? "Preview" : "Next"}
          </button>
        </div>
      )}
    </div>
  );
}
