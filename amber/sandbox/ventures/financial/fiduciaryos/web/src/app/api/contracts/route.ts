import Anthropic from "@anthropic-ai/sdk";

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();
    if (typeof body !== "object" || body === null) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const { text, docType } = body as { text?: unknown; docType?: unknown };

    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "Missing document text" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      system: `You are a consumer rights lawyer and privacy expert. Analyze legal documents and identify what users actually need to know. Be direct, specific, and on the user's side. Return ONLY valid JSON with no markdown code blocks, no extra text, just raw JSON:
{
  "documentType": "Terms of Service|Privacy Policy|EULA|Subscription Agreement",
  "company": "Company name if identifiable, otherwise Unknown",
  "overallVerdict": "Safe|Caution|Red Flags|Concerning",
  "verdictReason": "One sentence summary of the verdict",
  "readingLevel": "Grade level of the document (e.g. Grade 12)",
  "keyFindings": [
    {
      "category": "Data Collection|Your Rights|Cancellation|Liability|Arbitration|Content Ownership|Sharing with Third Parties|Auto-renewal|Children",
      "finding": "What the document says",
      "severity": "Info|Caution|Warning|Red Flag",
      "plainEnglish": "What this actually means for you",
      "quote": "Relevant excerpt from the document (keep under 200 chars)"
    }
  ],
  "dataCollected": ["Type of data collected 1", "Type 2"],
  "dataSharedWith": ["Who data is shared with"],
  "yourRights": ["Right 1: what you can do", "Right 2"],
  "howToCancel": "How to actually cancel or delete your account. Be specific.",
  "autoRenewal": true,
  "arbitrationClause": true,
  "contentOwnership": "Who owns content you create",
  "redFlags": ["Specific concerning clause 1", "Red flag 2"],
  "tldr": "3-sentence plain-English summary of the whole document"
}`,
      messages: [
        {
          role: "user",
          content: `Document type: ${typeof docType === "string" ? docType : "unknown"}\n\nDocument text:\n${text.slice(0, 40000)}`,
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
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    console.error("[POST /api/contracts]", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
