import { NextRequest, NextResponse } from "next/server";
import { PlaidApi, PlaidEnvironments, Configuration } from "plaid";
import { requireAuth } from "@/lib/auth";
import { decryptToken } from "@/lib/crypto";
import { getSupabaseAdmin } from "@/lib/supabase";

const plaid = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments[(process.env.PLAID_ENV ?? "sandbox") as keyof typeof PlaidEnvironments],
  baseOptions: { headers: { "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!, "PLAID-SECRET": process.env.PLAID_SECRET! } },
}));

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabaseAdmin();
  const { data: items } = await db.from("plaid_items").select("*");
  if (!items?.length) return NextResponse.json({ balances: [] });

  const results: { institution: string; accounts: { name: string; type: string; balance: number | null }[] }[] = [];
  const errors: string[] = [];
  for (const item of items) {
    try {
      const token = decryptToken(item.access_token_encrypted as string);
      const res = await plaid.accountsBalanceGet({ access_token: token });

      for (const acct of res.data.accounts) {
        await db.from("balance_snapshots").insert({
          account_id: acct.account_id,
          timestamp: new Date().toISOString(),
          balance: acct.balances.current,
          currency: acct.balances.iso_currency_code ?? "USD",
        });
      }

      results.push({ institution: item.institution, accounts: res.data.accounts.map((a) => ({ name: a.name, type: a.type, balance: a.balances.current })) });
    } catch (err) {
      errors.push(`${item.institution}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  return NextResponse.json({ balances: results, errors });
}
