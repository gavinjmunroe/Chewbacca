import { NextResponse } from "next/server";
import { getChannelFeed } from "@/lib/slack";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Live JSON feed the client polls every ~30s so the page feels real-time.
export async function GET() {
  try {
    const messages = await getChannelFeed();
    return NextResponse.json(
      { messages, fetchedAt: Date.now() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to load channel" },
      { status: 500 },
    );
  }
}
