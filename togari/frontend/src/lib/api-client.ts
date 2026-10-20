import type {
  Engagement,
  Thesis,
  ThesisDetailResponse,
  Company,
  CompanyContact,
  CompanyDetailResponse,
  Task,
  DialerSession,
  CallLog,
  User,
  EnrichmentRun,
} from "@/types/sourcing";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4001";

class HttpError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function http<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...((init?.headers as Record<string, string>) || {}),
  };
  const body = init?.json ? JSON.stringify(init.json) : init?.body;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    body,
    cache: "no-store",
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) throw new HttpError(res.status, parsed);
  return parsed as T;
}

export const apiClient = {
  // Stats / dashboard
  dashboardStats: () =>
    http<{
      engagements: number;
      active_theses: number;
      companies_in_pipeline: number;
      tasks_today: number;
      meetings_booked_week: number;
      calls_made_today: number;
    }>("/api/v1/sourcing/stats"),

  // Engagements
  listEngagements: () => http<Engagement[]>("/api/v1/sourcing/engagements"),
  getEngagement: (id: string) =>
    http<Engagement>(`/api/v1/sourcing/engagements/${id}`),
  listTheses: (engagementId: string) =>
    http<Thesis[]>(`/api/v1/sourcing/engagements/${engagementId}/theses`),

  // Theses
  getThesis: (id: string) =>
    http<ThesisDetailResponse>(`/api/v1/sourcing/theses/${id}`),
  enrichThesis: (id: string) =>
    http<EnrichmentRun>(`/api/v1/sourcing/theses/${id}/enrich`, {
      method: "POST",
    }),

  // Companies
  getCompany: (id: string) =>
    http<CompanyDetailResponse>(`/api/v1/sourcing/companies/${id}`),
  promoteContact: (companyId: string, contactId: string) =>
    http<{ contacts: CompanyContact[] }>(
      `/api/v1/sourcing/companies/${companyId}/contacts/${contactId}/promote`,
      { method: "POST" },
    ),
  setMilestone: (companyId: string, milestone: string) =>
    http<{ ok: true }>(`/api/v1/sourcing/companies/${companyId}/milestone`, {
      method: "PATCH",
      json: { milestone },
    }),

  // Tasks
  todayTasks: () =>
    http<
      Array<{ task: Task; company: Company; contact: CompanyContact | null }>
    >("/api/v1/sourcing/tasks/today"),
  updateTask: (id: string, patch: Partial<Task>) =>
    http<Task>(`/api/v1/sourcing/tasks/${id}`, {
      method: "PATCH",
      json: patch,
    }),

  // Dialer
  startSession: (input: {
    user_id: string;
    thesis_id: string;
    task_filter: Record<string, unknown>;
  }) =>
    http<DialerSession>("/api/v1/dialer/sessions", {
      method: "POST",
      json: input,
    }),
  getSession: (id: string) =>
    http<{
      session: DialerSession;
      queue: Array<{ task: Task; company: Company; contact: CompanyContact }>;
      recent: CallLog[];
    }>(`/api/v1/dialer/sessions/${id}`),

  // Admin
  listUsers: () => http<User[]>("/api/v1/sourcing/users"),
  integrationHealth: () =>
    http<
      Array<{
        name: string;
        status: "healthy" | "degraded" | "down";
        latency_ms: number;
      }>
    >("/api/v1/sourcing/integrations/health"),
};

export type ApiClient = typeof apiClient;
