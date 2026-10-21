import { NextRequest, NextResponse } from "next/server";
import { PlaidApi, PlaidEnvironments, Configuration } from "plaid";
import { requireAuth } from "@/lib/auth";
import { encryptToken } from "@/lib/crypto";
import { getSupabaseAdmin } from "@/lib/supabase";

const plaid = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments[(process.env.PLAID_ENV ?? "sandbox") as keyof typeof PlaidEnvironments],
  baseOptions: { headers: { "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!, "PLAID-SECRET": process.env.PLAID_SECRET! } },
}));

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let public_token: string, institution_name: string;
  try {
    ({ public_token, institution_name } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!public_token || typeof public_token !== "string") {
    return NextResponse.json({ error: "public_token required" }, { status: 400 });
  }

  let exchangeData: { item_id: string; access_token: string };
  try {
    const { data } = await plaid.itemPublicTokenExchange({ public_token });
    exchangeData = data;
  } catch {
    return NextResponse.json({ error: "Token exchange failed" }, { status: 502 });
  }

  const { error } = await getSupabaseAdmin().from("plaid_items").upsert({
    item_id: exchangeData.item_id,
    access_token_encrypted: encryptToken(exchangeData.access_token),
    institution: institution_name ?? null,
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[plaid/exchange] Supabase write failed:", error.message);
    return NextResponse.json({ error: "Failed to persist token" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
