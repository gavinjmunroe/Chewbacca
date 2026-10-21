"use client";
import { useState } from "react";
import { MessageSquare, Plus, CheckCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast-provider";

interface Props {
  dancerId: string;
  dancerName: string;
  variant: "header" | "sidebar" | "mobile-bar";
}

export default function DancerProfileActions({ dancerId, dancerName, variant }: Props) {
  const { showToast } = useToast();
  const router = useRouter();
  const [showShortlistModal, setShowShortlistModal] = useState(false);
  const [shortlistName, setShortlistName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function handleSaveToNewShortlist() {
    if (!shortlistName.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/shortlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: shortlistName.trim(), dancerIds: [dancerId] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save shortlist");
        return;
      }
      setSaved(true);
      showToast("success", `${dancerName} added to "${shortlistName.trim()}"`);
      setTimeout(() => {
        setShowShortlistModal(false);
        setSaved(false);
        setShortlistName("");
      }, 1200);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const handleMessage = () => {
    showToast("success", "Messaging coming soon. Redirecting to Bookings.");
    router.push("/dashboard/bookings");
  };

  if (variant === "header") {
    return (
      <>
        <button
          onClick={handleMessage}
          className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
        >
          <MessageSquare className="w-4 h-4" />
          Message
        </button>
        <button
          onClick={() => setShowShortlistModal(true)}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add to Shortlist
        </button>
        <ShortlistModal
          open={showShortlistModal}
          onClose={() => setShowShortlistModal(false)}
          shortlistName={shortlistName}
          setShortlistName={setShortlistName}
          onSave={handleSaveToNewShortlist}
          saving={saving}
          saved={saved}
          error={error}
          dancerName={dancerName}
        />
      </>
    );
  }

  if (variant === "sidebar") {
    return (
      <>
        <div className="space-y-3">
          <button
            onClick={() => setShowShortlistModal(true)}
            className="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold py-3.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add to Shortlist
          </button>
          <button
            onClick={handleMessage}
            className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold py-3.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
          >
            <MessageSquare className="w-4 h-4" />
            Send Message
          </button>
        </div>
        <ShortlistModal
          open={showShortlistModal}
          onClose={() => setShowShortlistModal(false)}
          shortlistName={shortlistName}
          setShortlistName={setShortlistName}
          onSave={handleSaveToNewShortlist}
          saving={saving}
          saved={saved}
          error={error}
          dancerName={dancerName}
        />
      </>
    );
  }

  // mobile-bar variant
  return (
    <>
      <button
        onClick={handleMessage}
        className="flex-1 flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-semibold py-3 rounded-xl transition-colors"
      >
        <MessageSquare className="w-4 h-4" />
        Message
      </button>
      <button
        onClick={() => setShowShortlistModal(true)}
        className="flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold py-3 rounded-xl transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add to Shortlist
      </button>
      <ShortlistModal
        open={showShortlistModal}
        onClose={() => setShowShortlistModal(false)}
        shortlistName={shortlistName}
        setShortlistName={setShortlistName}
        onSave={handleSaveToNewShortlist}
        saving={saving}
        saved={saved}
        error={error}
        dancerName={dancerName}
      />
    </>
  );
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  shortlistName: string;
  setShortlistName: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  error: string;
  dancerName: string;
}

function ShortlistModal({ open, onClose, shortlistName, setShortlistName, onSave, saving, saved, error, dancerName }: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">Add to Shortlist</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-white/50 text-sm">
          Adding <span className="text-white font-medium">{dancerName}</span> to a new shortlist.
        </p>
        <input
          value={shortlistName}
          onChange={(e) => setShortlistName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSave()}
          placeholder="Shortlist name (e.g. Summer Tour Candidates)"
          maxLength={100}
          autoFocus
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50"
        />
        {error && <p className="text-red-400 text-xs">{error}</p>}
        {saved && (
          <div className="flex items-center gap-2 text-green-400 text-sm">
            <CheckCircle className="w-4 h-4" /> Saved to shortlist!
          </div>
        )}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving || !shortlistName.trim()}
            className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
          >
            {saving ? "Saving..." : "Save Shortlist"}
          </button>
        </div>
      </div>
    </div>
  );
}
