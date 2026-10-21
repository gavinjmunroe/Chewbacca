import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const APP_VERSION = "0.1.0";

export async function GET(): Promise<NextResponse> {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  let dbStatus = "ok";
  let dbLatencyMs = 0;
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true });
    dbLatencyMs = Date.now() - start;
    if (error) throw error;
  } catch (err: unknown) {
    dbStatus = "error";
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        status: "error",
        version: APP_VERSION,
        timestamp,
        db: { status: dbStatus, latencyMs: dbLatencyMs },
        error: message,
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    status: "ok",
    version: APP_VERSION,
    timestamp,
    db: { status: dbStatus, latencyMs: dbLatencyMs },
  });
}
