import { NextRequest, NextResponse } from "next/server";
import { PlaidApi, PlaidEnvironments, Configuration, CountryCode, Products } from "plaid";
import { requireAuth } from "@/lib/auth";

const plaid = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments[(process.env.PLAID_ENV ?? "sandbox") as keyof typeof PlaidEnvironments],
  baseOptions: { headers: { "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!, "PLAID-SECRET": process.env.PLAID_SECRET! } },
}));

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const res = await plaid.linkTokenCreate({
      user: { client_user_id: "fiduciaryos" },
      client_name: "FiduciaryOS",
      products: [Products.Investments],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    return NextResponse.json({ link_token: res.data.link_token });
  } catch {
    return NextResponse.json({ error: "Failed to create Plaid link token" }, { status: 502 });
  }
}
