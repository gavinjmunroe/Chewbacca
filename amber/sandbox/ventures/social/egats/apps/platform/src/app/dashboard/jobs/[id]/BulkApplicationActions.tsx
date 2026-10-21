"use client";
import { useState } from "react";
import { Trash2, CheckSquare, Square } from "lucide-react";
import { useToast } from "@/components/toast-provider";
import type { Application } from "@/types/database";

interface Props {
  applications: Application[];
  onStatusUpdated: (updatedIds: string[], status: string) => void;
}

export default function BulkApplicationActions({ applications, onStatusUpdated }: Props) {
  const { showToast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  const pendingApps = applications.filter((a) => a.status === "pending");
  const allSelected = pendingApps.length > 0 && pendingApps.every((a) => selectedIds.has(a.id));
  const someSelected = selectedIds.size > 0;

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingApps.map((a) => a.id)));
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkReject() {
    if (selectedIds.size === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/applications/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationIds: Array.from(selectedIds),
          status: "rejected",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast("error", data.error || "Failed to reject applications");
        return;
      }
      onStatusUpdated(Array.from(selectedIds), "rejected");
      showToast("success", `Rejected ${data.updated} application${data.updated !== 1 ? "s" : ""}`);
      setSelectedIds(new Set());
      setConfirming(false);
    } catch {
      showToast("error", "Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (pendingApps.length === 0) return null;

  return (
    <div className="mb-4 bg-white/[0.03] border border-white/10 rounded-xl p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleAll}
            className="flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
          >
            {allSelected ? (
              <CheckSquare className="w-4 h-4 text-violet-400" />
            ) : (
              <Square className="w-4 h-4" />
            )}
            {allSelected ? "Deselect All" : "Select All Pending"}
          </button>
          {someSelected && (
            <span className="text-xs text-white/40">{selectedIds.size} selected</span>
          )}
        </div>

        {someSelected && !confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex items-center gap-2 text-xs bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-400 font-semibold px-4 py-2 rounded-lg transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Reject Selected ({selectedIds.size})
          </button>
        )}

        {confirming && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/50">Reject {selectedIds.size} application{selectedIds.size !== 1 ? "s" : ""}?</span>
            <button
              type="button"
              onClick={handleBulkReject}
              disabled={loading}
              className="text-xs bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold px-4 py-1.5 rounded-lg transition-colors"
            >
              {loading ? "Rejecting..." : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-xs text-white/40 hover:text-white/70 px-3 py-1.5 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Checkboxes per application (shown when any selected or select-all toggled) */}
      {someSelected && (
        <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
          {pendingApps.map((app) => {
            const dancer = app.dancer as unknown as { profile?: { display_name?: string } } | null;
            const name = dancer?.profile?.display_name ?? "Dancer";
            const checked = selectedIds.has(app.id);
            return (
              <button
                key={app.id}
                type="button"
                onClick={() => toggleOne(app.id)}
                className={`w-full flex items-center gap-2.5 text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  checked ? "bg-red-500/10 border border-red-500/20 text-white" : "bg-white/[0.02] border border-transparent text-white/50 hover:text-white/70"
                }`}
              >
                {checked ? (
                  <CheckSquare className="w-4 h-4 text-red-400 shrink-0" />
                ) : (
                  <Square className="w-4 h-4 shrink-0" />
                )}
                {name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
