import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { command } = await req.json();
    if (!command || typeof command !== "string") {
      return NextResponse.json({ error: "Command required." }, { status: 400 });
    }

    const agentUrl = process.env.AMBER_AGENT_URL;
    if (!agentUrl) {
      return NextResponse.json(
        { error: "Agent not configured." },
        { status: 500 },
      );
    }

    // Send as a Caleb message to the agent with email-specific context
    const payload = {
      sender: "+15550100002",
      text: `[ClearOut] ${command}`,
      contact: "+15550100002",
      is_owner: true,
    };

    const res = await fetch(`${agentUrl}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return NextResponse.json({ result: "Agent error. Try again." });
    }

    const data = await res.json();
    return NextResponse.json({
      result: data.reply || data.message || "Done.",
      refreshInbox: true,
    });
  } catch (err) {
    console.error("[clearout/command]", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
