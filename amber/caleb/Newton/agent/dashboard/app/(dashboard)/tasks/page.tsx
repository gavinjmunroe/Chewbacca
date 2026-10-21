"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckSquare,
  AlertCircle,
  Inbox,
  Plus,
  Check,
  Circle,
  Clock,
  RefreshCw,
  Loader2,
} from "lucide-react";

interface Task {
  id: string;
  content: string;
  description: string;
  due: { date: string; datetime?: string; string: string } | null;
  priority: number;
  labels: string[];
  url: string;
}

interface TasksData {
  overdue: Task[];
  today: Task[];
  upcoming: Task[];
  total: number;
}

const PRIORITY_STYLES: Record<
  number,
  { bg: string; text: string; label: string }
> = {
  4: {
    bg: "bg-red-500/10 border-red-500/20",
    text: "text-red-400",
    label: "P1",
  },
  3: {
    bg: "bg-orange-500/10 border-orange-500/20",
    text: "text-orange-400",
    label: "P2",
  },
  2: {
    bg: "bg-blue-500/10 border-blue-500/20",
    text: "text-blue-400",
    label: "P3",
  },
  1: { bg: "bg-zinc-800 border-zinc-700", text: "text-zinc-500", label: "P4" },
};

function formatDue(due: Task["due"]): string {
  if (!due) return "";
  if (due.datetime) {
    return new Date(due.datetime).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return new Date(due.date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function TasksPage() {
  const [data, setData] = useState<TasksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTask, setNewTask] = useState("");
  const [creating, setCreating] = useState(false);
  const [completing, setCompleting] = useState<Set<string>>(new Set());

  async function fetchTasks() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) throw new Error("Failed to load tasks");
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTasks();
  }, []);

  async function handleComplete(taskId: string) {
    setCompleting((prev) => new Set(prev).add(taskId));
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", taskId }),
      });
      // Remove from local state
      setData((prev) => {
        if (!prev) return prev;
        const remove = (arr: Task[]) => arr.filter((t) => t.id !== taskId);
        return {
          ...prev,
          overdue: remove(prev.overdue),
          today: remove(prev.today),
          upcoming: remove(prev.upcoming),
          total: prev.total - 1,
        };
      });
    } catch {
      // Silently fail, user can retry
    } finally {
      setCompleting((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTask.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          content: newTask.trim(),
          dueString: "today",
        }),
      });
      if (res.ok) {
        setNewTask("");
        fetchTasks();
      }
    } catch {
      // Silently fail
    } finally {
      setCreating(false);
    }
  }

  function renderTaskList(
    tasks: Task[],
    sectionLabel: string,
    sectionColor: string,
  ) {
    if (tasks.length === 0) return null;
    return (
      <div className="space-y-2">
        <h2
          className="text-xs font-semibold uppercase tracking-widest"
          style={{ color: sectionColor }}
        >
          {sectionLabel} ({tasks.length})
        </h2>
        <div className="space-y-1.5">
          {tasks.map((task, i) => {
            const priority =
              PRIORITY_STYLES[task.priority] || PRIORITY_STYLES[1];
            const isCompleting = completing.has(task.id);
            return (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: isCompleting ? 0.4 : 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex items-center gap-3 hover:border-zinc-700 transition-all duration-200 group"
              >
                {/* Complete button */}
                <button
                  onClick={() => handleComplete(task.id)}
                  disabled={isCompleting}
                  className="shrink-0 cursor-pointer"
                  aria-label={`Complete task: ${task.content}`}
                >
                  {isCompleting ? (
                    <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                  ) : (
                    <Circle className="w-4 h-4 text-zinc-600 group-hover:text-indigo-400 transition-colors" />
                  )}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 truncate">
                    {task.content}
                  </p>
                  {task.due && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3 text-zinc-600" />
                      <span className="text-[10px] text-zinc-600">
                        {formatDue(task.due)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Labels */}
                {task.labels.length > 0 && (
                  <div className="hidden sm:flex gap-1">
                    {task.labels.slice(0, 2).map((label) => (
                      <span
                        key={label}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                )}

                {/* Priority badge */}
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${priority.bg} ${priority.text}`}
                >
                  {priority.label}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-xl">
            <CheckSquare className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-50 tracking-tight">
              Tasks
            </h1>
            <p className="text-xs text-zinc-500">
              {data ? `${data.total} active tasks` : "Loading..."}
            </p>
          </div>
        </div>
        <button
          onClick={fetchTasks}
          disabled={loading}
          className="p-2 rounded-lg hover:bg-zinc-800/60 text-zinc-500 hover:text-zinc-300 transition-all duration-200 cursor-pointer disabled:opacity-50"
          aria-label="Refresh tasks"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Add Task */}
      <motion.form
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={handleCreate}
        className="flex gap-2"
      >
        <input
          type="text"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          placeholder="Add a task for today..."
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
        />
        <button
          type="submit"
          disabled={creating || !newTask.trim()}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold px-4 py-2.5 rounded-xl transition-all duration-200 cursor-pointer flex items-center gap-1.5"
        >
          {creating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          <span className="hidden sm:inline text-sm">Add</span>
        </button>
      </motion.form>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
          <button
            onClick={fetchTasks}
            className="ml-auto text-xs text-red-400 hover:text-red-300 font-medium cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl bg-zinc-900" />
          ))}
        </div>
      )}

      {/* Task lists */}
      {!loading && data && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {renderTaskList(data.overdue, "Overdue", "#ef4444")}
          {renderTaskList(data.today, "Today", "#e4e4e7")}
          {renderTaskList(data.upcoming, "Upcoming", "#71717a")}

          {data.overdue.length === 0 &&
            data.today.length === 0 &&
            data.upcoming.length === 0 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-10 flex flex-col items-center justify-center text-center">
                <div className="p-4 bg-emerald-500/10 rounded-2xl mb-4">
                  <Check className="w-8 h-8 text-emerald-400" />
                </div>
                <h3 className="text-lg font-semibold text-zinc-200 mb-1">
                  All caught up
                </h3>
                <p className="text-sm text-zinc-500 max-w-sm">
                  No tasks due today or this week. Add one above or enjoy the
                  breathing room.
                </p>
              </div>
            )}
        </motion.div>
      )}
    </div>
  );
}
