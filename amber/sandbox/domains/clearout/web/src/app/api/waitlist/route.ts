import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { z } from "zod"

const WaitlistSchema = z.object({
  email: z.string().email(),
  name: z.string().max(100).optional(),
  use_case: z.enum(["founder", "exec", "student", "team", "other"]).optional(),
  referral_source: z.string().max(100).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = WaitlistSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 })
  }

  const { email, name, use_case, referral_source } = parsed.data

  const { error } = await (supabase as any)
    .from("waitlist")
    .insert({ email, name, use_case, referral_source })

  if (error) {
    if (error.code === "23505") {
      // Already on waitlist
      return NextResponse.json({ success: true, already_joined: true })
    }
    return NextResponse.json({ error: "Failed to join waitlist" }, { status: 500 })
  }

  return NextResponse.json({ success: true, already_joined: false })
}
