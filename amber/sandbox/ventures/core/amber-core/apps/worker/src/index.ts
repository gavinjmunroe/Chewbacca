/**
 * Amber Background Worker
 * Handles: scheduled reminders, relationship drift detection, proactive suggestions
 * Deployed on Railway as a separate service.
 */

import { createServer } from 'http'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// ============================================================================
// HEALTH SERVER
// ============================================================================

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'running', service: 'amber-worker' }))
  } else {
    res.writeHead(200)
    res.end('Worker running.')
  }
})

server.listen(process.env.PORT || 3001)

// ============================================================================
// JOBS
// ============================================================================

async function detectRelationshipDrift() {
  try {
    // Find people who haven't been interacted with in 30+ days
    const { rows } = await pool.query(`
      SELECT p.id, p.user_id, p.full_name, p.last_interaction_at, p.trust_level
      FROM people p
      WHERE p.last_interaction_at < NOW() - INTERVAL '30 days'
        AND p.trust_level >= 3
      ORDER BY p.trust_level DESC, p.last_interaction_at ASC
      LIMIT 20
    `)

    for (const person of rows) {
      const daysSince = Math.floor(
        (Date.now() - new Date(person.last_interaction_at).getTime()) / 86400000
      )

      // Create agent suggestion
      await pool.query(`
        INSERT INTO agent_suggestions (id, user_id, person_id, suggestion_type, reasoning, confidence, urgency, dismissed, acted_on, created_at)
        VALUES (gen_random_uuid(), $1, $2, 'check_in', $3, $4, $5, false, false, NOW())
        ON CONFLICT DO NOTHING
      `, [
        person.user_id,
        person.id,
        `You haven't connected with ${person.full_name} in ${daysSince} days.`,
        0.8,
        daysSince > 60 ? 'high' : daysSince > 45 ? 'medium' : 'low'
      ])
    }

    console.log(`Drift check: ${rows.length} relationships flagged`)
  } catch (err: any) {
    console.error('Drift detection error:', err.message)
  }
}

async function flagOverdueActionItems() {
  try {
    const { rows } = await pool.query(`
      SELECT ai.*, p.full_name
      FROM action_items ai
      LEFT JOIN LATERAL (
        SELECT full_name FROM people WHERE id = ANY(ai.person_ids) LIMIT 1
      ) p ON true
      WHERE ai.status = 'open'
        AND ai.due_at < NOW()
      ORDER BY ai.due_at ASC
      LIMIT 50
    `)

    console.log(`Overdue action items: ${rows.length}`)
    return rows
  } catch (err: any) {
    console.error('Overdue action items error:', err.message)
    return []
  }
}

// ============================================================================
// SCHEDULER
// ============================================================================

async function runJobs() {
  console.log(`[${new Date().toISOString()}] Running scheduled jobs...`)
  await detectRelationshipDrift()
  await flagOverdueActionItems()
  console.log('Jobs complete.\n')
}

// Run on startup
runJobs()

// Run every 4 hours
const JOB_INTERVAL = parseInt(process.env.JOB_INTERVAL_MS || `${4 * 60 * 60 * 1000}`, 10)
setInterval(runJobs, JOB_INTERVAL)

console.log(`amber-worker started. Job interval: ${JOB_INTERVAL / 3600000}h`)
