"use client";
import { useEffect, useState, useRef } from "react";
import { Film, Plus, X, Star, Trash2, Play, ChevronUp, ChevronDown, ImagePlus } from "lucide-react";
import { DANCE_STYLES } from "@/types/database";
import type { PortfolioClip } from "@/types/database";
import { useToast } from "@/components/toast-provider";
import { createClient } from "@/lib/supabase/client";

type StyleTuple = typeof DANCE_STYLES;
type DanceStyle = StyleTuple[number];

const ALL_STYLES = DANCE_STYLES as unknown as DanceStyle[];

interface ClipFormData {
  title: string;
  clipUrl: string;
  thumbnailUrl: string;
  styles: DanceStyle[];
  description: string;
  isFeatured: boolean;
}

const EMPTY_FORM: ClipFormData = {
  title: "",
  clipUrl: "",
  thumbnailUrl: "",
  styles: [],
  description: "",
  isFeatured: false,
};

export default function PortfolioPage() {
  const { showToast } = useToast();
  const [clips, setClips] = useState<PortfolioClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ClipFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [patchingId, setPatchingId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);

  async function fetchClips() {
    setLoading(true);
    const res = await fetch("/api/portfolio");
    if (res.ok) {
      const data = await res.json();
      setClips(data);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchClips();
  }, []);

  function toggleStyle(style: DanceStyle) {
    setForm((f) => ({
      ...f,
      styles: f.styles.includes(style)
        ? f.styles.filter((s) => s !== style)
        : [...f.styles, style],
    }));
  }

  function handleThumbnailFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setThumbnailFile(file);
    const objectUrl = URL.createObjectURL(file);
    setThumbnailPreview(objectUrl);
    // Clear manual URL if file is chosen
    setForm((f) => ({ ...f, thumbnailUrl: "" }));
  }

  async function uploadThumbnailFile(file: File): Promise<string | null> {
    setUploadingThumbnail(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `thumbnails/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage
        .from("thumbnails")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        showToast("error", "Thumbnail upload failed: " + error.message);
        return null;
      }
      const { data: { publicUrl } } = supabase.storage.from("thumbnails").getPublicUrl(path);
      return publicUrl;
    } finally {
      setUploadingThumbnail(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    let resolvedThumbnailUrl: string | null = form.thumbnailUrl || null;

    // If a file was selected, upload it first
    if (thumbnailFile) {
      const uploadedUrl = await uploadThumbnailFile(thumbnailFile);
      if (!uploadedUrl) {
        setSaving(false);
        return;
      }
      resolvedThumbnailUrl = uploadedUrl;
    }

    const res = await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        clipUrl: form.clipUrl,
        thumbnailUrl: resolvedThumbnailUrl,
        description: form.description || null,
        styles: form.styles,
        isFeatured: form.isFeatured,
      }),
    });
    if (res.ok) {
      const newClip = await res.json();
      setClips((prev) => [newClip, ...prev]);
      setModalOpen(false);
      setForm({ ...EMPTY_FORM });
      setThumbnailFile(null);
      setThumbnailPreview(null);
      showToast("success", "Clip added to your portfolio");
    } else {
      const body = await res.json();
      setError(body.error ?? "Failed to add clip");
      showToast("error", body.error ?? "Failed to add clip");
    }
    setSaving(false);
  }

  async function handlePatch(id: string, payload: { isFeatured?: boolean; displayOrder?: number }) {
    setPatchingId(id);
    const res = await fetch(`/api/portfolio/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const updated = await res.json();
      setClips((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } else {
      showToast("error", "Failed to update clip");
    }
    setPatchingId(null);
  }

  async function handleMoveUp(clip: PortfolioClip) {
    const sorted = [...clips].sort(
      (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)
    );
    const idx = sorted.findIndex((c) => c.id === clip.id);
    if (idx <= 0) return;
    const prev = sorted[idx - 1];
    await handlePatch(clip.id, { displayOrder: prev.display_order ?? idx - 1 });
    await handlePatch(prev.id, { displayOrder: clip.display_order ?? idx });
    fetchClips();
  }

  async function handleMoveDown(clip: PortfolioClip) {
    const sorted = [...clips].sort(
      (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)
    );
    const idx = sorted.findIndex((c) => c.id === clip.id);
    if (idx >= sorted.length - 1) return;
    const next = sorted[idx + 1];
    await handlePatch(clip.id, { displayOrder: next.display_order ?? idx + 1 });
    await handlePatch(next.id, { displayOrder: clip.display_order ?? idx });
    fetchClips();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this clip? This cannot be undone.")) return;
    setDeletingId(id);
    const res = await fetch(`/api/portfolio/${id}`, { method: "DELETE" });
    if (res.ok) {
      setClips((prev) => prev.filter((c) => c.id !== id));
      showToast("success", "Clip deleted");
    } else {
      showToast("error", "Failed to delete clip");
    }
    setDeletingId(null);
  }

  return (
    <div className="min-h-screen bg-[#09090B] px-4 py-10 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Portfolio</h1>
          <p className="text-sm text-white/40 mt-0.5">{clips.length} clip{clips.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => { setModalOpen(true); setError(null); setForm({ ...EMPTY_FORM }); setThumbnailFile(null); setThumbnailPreview(null); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Clip
        </button>
      </div>

      {/* Grid / Empty */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="aspect-video bg-white/[0.04] rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : clips.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-28 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-5">
            <Film className="w-7 h-7 text-white/20" />
          </div>
          <p className="text-white/50 text-sm font-medium">No clips yet</p>
          <p className="text-white/25 text-xs mt-1">Add your first clip to start building your portfolio.</p>
          <button
            onClick={() => { setModalOpen(true); setError(null); setForm({ ...EMPTY_FORM }); setThumbnailFile(null); setThumbnailPreview(null); }}
            className="mt-6 flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Clip
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...clips]
            .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
            .map((clip, idx, arr) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              index={idx}
              total={arr.length}
              onDelete={handleDelete}
              onToggleFeatured={(id, val) => handlePatch(id, { isFeatured: val })}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              onPreview={(url) => setPreviewUrl(url)}
              deletingId={deletingId}
              patchingId={patchingId}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
        >
          <div className="bg-[#111113] border border-white/10 rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
              <h2 className="text-base font-semibold text-white">Add Clip</h2>
              <button onClick={() => { setModalOpen(false); setThumbnailFile(null); setThumbnailPreview(null); }} className="text-white/30 hover:text-white/70 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAdd} className="px-6 py-6 space-y-5">
              {/* Title */}
              <div>
                <label className="block text-[13px] font-medium text-white/60 mb-2">Title *</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. 2024 Showcase Routine"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/10 transition-all"
                />
              </div>

              {/* Clip URL */}
              <div>
                <label className="block text-[13px] font-medium text-white/60 mb-2">Clip URL *</label>
                <input
                  type="url"
                  required
                  value={form.clipUrl}
                  onChange={(e) => setForm((f) => ({ ...f, clipUrl: e.target.value }))}
                  placeholder="https://youtube.com/watch?v=..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/10 transition-all"
                />
              </div>

              {/* Thumbnail */}
              <div>
                <label className="block text-[13px] font-medium text-white/60 mb-2">
                  Thumbnail
                  <span className="ml-1.5 text-[11px] font-normal text-white/30">(optional)</span>
                </label>

                {/* Upload file option */}
                <input
                  ref={thumbnailInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleThumbnailFileChange}
                  className="hidden"
                />
                {thumbnailPreview ? (
                  <div className="relative mb-2">
                    {/* eslint_disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbnailPreview}
                      alt="Thumbnail preview"
                      className="w-full aspect-video object-cover rounded-xl border border-white/10"
                    />
                    <button
                      type="button"
                      onClick={() => { setThumbnailFile(null); setThumbnailPreview(null); if (thumbnailInputRef.current) thumbnailInputRef.current.value = ""; }}
                      className="absolute top-2 right-2 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-black/80 transition-all"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => thumbnailInputRef.current?.click()}
                    className="w-full flex items-center gap-2 justify-center py-3 border border-dashed border-white/15 rounded-xl text-[13px] text-white/40 hover:text-white/60 hover:border-white/25 transition-all mb-2"
                  >
                    <ImagePlus className="w-4 h-4" />
                    Upload thumbnail image
                  </button>
                )}

                {/* OR: paste a URL */}
                {!thumbnailFile && (
                  <>
                    <p className="text-[11px] text-white/25 text-center mb-2">or paste a URL</p>
                    <input
                      type="url"
                      value={form.thumbnailUrl}
                      onChange={(e) => setForm((f) => ({ ...f, thumbnailUrl: e.target.value }))}
                      placeholder="https://..."
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/10 transition-all"
                    />
                  </>
                )}

                {/* Tip if no thumbnail is set */}
                {!thumbnailFile && !form.thumbnailUrl && (
                  <p className="text-[11px] text-amber-400/70 mt-1.5">
                    Tip: Add a thumbnail to make your clip stand out.
                  </p>
                )}

                {uploadingThumbnail && (
                  <p className="text-[11px] text-violet-400 mt-1.5">Uploading thumbnail...</p>
                )}
              </div>

              {/* Styles */}
              <div>
                <label className="block text-[13px] font-medium text-white/60 mb-2">Styles</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_STYLES.map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => toggleStyle(style)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        form.styles.includes(style)
                          ? "bg-violet-600 border-violet-500 text-white"
                          : "bg-white/5 border-white/10 text-white/50 hover:border-white/20 hover:text-white/70"
                      }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-[13px] font-medium text-white/60 mb-2">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Describe the clip, context, your role..."
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/10 transition-all resize-none"
                />
              </div>

              {/* Featured */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={form.isFeatured}
                    onChange={(e) => setForm((f) => ({ ...f, isFeatured: e.target.checked }))}
                    className="sr-only"
                  />
                  <div className={`w-10 h-6 rounded-full border transition-all ${form.isFeatured ? "bg-violet-600 border-violet-500" : "bg-white/5 border-white/10"}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${form.isFeatured ? "left-5" : "left-1"}`} />
                  </div>
                </div>
                <span className="text-sm text-white/60">Mark as featured</span>
              </label>

              {error && (
                <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-[13px] text-red-400">
                  {error}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 px-4 py-3 border border-white/10 text-white/50 hover:text-white/70 text-sm font-medium rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  {saving ? "Adding…" : "Add Clip"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewUrl && (
        <dialog open className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 border-0 m-0 w-full h-full max-w-full max-h-full" onClick={() => setPreviewUrl(null)}>
          <div className="max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <iframe src={previewUrl} className="w-full aspect-video rounded-xl" allowFullScreen />
            <button onClick={() => setPreviewUrl(null)} className="mt-4 text-white/50 hover:text-white text-sm">
              Close
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}

function ClipCard({
  clip,
  index,
  total,
  onDelete,
  onToggleFeatured,
  onMoveUp,
  onMoveDown,
  onPreview,
  deletingId,
  patchingId,
}: {
  clip: PortfolioClip;
  index: number;
  total: number;
  onDelete: (id: string) => void;
  onToggleFeatured: (id: string, val: boolean) => void;
  onMoveUp: (clip: PortfolioClip) => void;
  onMoveDown: (clip: PortfolioClip) => void;
  onPreview: (url: string) => void;
  deletingId: string | null;
  patchingId: string | null;
}) {
  const isDeleting = deletingId === clip.id;
  const isPatching = patchingId === clip.id;

  return (
    <div className="group relative bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden hover:border-white/20 transition-all">
      {/* Thumbnail */}
      <div className="aspect-video bg-white/5 relative flex items-center justify-center">
        {clip.thumbnail_url ? (
          // eslint_disable-next-line @next/next/no-img-element
          <img
            src={clip.thumbnail_url}
            alt={clip.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <Play className="w-8 h-8 text-white/20" />
        )}
        {/* Featured badge */}
        {clip.is_featured && (
          <span className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 bg-amber-500/20 border border-amber-500/30 rounded-lg text-[10px] font-semibold text-amber-400">
            <Star className="w-2.5 h-2.5 fill-amber-400" />
            Featured
          </span>
        )}
        {/* Action buttons — visible on hover */}
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
          {/* Feature toggle */}
          <button
            onClick={() => onToggleFeatured(clip.id, !clip.is_featured)}
            disabled={isPatching}
            aria-label={clip.is_featured ? "Unfeature clip" : "Feature clip"}
            title={clip.is_featured ? "Remove featured" : "Mark as featured"}
            className={`w-7 h-7 rounded-lg bg-black/60 border flex items-center justify-center hover:bg-amber-500/20 hover:border-amber-500/30 disabled:opacity-50 transition-all ${
              clip.is_featured ? "border-amber-500/40" : "border-white/10"
            }`}
          >
            <Star className={`w-3 h-3 ${clip.is_featured ? "fill-amber-400 text-amber-400" : "text-white/60"}`} />
          </button>
          {/* Delete button */}
          <button
            onClick={() => onDelete(clip.id)}
            disabled={isDeleting}
            aria-label={`Delete clip: ${clip.title}`}
            className="w-7 h-7 rounded-lg bg-black/60 border border-white/10 flex items-center justify-center hover:bg-red-500/20 hover:border-red-500/30 disabled:opacity-50 transition-all"
          >
            <Trash2 className="w-3 h-3 text-white/60 hover:text-red-400" />
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-white truncate">{clip.title}</p>
          <button
            onClick={() => onPreview(clip.clip_url)}
            title="Preview clip"
            className="shrink-0 flex items-center gap-1 px-2 py-1 bg-white/[0.06] hover:bg-violet-500/20 border border-white/10 hover:border-violet-500/30 rounded-lg text-[11px] font-medium text-white/50 hover:text-violet-300 transition-all"
          >
            <Play className="w-3 h-3" />
            Preview
          </button>
        </div>
        {clip.styles.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {clip.styles.slice(0, 3).map((s) => (
              <span key={s} className="px-2 py-0.5 bg-white/5 border border-white/10 rounded-md text-[10px] text-white/50">
                {s}
              </span>
            ))}
            {clip.styles.length > 3 && (
              <span className="px-2 py-0.5 text-[10px] text-white/30">+{clip.styles.length - 3}</span>
            )}
          </div>
        )}
        {/* Reorder controls */}
        {total > 1 && (
          <div className="flex items-center gap-1 mt-3 pt-2 border-t border-white/[0.06]">
            <span className="text-[10px] text-white/25 mr-1">Order</span>
            <button
              onClick={() => onMoveUp(clip)}
              disabled={index === 0 || isPatching}
              aria-label="Move clip up"
              className="w-6 h-6 rounded-md flex items-center justify-center border border-white/10 hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronUp className="w-3.5 h-3.5 text-white/60" />
            </button>
            <button
              onClick={() => onMoveDown(clip)}
              disabled={index === total - 1 || isPatching}
              aria-label="Move clip down"
              className="w-6 h-6 rounded-md flex items-center justify-center border border-white/10 hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5 text-white/60" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
