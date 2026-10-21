import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

// Hit hourly by the Vercel cron (see vercel.json) so the statically-rendered
// page refreshes from Slack even when no one is visiting.
export async function GET() {
  revalidatePath("/");
  return NextResponse.json({ revalidated: true, at: Date.now() });
}
