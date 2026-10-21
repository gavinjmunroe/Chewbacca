import { NextRequest, NextResponse } from "next/server";
import { ComposioToolSet } from "composio-core";

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  status?: string;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function classifyDimension(summary: string): {
  dimension: string;
  color: string;
} {
  const lower = summary.toLowerCase();

  if (
    lower.includes("gym") ||
    lower.includes("workout") ||
    lower.includes("run") ||
    lower.includes("lift") ||
    lower.includes("yoga") ||
    lower.includes("exercise") ||
    lower.includes("basketball") ||
    lower.includes("soccer") ||
    lower.includes("swim")
  ) {
    return { dimension: "Physical", color: "#f97316" };
  }

  if (
    lower.includes("church") ||
    lower.includes("pray") ||
    lower.includes("bible") ||
    lower.includes("worship") ||
    lower.includes("devotion") ||
    lower.includes("small group") ||
    lower.includes("fellowship")
  ) {
    return { dimension: "Spiritual", color: "#a855f7" };
  }

  if (
    lower.includes("meeting") ||
    lower.includes("interview") ||
    lower.includes("pitch") ||
    lower.includes("call with") ||
    lower.includes("sync") ||
    lower.includes("standup") ||
    lower.includes("client") ||
    lower.includes("revenue") ||
    lower.includes("invoice")
  ) {
    return { dimension: "Financial", color: "#22c55e" };
  }

  if (
    lower.includes("class") ||
    lower.includes("lecture") ||
    lower.includes("study") ||
    lower.includes("exam") ||
    lower.includes("homework") ||
    lower.includes("lab") ||
    lower.includes("office hours") ||
    lower.includes("reading")
  ) {
    return { dimension: "Intellectual", color: "#3b82f6" };
  }

  if (
    lower.includes("dinner") ||
    lower.includes("lunch") ||
    lower.includes("hangout") ||
    lower.includes("party") ||
    lower.includes("brunch") ||
    lower.includes("coffee with") ||
    lower.includes("date") ||
    lower.includes("birthday") ||
    lower.includes("social")
  ) {
    return { dimension: "Social", color: "#ec4899" };
  }

  if (
    lower.includes("therapy") ||
    lower.includes("journal") ||
    lower.includes("rest") ||
    lower.includes("mental health") ||
    lower.includes("self care")
  ) {
    return { dimension: "Emotional", color: "#eab308" };
  }

  return { dimension: "General", color: "#6366f1" };
}

export async function GET(req: NextRequest) {
  try {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Composio not configured." },
        { status: 500 },
      );
    }

    const toolset = new ComposioToolSet({ apiKey });
    const entity = await toolset.getEntity("default");

    const { searchParams } = new URL(req.url);
    const range = searchParams.get("range") || "today"; // "today" or "week"

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    // Only fetch what's requested: "today" is fast, "week" loads more
    const todayResult = await toolset.executeAction({
      action: "GOOGLECALENDAR_EVENTS_LIST",
      params: {
        timeMin: todayStart.toISOString(),
        timeMax: todayEnd.toISOString(),
        calendarId: "primary",
        singleEvents: true,
        orderBy: "startTime",
      },
      entityId: entity.id,
    });

    let weekResult: Record<string, unknown> | null = null;
    if (range === "week") {
      const weekEnd = endOfDay(addDays(now, 6));
      weekResult = (await toolset.executeAction({
        action: "GOOGLECALENDAR_EVENTS_LIST",
        params: {
          timeMin: addDays(todayEnd, 1).toISOString(),
          timeMax: weekEnd.toISOString(),
          calendarId: "primary",
          singleEvents: true,
          orderBy: "startTime",
        },
        entityId: entity.id,
      })) as Record<string, unknown>;
    }

    function parseEvents(result: Record<string, unknown>): CalendarEvent[] {
      const data = result?.data as Record<string, unknown> | undefined;
      const items = (data?.items || data?.response_data || []) as Array<
        Record<string, unknown>
      >;

      if (!Array.isArray(items)) return [];

      return items.map((item) => {
        const startObj = item.start as Record<string, string> | undefined;
        const endObj = item.end as Record<string, string> | undefined;
        const summary = (item.summary as string) || "Untitled";
        const { dimension, color } = classifyDimension(summary);

        return {
          id: (item.id as string) || crypto.randomUUID(),
          summary,
          start: startObj?.dateTime || startObj?.date || "",
          end: endObj?.dateTime || endObj?.date || "",
          location: (item.location as string) || undefined,
          description: (item.description as string) || undefined,
          status: (item.status as string) || undefined,
          dimension,
          dimensionColor: color,
        };
      });
    }

    const todayEvents = parseEvents(todayResult as Record<string, unknown>);
    const weekEvents = weekResult
      ? parseEvents(weekResult as Record<string, unknown>)
      : [];

    return NextResponse.json({
      today: todayEvents,
      week: weekEvents,
      date: now.toISOString(),
    });
  } catch (err) {
    console.error("[GET /api/calendar]", err);
    return NextResponse.json(
      { error: "Failed to fetch calendar events." },
      { status: 500 },
    );
  }
}
