import { NextResponse } from "next/server";

const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY || "";
const COMPOSIO_BASE = "https://backend.composio.dev/api/v2";

interface GmailMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  labels: string[];
  isRead: boolean;
  priority: "high" | "medium" | "low";
  suggestedAction?: string;
}

export async function GET() {
  try {
    if (!COMPOSIO_API_KEY) {
      return NextResponse.json({
        emails: [],
        error: "Composio not configured",
      });
    }

    // Use Composio to execute GMAIL_FETCH_EMAILS action
    const res = await fetch(
      `${COMPOSIO_BASE}/actions/GMAIL_FETCH_EMAILS/execute`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": COMPOSIO_API_KEY,
        },
        body: JSON.stringify({
          entityId: "default",
          input: {
            max_results: 20,
            label_ids: ["INBOX"],
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!res.ok) {
      // Fall back to empty inbox if Composio fails
      console.error("[clearout] Composio error:", await res.text());
      return NextResponse.json({ emails: [] });
    }

    const data = await res.json();
    const rawMessages =
      data?.response_data?.messages || data?.data?.messages || [];

    // Parse into structured email format
    const emails: GmailMessage[] = rawMessages
      .slice(0, 20)
      .map((msg: Record<string, unknown>, i: number) => {
        const headers = (msg.payload as Record<string, unknown>)?.headers as
          | Array<{ name: string; value: string }>
          | undefined;
        const from =
          headers?.find((h) => h.name === "From")?.value || "Unknown sender";
        const subject =
          headers?.find((h) => h.name === "Subject")?.value || "(no subject)";
        const date = headers?.find((h) => h.name === "Date")?.value || "";
        const labels = (msg.labelIds as string[]) || [];
        const snippet = (msg.snippet as string) || "";
        const isRead = !labels.includes("UNREAD");

        // Priority classification based on labels and content
        let priority: "high" | "medium" | "low" = "low";
        if (labels.includes("IMPORTANT") || labels.includes("STARRED")) {
          priority = "high";
        } else if (!isRead && i < 5) {
          priority = "medium";
        }

        // Suggest action based on content patterns
        let suggestedAction: string | undefined;
        const lowerSnippet = snippet.toLowerCase();
        if (
          lowerSnippet.includes("reply") ||
          lowerSnippet.includes("respond")
        ) {
          suggestedAction = "needs reply";
        } else if (
          lowerSnippet.includes("meeting") ||
          lowerSnippet.includes("calendar")
        ) {
          suggestedAction = "check calendar";
        } else if (
          lowerSnippet.includes("follow up") ||
          lowerSnippet.includes("following up")
        ) {
          suggestedAction = "follow up";
        }

        return {
          id: (msg.id as string) || `email-${i}`,
          from: from.replace(/<.*>/, "").trim(),
          subject,
          snippet: snippet.slice(0, 200),
          date: formatEmailDate(date),
          labels,
          isRead,
          priority,
          suggestedAction,
        };
      });

    return NextResponse.json({ emails });
  } catch (err) {
    console.error("[clearout]", err);
    return NextResponse.json({ emails: [] });
  }
}

function formatEmailDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < 1) return `${Math.round(diffMs / 60000)}m ago`;
    if (diffHours < 24) return `${Math.round(diffHours)}h ago`;
    if (diffHours < 48) return "Yesterday";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}
