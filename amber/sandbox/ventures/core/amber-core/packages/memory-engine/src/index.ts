/**
 * Memory Engine
 * Handles ingestion, extraction, embedding, and retrieval of memories.
 */

import type {
  Memory,
  Person,
  ActionItem,
  MemoryIngestionRequest,
  MemoryIngestionResult,
  MemorySource,
  PrivacyTier
} from '@amber/shared-types'

// ============================================================================
// EXTRACTION (Claude-powered)
// ============================================================================

export interface ExtractionResult {
  personNames: string[]
  traits: string[]
  emotionalLabel?: string
  trustSignals: string[]
  lifeEvents: string[]
  actionItems: Array<{
    description: string
    personName?: string
    dueHint?: string
    requiresApproval: boolean
  }>
  summary: string
  isActionable: boolean
}

export async function extractStructuredData(
  rawText: string,
  claudeApiKey: string
): Promise<ExtractionResult> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `You are a memory extraction engine for a relationship intelligence system.
Extract structured data from the user's note. Return JSON only, no explanation.

Schema:
{
  "personNames": string[],        // names of people mentioned
  "traits": string[],             // personality traits, characteristics
  "emotionalLabel": string,       // overall emotional tone (optional)
  "trustSignals": string[],       // indicators of trust level
  "lifeEvents": string[],         // significant life events mentioned
  "actionItems": [{
    "description": string,
    "personName": string,         // who it involves (optional)
    "dueHint": string,            // any timing mentioned (optional)
    "requiresApproval": boolean   // does this require approval to act on?
  }],
  "summary": string,              // 1-2 sentence summary
  "isActionable": boolean         // is there something to do here?
}`,
      messages: [{ role: 'user', content: rawText }]
    })
  })

  if (!response.ok) throw new Error(`Claude extraction failed: ${response.status}`)
  const data = await response.json()
  const text = data.content[0].text.trim()

  try {
    return JSON.parse(text)
  } catch {
    // Fallback: minimal extraction
    return {
      personNames: [],
      traits: [],
      trustSignals: [],
      lifeEvents: [],
      actionItems: [],
      summary: rawText.substring(0, 200),
      isActionable: false
    }
  }
}

// ============================================================================
// EMBEDDING (for semantic search via pgvector)
// ============================================================================

export async function generateEmbedding(
  text: string,
  claudeApiKey: string
): Promise<number[]> {
  // Use OpenAI embeddings or a local model for pgvector
  // Placeholder — wire up to your embedding service
  // Common choice: text-embedding-3-small via OpenAI API
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text
    })
  })

  if (!response.ok) return [] // Return empty if embedding fails
  const data = await response.json()
  return data.data[0].embedding
}

// ============================================================================
// INGESTION PIPELINE
// ============================================================================

export interface IngestionDeps {
  claudeApiKey: string
  saveMemory: (memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Memory>
  findOrCreatePerson: (name: string, userId: string) => Promise<Person>
  saveActionItem: (item: Omit<ActionItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ActionItem>
  updatePersonSummary: (personId: string, summary: string) => Promise<void>
}

export async function ingestMemory(
  request: MemoryIngestionRequest,
  userId: string,
  deps: IngestionDeps
): Promise<MemoryIngestionResult> {
  const { rawText, source, privacy = 'standard' } = request

  // 1. Extract structured data
  const extracted = await extractStructuredData(rawText, deps.claudeApiKey)

  // 2. Resolve people
  const linkedPeople: Person[] = []
  const hintedNames = request.personName
    ? [request.personName, ...extracted.personNames]
    : extracted.personNames

  for (const name of [...new Set(hintedNames)]) {
    if (name) {
      const person = await deps.findOrCreatePerson(name, userId)
      linkedPeople.push(person)
    }
  }

  // 3. Generate embedding
  const embeddingVector = await generateEmbedding(
    `${extracted.summary} ${extracted.traits.join(' ')} ${rawText}`,
    deps.claudeApiKey
  ).catch(() => [])

  // 4. Save memory
  const memory = await deps.saveMemory({
    userId,
    personIds: linkedPeople.map(p => p.id),
    source,
    rawContent: rawText,
    summary: extracted.summary,
    traits: extracted.traits,
    emotionalLabel: extracted.emotionalLabel,
    trustSignals: extracted.trustSignals,
    lifeEvents: extracted.lifeEvents,
    actionItemIds: [],
    confidence: 0.85,
    privacyTier: privacy,
    tags: [],
    embeddingVector,
    isActionable: extracted.isActionable
  })

  // 5. Create action items
  const createdActionItems: ActionItem[] = []
  for (const ai of extracted.actionItems) {
    const personId = linkedPeople.find(p =>
      p.fullName.toLowerCase().includes((ai.personName || '').toLowerCase())
    )?.id

    const actionItem = await deps.saveActionItem({
      userId,
      personIds: personId ? [personId] : linkedPeople.map(p => p.id),
      memoryId: memory.id,
      description: ai.description,
      priority: 2,
      status: 'open',
      requiresApproval: ai.requiresApproval,
      dueAt: ai.dueHint ? parseDueHint(ai.dueHint) : undefined
    })
    createdActionItems.push(actionItem)
  }

  return {
    memory,
    linkedPeople,
    createdActionItems,
    updatedRelationships: linkedPeople.map(p => p.id)
  }
}

function parseDueHint(hint: string): Date | undefined {
  // Basic natural language date parsing
  const lower = hint.toLowerCase()
  const now = new Date()

  if (lower.includes('tomorrow')) {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    return d
  }
  if (lower.includes('next week')) {
    const d = new Date(now)
    d.setDate(d.getDate() + 7)
    return d
  }
  if (lower.includes('tuesday')) {
    const d = new Date(now)
    d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7 || 7))
    return d
  }

  return undefined
}
