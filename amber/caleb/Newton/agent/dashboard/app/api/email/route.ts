import { NextRequest, NextResponse } from "next/server";
import { ComposioToolSet } from "composio-core";

export async function GET(req: NextRequest) {
  try {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Composio not configured." },
        { status: 500 },
      );
    }

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "10");
    const pageToken = searchParams.get("pageToken") || undefined;
    const filter = searchParams.get("filter") || ""; // "unread", "starred", or ""

    const toolset = new ComposioToolSet({ apiKey });
    const entity = await toolset.getEntity("default");

    const labelIds = ["INBOX"];
    if (filter === "unread") labelIds.push("UNREAD");
    if (filter === "starred") labelIds.push("STARRED");

    const params: Record<string, unknown> = {
      max_results: Math.min(limit, 50),
      label_ids: labelIds,
      verbose: false,
      include_payload: false,
    };
    if (pageToken) params.page_token = pageToken;

    const result = await toolset.executeAction({
      action: "GMAIL_FETCH_EMAILS",
      params,
      entityId: entity.id,
    });

    const data = result?.data as Record<string, unknown> | undefined;
    const rawMessages = (data?.messages || []) as Array<
      Record<string, unknown>
    >;
    const nextPageToken = (data?.nextPageToken as string) || null;
    const totalEstimate = (data?.resultSizeEstimate as number) || 0;

    const emails = rawMessages.map((msg) => {
      const preview = msg.preview as Record<string, string> | undefined;
      const labelIds = (msg.labelIds || []) as string[];

      return {
        id: (msg.messageId as string) || "",
        threadId: (msg.threadId as string) || "",
        from: (msg.sender as string) || "Unknown",
        to: (msg.to as string) || "",
        subject:
          (preview?.subject as string) ||
          (msg.subject as string) ||
          "No subject",
        snippet: (preview?.body as string) || (msg.snippet as string) || "",
        date: (msg.messageTimestamp as string) || "",
        isUnread: labelIds.includes("UNREAD"),
        url: (msg.display_url as string) || "",
      };
    });

    return NextResponse.json({
      emails,
      nextPageToken,
      totalEstimate,
    });
  } catch (err) {
    console.error("[GET /api/email]", err);
    return NextResponse.json(
      { error: "Failed to fetch emails." },
      { status: 500 },
    );
  }
}
