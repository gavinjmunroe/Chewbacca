import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { clause?: string };
    const clause = body.clause;

    if (!clause || typeof clause !== "string" || clause.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Clause text is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      system: `You are a legal clause explainer for non-lawyers. Analyze legal text and return ONLY valid JSON with no markdown formatting, no code blocks, no extra text — just the raw JSON object.`,
      messages: [
        {
          role: "user",
          content: `Analyze this legal clause and return a JSON object with exactly these fields:
- clauseType (string): one of "IP Assignment", "Non-Compete", "Indemnification", "Limitation of Liability", "Termination", "Confidentiality", "Payment Terms", "Arbitration", "Non-Disparagement", or "Other"
- plainEnglish (string): plain English translation of what this clause actually says
- meansForYou (string): practical implications for the person signing this
- redFlags (string[]): array of specific concerns, unusual terms, or one-sided provisions. Empty array if none.
- standardVsNonStandard (object): { rating: one of "standard" | "slightly unusual" | "unusual" | "highly unusual", explanation: string explaining why }
- questionsForLawyer (string[]): specific questions to ask a lawyer before signing, not generic advice
- negotiationLeverage (string): what is typically negotiable in clauses like this and how to approach it

Clause to analyze:

${clause}`,
        },
      ],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("[POST /api/docket]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
