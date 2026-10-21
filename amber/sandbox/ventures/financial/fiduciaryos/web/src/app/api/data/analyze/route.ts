import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface ColumnInfo {
  name: string;
  type: string;
  nullCount: number;
  examples: string[];
}

interface DataAnalysis {
  rowCount: number;
  columnCount: number;
  columns: ColumnInfo[];
  insights: string[];
  anomalies: string[];
  summary: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { csvText: string; fileName: string };
  const { csvText, fileName } = body;

  const truncated = csvText.slice(0, 10000);

  const prompt = `You are an expert data analyst. Analyze this CSV data and return a JSON analysis. Return ONLY the JSON object, no markdown, no explanation.

File: ${fileName}
CSV Data (may be truncated):
${truncated}

Return this exact JSON structure:
{
  "rowCount": 0,
  "columnCount": 0,
  "columns": [
    { "name": "column name", "type": "string" | "number" | "date" | "boolean" | "mixed", "nullCount": 0, "examples": ["val1", "val2", "val3"] }
  ],
  "insights": ["insight 1", "insight 2", "insight 3"],
  "anomalies": ["anomaly 1", "anomaly 2"],
  "summary": "two-sentence summary of the dataset"
}

Be precise about row and column counts from the actual data. Identify real patterns and outliers.`;

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";
    const analysis = JSON.parse(text) as DataAnalysis;
    return NextResponse.json(analysis);
  } catch {
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
