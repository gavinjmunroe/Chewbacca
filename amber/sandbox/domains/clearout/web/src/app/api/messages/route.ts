import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// GET /api/messages?thread_id=xxx
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const threadId = searchParams.get("thread_id")

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!threadId) {
    return NextResponse.json({ error: "thread_id required" }, { status: 400 })
  }

  const { data: messages, error } = await (supabase as any)
    .from("messages")
    .select("*")
    .eq("thread_id", threadId)
    .eq("user_id", user.id)
    .order("received_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ messages })
}
