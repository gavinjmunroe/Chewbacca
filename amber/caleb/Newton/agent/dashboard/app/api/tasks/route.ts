import { NextRequest, NextResponse } from "next/server";

// Use Composio's REST API directly (not the SDK, which has auth issues on Vercel)
const COMPOSIO_BASE = "https://backend.composio.dev/api/v2";

async function composioExecute(
  action: string,
  params: Record<string, unknown>,
) {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) throw new Error("COMPOSIO_API_KEY not set");

  const res = await fetch(`${COMPOSIO_BASE}/actions/${action}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      connectedAccountId: "default",
      input: params,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Composio ${action} failed: ${res.status} ${err}`);
  }
  return await res.json();
}

interface TodoistTask {
  id: string;
  content: string;
  description?: string;
  due?: { date: string; datetime?: string; string?: string } | null;
  priority: number;
  labels?: string[];
  project_id?: string;
}

function categorizeTask(task: TodoistTask) {
  if (!task.due) return "noDue";
  const todayStr = new Date().toISOString().split("T")[0];
  if (task.due.date < todayStr) return "overdue";
  if (task.due.date === todayStr) return "today";
  const weekFromNow = new Date();
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  if (task.due.date <= weekFromNow.toISOString().split("T")[0])
    return "upcoming";
  return "later";
}

export async function GET() {
  try {
    // Use Todoist MCP-compatible REST endpoint via Composio
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Not configured." }, { status: 500 });
    }

    // Fetch tasks directly from Todoist via their Sync API
    // The Composio SDK has issues on Vercel, so we use Todoist directly
    const todoistToken = process.env.TODOIST_API_KEY;

    let tasks: TodoistTask[] = [];

    if (todoistToken) {
      // Try Todoist REST API v2 first
      const res = await fetch("https://api.todoist.com/rest/v2/tasks", {
        headers: { Authorization: `Bearer ${todoistToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        tasks = await res.json();
      }
    }

    // If REST v2 failed (410 deprecated), try Sync API
    if (tasks.length === 0 && todoistToken) {
      const syncRes = await fetch("https://api.todoist.com/sync/v9/sync", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${todoistToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: 'sync_token=*&resource_types=["items"]',
        signal: AbortSignal.timeout(10_000),
      });
      if (syncRes.ok) {
        const syncData = await syncRes.json();
        tasks = (syncData.items || [])
          .filter((t: Record<string, unknown>) => !t.checked && !t.is_deleted)
          .map((t: Record<string, unknown>) => ({
            id: String(t.id),
            content: String(t.content || ""),
            description: String(t.description || ""),
            due: t.due as TodoistTask["due"],
            priority: Number(t.priority || 1),
            labels: Array.isArray(t.labels) ? t.labels.map(String) : [],
            project_id: String(t.project_id || ""),
          }));
      }
    }

    const overdue = tasks.filter((t) => categorizeTask(t) === "overdue");
    const today = tasks.filter((t) => categorizeTask(t) === "today");
    const upcoming = tasks.filter((t) => categorizeTask(t) === "upcoming");
    const noDue = tasks
      .filter((t) => categorizeTask(t) === "noDue")
      .slice(0, 10);

    return NextResponse.json({
      overdue,
      today,
      upcoming,
      noDue,
      total: tasks.length,
    });
  } catch (err) {
    console.error("[tasks]", err);
    return NextResponse.json(
      { error: "Failed to load tasks." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { action, taskId, content, dueString } = await req.json();
    const todoistToken = process.env.TODOIST_API_KEY;
    if (!todoistToken) {
      return NextResponse.json({ error: "Not configured." }, { status: 500 });
    }

    if (action === "close" && taskId) {
      await fetch(`https://api.todoist.com/rest/v2/tasks/${taskId}/close`, {
        method: "POST",
        headers: { Authorization: `Bearer ${todoistToken}` },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "create" && content) {
      const res = await fetch("https://api.todoist.com/rest/v2/tasks", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${todoistToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content,
          ...(dueString ? { due_string: dueString } : {}),
        }),
      });
      const task = await res.json();
      return NextResponse.json({ ok: true, task });
    }

    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch (err) {
    console.error("[tasks POST]", err);
    return NextResponse.json({ error: "Failed." }, { status: 500 });
  }
}
