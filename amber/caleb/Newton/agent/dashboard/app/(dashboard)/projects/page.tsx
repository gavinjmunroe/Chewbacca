"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FolderGit2,
  AlertCircle,
  Inbox,
  RefreshCw,
  Star,
  GitFork,
  ExternalLink,
  Lock,
  Globe,
  CircleDot,
} from "lucide-react";

interface Project {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  isPrivate: boolean;
  url: string;
  updatedAt: string;
  pushedAt: string;
  stars: number;
  forks: number;
  openIssues: number;
  defaultBranch: string;
}

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572a5",
  Rust: "#dea584",
  Go: "#00add8",
  Java: "#b07219",
  "C++": "#f34b7d",
  C: "#555555",
  Ruby: "#701516",
  Swift: "#f05138",
  Kotlin: "#a97bff",
  Dart: "#00b4ab",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Jupyter: "#da5b0b",
  Vue: "#41b883",
};

function formatUpdated(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 1) return "just now";
  if (diffHours < 24) return `${Math.round(diffHours)}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.round(diffDays / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  async function fetchProjects(pageNum = 1, append = false) {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const res = await fetch(`/api/projects?page=${pageNum}&perPage=30`);
      if (!res.ok) throw new Error("Failed to load projects");
      const json = await res.json();
      if (append) {
        setProjects((prev) => [...prev, ...(json.repos || [])]);
      } else {
        setProjects(json.repos || []);
      }
      setHasMore(json.hasMore || false);
      setPage(pageNum);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    fetchProjects();
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-xl">
            <FolderGit2 className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-50 tracking-tight">
              Projects
            </h1>
            <p className="text-xs text-zinc-500">
              {projects.length > 0
                ? `${projects.length} repositories`
                : "GitHub repos"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="https://github.com/calebnewtonusc?tab=repositories"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 font-medium px-3 py-2 rounded-xl transition-all duration-200 cursor-pointer text-xs"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            GitHub
          </a>
          <button
            onClick={() => fetchProjects()}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-zinc-800/60 text-zinc-500 hover:text-zinc-300 transition-all duration-200 cursor-pointer disabled:opacity-50"
            aria-label="Refresh projects"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
          <button
            onClick={() => fetchProjects()}
            className="ml-auto text-xs text-red-400 hover:text-red-300 font-medium cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && projects.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl bg-zinc-900" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && projects.length === 0 && !error && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-10 flex flex-col items-center justify-center text-center">
          <div className="p-4 bg-zinc-800/50 rounded-2xl mb-4">
            <Inbox className="w-8 h-8 text-zinc-500" />
          </div>
          <h3 className="text-lg font-semibold text-zinc-200 mb-1">
            No repos found
          </h3>
          <p className="text-sm text-zinc-500 max-w-sm">
            Either the GitHub token is not configured or there are no
            repositories to display.
          </p>
        </div>
      )}

      {/* Project Grid */}
      {projects.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {projects.map((project, i) => {
            const langColor =
              LANGUAGE_COLORS[project.language || ""] || "#6366f1";
            return (
              <motion.a
                key={project.id}
                href={project.url}
                target="_blank"
                rel="noopener noreferrer"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 hover:border-zinc-700 transition-all duration-200 cursor-pointer group block"
              >
                {/* Name + visibility */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FolderGit2 className="w-4 h-4 text-zinc-500 shrink-0 group-hover:text-indigo-400 transition-colors" />
                    <h3 className="text-sm font-semibold text-zinc-100 truncate group-hover:text-indigo-300 transition-colors">
                      {project.name}
                    </h3>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${
                      project.isPrivate
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    }`}
                  >
                    {project.isPrivate ? (
                      <Lock className="w-2.5 h-2.5" />
                    ) : (
                      <Globe className="w-2.5 h-2.5" />
                    )}
                    {project.isPrivate ? "Private" : "Public"}
                  </span>
                </div>

                {/* Description */}
                <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2 mb-3 min-h-[2rem]">
                  {project.description || "No description"}
                </p>

                {/* Footer meta */}
                <div className="flex items-center gap-3 text-[10px] text-zinc-600">
                  {project.language && (
                    <span className="flex items-center gap-1">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: langColor }}
                      />
                      {project.language}
                    </span>
                  )}
                  {project.stars > 0 && (
                    <span className="flex items-center gap-1">
                      <Star className="w-3 h-3" />
                      {project.stars}
                    </span>
                  )}
                  {project.forks > 0 && (
                    <span className="flex items-center gap-1">
                      <GitFork className="w-3 h-3" />
                      {project.forks}
                    </span>
                  )}
                  {project.openIssues > 0 && (
                    <span className="flex items-center gap-1">
                      <CircleDot className="w-3 h-3" />
                      {project.openIssues}
                    </span>
                  )}
                  <span className="ml-auto">
                    {formatUpdated(project.pushedAt || project.updatedAt)}
                  </span>
                </div>
              </motion.a>
            );
          })}
        </div>
      )}

      {hasMore && !loading && (
        <button
          onClick={() => fetchProjects(page + 1, true)}
          disabled={loadingMore}
          className="w-full py-3 text-xs font-medium text-indigo-400 hover:text-indigo-300 hover:bg-zinc-800/50 bg-zinc-900 border border-zinc-800 rounded-xl transition-all cursor-pointer disabled:opacity-50"
        >
          {loadingMore ? "Loading..." : "Load more repos"}
        </button>
      )}
    </div>
  );
}
