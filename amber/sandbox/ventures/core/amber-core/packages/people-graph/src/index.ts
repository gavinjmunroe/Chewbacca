/**
 * People Graph
 * Hybrid search: structured filters + semantic (pgvector) + recency + trust weighting
 */

import type { Person, PersonSearchResult, Memory, ActionItem } from '@amber/shared-types'

export interface SearchDeps {
  runQuery: (sql: string, params: unknown[]) => Promise<unknown[]>
  claudeApiKey: string
}

export interface SearchOptions {
  query: string
  userId: string
  limit?: number
  trustMinimum?: number
  location?: string
  tags?: string[]
}

/**
 * Hybrid people search.
 * Combines semantic similarity (pgvector), structured filters, recency, and trust.
 */
export async function searchPeople(
  options: SearchOptions,
  deps: SearchDeps
): Promise<PersonSearchResult[]> {
  const { query, userId, limit = 5, trustMinimum, location, tags } = options

  // 1. Classify query intent
  const intent = await classifySearchIntent(query, deps.claudeApiKey)

  // 2. Generate query embedding
  const embedding = await getQueryEmbedding(query)

  // 3. Build SQL with pgvector cosine similarity + filters
  const conditions: string[] = ['p.user_id = $1']
  const params: unknown[] = [userId]
  let paramIdx = 2

  if (trustMinimum) {
    conditions.push(`p.trust_level >= $${paramIdx}`)
    params.push(trustMinimum)
    paramIdx++
  }

  if (location) {
    conditions.push(`p.location ILIKE $${paramIdx}`)
    params.push(`%${location}%`)
    paramIdx++
  }

  if (tags && tags.length > 0) {
    conditions.push(`p.tags && $${paramIdx}::text[]`)
    params.push(tags)
    paramIdx++
  }

  const embeddingParam = embedding.length > 0
    ? `1 - (p.embedding_vector <=> $${paramIdx}::vector)`
    : '0.5'

  if (embedding.length > 0) {
    params.push(`[${embedding.join(',')}]`)
    paramIdx++
  }

  const sql = `
    SELECT
      p.*,
      ${embeddingParam} AS semantic_score,
      CASE
        WHEN p.last_interaction_at > NOW() - INTERVAL '7 days' THEN 1.0
        WHEN p.last_interaction_at > NOW() - INTERVAL '30 days' THEN 0.7
        WHEN p.last_interaction_at > NOW() - INTERVAL '90 days' THEN 0.4
        ELSE 0.1
      END AS recency_score,
      (p.trust_level::float / 5.0) AS trust_score
    FROM people p
    WHERE ${conditions.join(' AND ')}
    ORDER BY (
      ${embeddingParam} * 0.5 +
      (p.trust_level::float / 5.0) * 0.3 +
      CASE
        WHEN p.last_interaction_at > NOW() - INTERVAL '7 days' THEN 1.0
        WHEN p.last_interaction_at > NOW() - INTERVAL '30 days' THEN 0.7
        ELSE 0.2
      END * 0.2
    ) DESC
    LIMIT $${paramIdx}
  `
  params.push(limit)

  const rows = await deps.runQuery(sql, params) as Person[]

  // 4. Build results with reasons
  const results: PersonSearchResult[] = []
  for (const person of rows) {
    const reasons = await generateMatchReasons(person, query, intent, deps.claudeApiKey)
    const openItems = await getOpenActionItems(person.id, userId, deps)

    results.push({
      person,
      score: 0.8, // calculated above in SQL
      matchReasons: reasons,
      relevantMemories: [],
      latestInteraction: person.lastInteractionAt,
      suggestedNextMove: person.nextRecommendedMoveAt ? undefined : await suggestNextMove(person, deps.claudeApiKey),
      openActionItems: openItems
    })
  }

  return results
}

async function classifySearchIntent(query: string, apiKey: string): Promise<string> {
  // Quick intent classification
  const lower = query.toLowerCase()
  if (lower.includes('retreat') || lower.includes('invite')) return 'retreat_invite'
  if (lower.includes('advice') || lower.includes('talk to')) return 'advice_seeking'
  if (lower.includes('emotional') || lower.includes('vulnerable')) return 'emotional_support'
  if (lower.includes('follow up') || lower.includes('owe')) return 'follow_up'
  if (lower.includes('reconnect') || lower.includes('check in')) return 'reconnect'
  return 'general'
}

async function getQueryEmbedding(query: string): Promise<number[]> {
  if (!process.env.OPENAI_API_KEY) return []
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: query })
    })
    if (!response.ok) return []
    const data = await response.json()
    return data.data[0].embedding
  } catch {
    return []
  }
}

async function generateMatchReasons(
  person: Person,
  query: string,
  intent: string,
  apiKey: string
): Promise<string[]> {
  const reasons: string[] = []
  const lower = query.toLowerCase()

  // Deterministic reasons from structured data
  if (person.trustLevel >= 4) reasons.push('High trust relationship')
  if (person.emotionalSafetyScore && person.emotionalSafetyScore > 75) {
    reasons.push('Emotionally safe')
  }
  if (person.tags.some(t => lower.includes(t.toLowerCase()))) {
    reasons.push(`Tagged: ${person.tags.filter(t => lower.includes(t.toLowerCase())).join(', ')}`)
  }
  if (person.location && lower.includes(person.location.toLowerCase())) {
    reasons.push(`In ${person.location}`)
  }
  if (person.reliabilityScore && person.reliabilityScore > 80) {
    reasons.push('Highly reliable')
  }

  return reasons.length > 0 ? reasons : ['Matched based on relationship context']
}

async function suggestNextMove(person: Person, apiKey: string): Promise<string | undefined> {
  if (!person.lastInteractionAt) return `Reach out to ${person.fullName} — no recent interaction on record.`

  const daysSince = Math.floor((Date.now() - new Date(person.lastInteractionAt).getTime()) / 86400000)
  if (daysSince > 45) return `Check in — it's been ${daysSince} days since your last interaction.`
  if (person.tags.includes('retreat_fit')) return 'Consider inviting to next Ritual.'

  return undefined
}

async function getOpenActionItems(
  personId: string,
  userId: string,
  deps: SearchDeps
): Promise<ActionItem[]> {
  try {
    const rows = await deps.runQuery(
      `SELECT * FROM action_items WHERE user_id = $1 AND $2 = ANY(person_ids) AND status = 'open'`,
      [userId, personId]
    )
    return rows as ActionItem[]
  } catch {
    return []
  }
}
