import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    description: string;
    clientName: string;
    items: string;
  };
  const { description, clientName, items } = body;

  const prompt = `You are an expert invoice generator. Given the project description, generate a complete professional invoice as JSON. Return ONLY the JSON object, no markdown, no explanation.

Client: ${clientName}
Project Description: ${description}
Items (one per line, format: description qty rate): ${items}

Generate a JSON object with this exact structure:
{
  "invoiceNumber": "INV-XXXX",
  "date": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD (net 30)",
  "clientName": "${clientName}",
  "items": [
    { "description": "...", "qty": 1, "rate": 0, "amount": 0 }
  ],
  "subtotal": 0,
  "tax": 0,
  "total": 0,
  "notes": "..."
}`;

  const stream = await client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  return new Response(stream.toReadableStream(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
