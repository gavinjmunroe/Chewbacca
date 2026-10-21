"use client";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Save, Check, AlertCircle, Eye, Pencil } from "lucide-react";
import { CONTEXT_FILES } from "@/lib/github";
import ReactMarkdown from "react-markdown";

interface FileState {
  content: string;
  sha: string;
}

export default function ContextPage() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [files, setFiles] = useState<Record<string, FileState>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  const activePath = CONTEXT_FILES[activeIdx].path;

  useEffect(() => {
    if (files[activePath]) return;
    setLoading(true);
    setError(null);
    fetch(`/api/context?path=${encodeURIComponent(activePath)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.content !== undefined) {
          setFiles((prev) => ({
            ...prev,
            [activePath]: { content: d.content, sha: d.sha },
          }));
          setDrafts((prev) => ({ ...prev, [activePath]: d.content }));
        } else {
          setError("Failed to load file.");
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Network error.");
        setLoading(false);
      });
  }, [activePath, files]);

  async function save() {
    const draft = drafts[activePath];
    const orig = files[activePath];
    if (!orig || draft === orig.content) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: activePath,
          content: draft,
          sha: orig.sha,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setFiles((prev) => ({
        ...prev,
        [activePath]: { content: draft, sha: orig.sha },
      }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const draft = drafts[activePath] ?? "";
  const orig = files[activePath];
  const isDirty = orig && draft !== orig.content;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-5 py-4 border-b border-zinc-800/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-zinc-500" />
          <h1 className="text-sm font-semibold text-zinc-100">Context</h1>
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <span className="flex items-center gap-1 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5" />
              {error}
            </span>
          )}
          <AnimatePresence>
            {saved && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1 text-xs text-emerald-400"
              >
                <Check className="w-3.5 h-3.5" />
                Saved
              </motion.span>
            )}
          </AnimatePresence>
          <button
            onClick={() => setEditMode(!editMode)}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all duration-150 cursor-pointer ${
              editMode
                ? "bg-zinc-800 text-zinc-300 border border-zinc-700"
                : "bg-zinc-800/50 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {editMode ? (
              <>
                <Eye className="w-3.5 h-3.5" />
                Preview
              </>
            ) : (
              <>
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </>
            )}
          </button>
          {editMode && (
            <button
              onClick={save}
              disabled={!isDirty || saving}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-all duration-150 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? "Saving..." : "Save"}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Tab list */}
        <div className="w-44 shrink-0 border-r border-zinc-800/50 py-3 overflow-y-auto">
          {CONTEXT_FILES.map((f, i) => (
            <button
              key={f.path}
              onClick={() => setActiveIdx(i)}
              className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-all duration-150 cursor-pointer ${
                i === activeIdx
                  ? "text-indigo-300 bg-indigo-500/10 border-r-2 border-indigo-500"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40"
              }`}
            >
              {f.label}
              {drafts[f.path] &&
                files[f.path] &&
                drafts[f.path] !== files[f.path].content && (
                  <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
                )}
            </button>
          ))}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-5 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-4 rounded-lg bg-zinc-900"
                  style={{ width: `${70 + (i % 3) * 15}%` }}
                />
              ))}
            </div>
          ) : editMode ? (
            <textarea
              value={draft}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [activePath]: e.target.value }))
              }
              spellCheck={false}
              className="w-full h-full resize-none bg-transparent px-5 py-5 text-xs text-zinc-300 font-mono leading-relaxed focus:outline-none placeholder-zinc-700"
              placeholder="Empty file."
            />
          ) : draft ? (
            <div className="px-6 py-5 prose prose-invert prose-sm max-w-none prose-headings:text-zinc-100 prose-p:text-zinc-400 prose-li:text-zinc-400 prose-a:text-indigo-400 prose-strong:text-zinc-200 prose-code:text-indigo-300 prose-code:bg-zinc-800/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-hr:border-zinc-800 prose-th:text-zinc-300 prose-td:text-zinc-400 prose-table:text-xs">
              <ReactMarkdown>{draft}</ReactMarkdown>
            </div>
          ) : (
            <p className="px-5 py-5 text-xs text-zinc-600 italic">
              Empty file.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
