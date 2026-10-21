import Anthropic from "@anthropic-ai/sdk";
import type { DancerProfile, Job } from "@/types/database";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export interface MatchResult {
  dancer_id: string;
  score: number;
  reasons: string[];
  concerns: string[];
}

export async function matchDancersToJob(
  job: Job,
  dancers: DancerProfile[]
): Promise<MatchResult[]> {
  if (!dancers.length) return [];

  const prompt = `You are EGATS's AI matching engine. Evaluate how well each dancer fits the job posting and return structured match scores.

JOB POSTING:
Title: ${job.title}
Role Type: ${job.role_type}
Styles Needed: ${job.styles_needed.join(", ")}
Location: ${job.city ? `${job.city}, ${job.state || ""} ${job.country}` : "Remote/TBD"}
Pay: ${job.pay_range_min_cents ? `$${job.pay_range_min_cents / 100}–$${job.pay_range_max_cents! / 100}` : "TBD"}
Requirements: ${job.requirements?.join(", ") || "None listed"}
Min Verification Tier: ${job.min_verification_tier}
Start Date: ${job.start_date || "TBD"}

DANCERS TO EVALUATE:
${dancers
  .map(
    (d, i) => `
Dancer ${i + 1} (ID: ${d.id}):
- Styles: ${d.styles.join(", ")}
- Experience: ${d.experience_years} years
- Verification Tier: ${d.verification_tier}
- Availability: ${d.availability_status}
- Travel Willingness: ${d.travel_willingness}
- Bookings Completed: ${d.total_bookings}
- Avg Rating: ${d.avg_rating || "No ratings yet"}
`
  )
  .join("\n")}

For each dancer, provide:
1. A match score from 0-100 (100 = perfect match)
2. Up to 3 specific reasons they are a strong fit
3. Up to 2 concerns or gaps (if any)

Return as JSON array: [{"dancer_id": "...", "score": 85, "reasons": ["..."], "concerns": ["..."]}]
Only return the JSON array, nothing else.`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "[]";
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function searchDancersByIntent(
  query: string,
  dancers: DancerProfile[]
): Promise<{ ids: string[]; explanation: string }> {
  const prompt = `You are EGATS's AI search. The recruiter searched: "${query}"

Available dancers:
${dancers
  .map(
    (d) =>
      `ID:${d.id} | Styles:${d.styles.join(",")} | Tier:${d.verification_tier} | Experience:${d.experience_years}yrs | Availability:${d.availability_status}`
  )
  .join("\n")}

Return the IDs of the most relevant dancers for this search query, ranked by relevance. Also explain what you understood from the query.

Return JSON: {"ids": ["id1", "id2", ...], "explanation": "I understood you were looking for..."}`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    message.content[0].type === "text"
      ? message.content[0].text
      : '{"ids":[],"explanation":""}';
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && Array.isArray(parsed.ids)
      ? parsed
      : { ids: [], explanation: "Search unavailable" };
  } catch {
    return { ids: [], explanation: "Search unavailable" };
  }
}

export async function generateShortlistSummary(
  jobTitle: string,
  dancers: DancerProfile[]
): Promise<string> {
  const prompt = `You are EGATS's AI. Write a brief, professional summary (2-3 sentences) of this shortlist for the job "${jobTitle}".

Shortlisted dancers:
${dancers
  .map(
    (d) =>
      `- ${d.profile?.display_name || "Dancer"}: ${d.styles.join(", ")}, Tier ${d.verification_tier}, ${d.experience_years} years experience`
  )
  .join("\n")}

The summary should highlight the quality of the pool and key strengths. Be direct and professional.`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  return message.content[0].type === "text" ? message.content[0].text : "";
}
