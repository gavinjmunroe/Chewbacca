import express from 'express'
import crypto from 'crypto'
import cors from 'cors'
import { Pool } from 'pg'
import { ingestMemory } from '@amber/memory-engine'
import { searchPeople } from '@amber/people-graph'
import type { MemoryIngestionRequest } from '@amber/shared-types'

const app = express()
app.use(cors())
app.use(express.json())

// ============================================================================
// DATABASE
// ============================================================================

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function runQuery(sql: string, params: unknown[]) {
  const { rows } = await pool.query(sql, params)
  return rows
}

// ============================================================================
// AUTH MIDDLEWARE
// ============================================================================

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token || token !== process.env.AMBER_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  // For now, single-user: userId from env
  ;(req as any).userId = process.env.AMBER_USER_ID || 'sagar'
  next()
}

// ============================================================================
// HEALTH
// ============================================================================

app.get('/health', (_, res) => {
  res.json({ status: 'ok', service: 'amber-api' })
})

// ============================================================================
// PEOPLE
// ============================================================================

app.get('/api/people', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId
    const people = await runQuery(
      'SELECT * FROM people WHERE user_id = $1 ORDER BY full_name',
      [userId]
    )
    res.json({ people })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/people/search', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId
    const query = req.query.q as string

    if (!query) return res.status(400).json({ error: 'q is required' })

    const results = await searchPeople(
      { query, userId, limit: 5 },
      { runQuery, claudeApiKey: process.env.CLAUDE_API_KEY! }
    )

    res.json({ results })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/people/:id', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId
    const [person] = await runQuery(
      'SELECT * FROM people WHERE id = $1 AND user_id = $2',
      [req.params.id, userId]
    )
    if (!person) return res.status(404).json({ error: 'Not found' })
    res.json({ person })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/people', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId
    const { fullName, ...rest } = req.body

    const [person] = await runQuery(
      `INSERT INTO people (id, user_id, full_name, nicknames, other_handles, tags, interests, values, preferences, aversions, privacy_tier, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, '{}', '{}', '{}', '{}', '{}', '{}', '{}', 'standard', NOW(), NOW())
       RETURNING *`,
      [userId, fullName]
    )
    res.status(201).json({ person })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ============================================================================
// MEMORIES
// ============================================================================

app.post('/api/memories', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId
    const request = req.body as MemoryIngestionRequest

    const result = await ingestMemory(request, userId, {
      claudeApiKey: process.env.CLAUDE_API_KEY!,
      saveMemory: async (memory) => {
        const [saved] = await runQuery(
          `INSERT INTO memories (id, user_id, person_ids, source, raw_content, summary, traits, emotional_label, trust_signals, life_events, action_item_ids, confidence, privacy_tier, tags, is_actionable, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, '{}', $10, $11, '{}', $12, NOW(), NOW())
           RETURNING *`,
          [
            memory.userId, memory.personIds, memory.source, memory.rawContent,
            memory.summary, memory.traits, memory.emotionalLabel, memory.trustSignals,
            memory.lifeEvents, memory.confidence, memory.privacyTier, memory.isActionable
          ]
        )
        return saved as any
      },
      findOrCreatePerson: async (name, uid) => {
        const existing = await runQuery(
          `SELECT * FROM people WHERE user_id = $1 AND full_name ILIKE $2 LIMIT 1`,
          [uid, name]
        )
        if (existing.length > 0) return existing[0] as any

        const [created] = await runQuery(
          `INSERT INTO people (id, user_id, full_name, nicknames, other_handles, tags, interests, values, preferences, aversions, privacy_tier, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, '{}', '{}', '{}', '{}', '{}', '{}', '{}', 'standard', NOW(), NOW())
           RETURNING *`,
          [uid, name]
        )
        return created as any
      },
      saveActionItem: async (item) => {
        const [saved] = await runQuery(
          `INSERT INTO action_items (id, user_id, person_ids, memory_id, description, priority, status, requires_approval, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'open', $6, NOW(), NOW())
           RETURNING *`,
          [item.userId, item.personIds, item.memoryId, item.description, item.priority, item.requiresApproval]
        )
        return saved as any
      },
      updatePersonSummary: async (personId, summary) => {
        await runQuery(
          'UPDATE people SET summary_text = $1, updated_at = NOW() WHERE id = $2',
          [summary, personId]
        )
      }
    })

    res.status(201).json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/memories', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId
    const { personId, limit = 20 } = req.query

    const sql = personId
      ? 'SELECT * FROM memories WHERE user_id = $1 AND $2 = ANY(person_ids) ORDER BY created_at DESC LIMIT $3'
      : 'SELECT * FROM memories WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2'

    const params = personId ? [userId, personId, limit] : [userId, limit]
    const memories = await runQuery(sql, params)
    res.json({ memories })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ============================================================================
// ACTION ITEMS
// ============================================================================

app.get('/api/action-items', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId
    const items = await runQuery(
      `SELECT ai.*, p.full_name as person_name
       FROM action_items ai
       LEFT JOIN people p ON p.id = ANY(ai.person_ids) AND p.user_id = ai.user_id
       WHERE ai.user_id = $1 AND ai.status = 'open'
       ORDER BY ai.priority ASC, ai.created_at ASC`,
      [userId]
    )
    res.json({ items })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/action-items/:id', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId
    const { status } = req.body
    const [item] = await runQuery(
      `UPDATE action_items SET status = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *`,
      [status, req.params.id, userId]
    )
    res.json({ item })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ============================================================================
// APPROVAL TASKS
// ============================================================================

app.get('/api/approvals', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId
    const tasks = await runQuery(
      `SELECT * FROM approval_tasks WHERE user_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
      [userId]
    )
    res.json({ tasks })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/approvals/:id', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId
    const { status, editedContent } = req.body
    const [task] = await runQuery(
      `UPDATE approval_tasks SET status = $1, edited_content = $2, resolved_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND user_id = $4 RETURNING *`,
      [status, editedContent, req.params.id, userId]
    )
    res.json({ task })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ============================================================================
// START
// ============================================================================

const PORT = process.env.PORT || 8080

app.listen(PORT, () => {
  console.log(`amber-api running on :${PORT}`)
})

// ============================================================================
// LOOP MESSAGE WEBHOOK (incoming iMessages → memory ingestion)
// ============================================================================

app.post('/webhooks/loop-message', async (req, res) => {
  // Verify Loop Message signature
  const signature = req.headers['loop-signature'] as string
  const secretKey = process.env.LOOP_SECRET_KEY

  if (secretKey && signature) {
    const expected = crypto
      .createHmac('sha256', secretKey)
      .update(JSON.stringify(req.body))
      .digest('hex')
    if (signature !== expected) {
      return res.status(401).json({ error: 'Invalid signature' })
    }
  }

  const { sender, text, recipient, type } = req.body

  // Only process inbound text messages
  if (type !== 'message' || !text) {
    return res.status(200).json({ ok: true })
  }

  const userId = process.env.AMBER_USER_ID || 'sagar'

  // Auto-ingest if message looks like a memory capture
  const isMemoryCapture = /^(remember|tag|attach|note|add|update)/i.test(text.trim())

  if (isMemoryCapture) {
    try {
      await fetch(`http://localhost:${process.env.PORT || 8080}/api/memories`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.AMBER_API_KEY}`
        },
        body: JSON.stringify({
          rawText: text,
          source: 'imessage'
        })
      })
    } catch (err: any) {
      console.error('Auto-ingest failed:', err.message)
    }
  }

  res.status(200).json({ ok: true })
})
