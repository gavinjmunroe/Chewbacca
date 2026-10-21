import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "@/lib/auth";
import { calcMonthlyAllocation } from "@/lib/finance-engine";
import { FinancialProfile } from "@/lib/types";
import { RiskLevel, RISK_LEVEL_LABELS, TaxHarvestCandidate } from "@/lib/unified-types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

interface AgentRequest {
  question: string;
  profile: FinancialProfile;
  riskLevel?: RiskLevel;
  riskAlerts?: string[];
  harvestCandidates?: TaxHarvestCandidate[];
  portfolioTotalUsd?: number;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { question, profile, riskLevel, riskAlerts, harvestCandidates, portfolioTotalUsd } =
    await req.json() as AgentRequest;
  if (!question || !profile) return NextResponse.json({ error: "question and profile required" }, { status: 400 });

  const a = calcMonthlyAllocation(profile);

  const riskSection = riskLevel !== undefined
    ? `\nPORTFOLIO STATUS:
• Risk level: ${RISK_LEVEL_LABELS[riskLevel]}
• Active alerts: ${riskAlerts?.length ? riskAlerts.join("; ") : "None"}
• Total portfolio value: $${portfolioTotalUsd?.toLocaleString() ?? "Unknown"}`
    : "";

  const harvestSection = harvestCandidates?.length
    ? `\nTAX HARVEST OPPORTUNITIES:
${harvestCandidates.map(c => `• ${c.ticker}: $${Math.abs(c.unrealized_loss_usd).toLocaleString()} unrealized loss → $${c.tax_savings_estimate_usd.toLocaleString()} tax savings (wash-sale safe: ${c.wash_sale_safe ? "yes" : "no"})`).join("\n")}`
    : "";

  const system = `You are FiduciaryOS, a fiduciary-grade personal wealth manager and advisor. You explain allocation plans and investment strategy clearly and concisely. You NEVER invent numbers — all figures come from the engine data below.

MONTHLY CASHFLOW:
• Gross: $${a.gross.toFixed(0)}/mo | Net take-home: $${a.netTakeHome.toFixed(0)}/mo
• Pre-tax 401(k): $${a.pretax401k.toFixed(0)} (employer adds $${a.employerMatch.toFixed(0)})
• Mega Backdoor Roth: $${a.megaBackdoor.toFixed(0)}
• Roth IRA: $${a.rothIRA.toFixed(0)}
• Brokerage: $${a.brokerage.toFixed(0)} | HYSA: $${a.hysa.toFixed(0)}
• Federal tax: $${a.federalTax.toFixed(0)} | CA tax: $${a.caTax.toFixed(0)}
• SS: $${a.ssTax.toFixed(0)} | Medicare: $${a.medicareTax.toFixed(0)} | CA SDI: $${a.caSDI.toFixed(0)}
• Health: $${a.healthPremium.toFixed(0)} | HSA: $${a.hsaMonthly.toFixed(0)}
• Expenses: $${a.expenses.toFixed(0)} | Investable: $${a.investableCash.toFixed(0)}
${riskSection}
${harvestSection}

Respond as a fiduciary advisor. Be brief and factual. Reference specific figures from the data above. Flag anything that requires human review. No product recommendations. Do not give specific buy/sell advice.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 768,
      system,
      messages: [{ role: "user", content: question }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const text = textBlock?.type === "text" ? textBlock.text : "";
    return NextResponse.json({ answer: text });
  } catch {
    return NextResponse.json({ error: "Agent unavailable" }, { status: 502 });
  }
}
