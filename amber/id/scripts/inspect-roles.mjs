/**
 * What the conversation_messages.role column actually contains.
 *
 * Run this before and after 20260908_031. Before, every one of Amber's replies
 * is sitting in the 'user' bucket with a model name in its metadata, which is
 * the signature of the coercion bug in csql-conversation-store.js. After, that
 * number is zero.
 *
 *   railway run node scripts/inspect-roles.mjs
 */
import { query, closePool } from "../src/db/sql.js";

const rows = async (sql) => (await query(sql)).rows;

const byRole = await rows(`
  SELECT role, count(*)::int AS n
    FROM conversation_messages
   WHERE deleted_at IS NULL
   GROUP BY role ORDER BY role`);

const misfiled = await rows(`
  SELECT count(*)::int AS n
    FROM conversation_messages
   WHERE deleted_at IS NULL
     AND role = 'user'
     AND metadata IS NOT NULL
     AND metadata ? 'model'`);

const announce = await rows(`
  SELECT count(*)::int AS n
    FROM conversation_messages
   WHERE deleted_at IS NULL
     AND metadata IS NOT NULL
     AND metadata ? 'capturedOutcomes'`);

console.log("role counts:", byRole.map((r) => `${r.role}=${r.n}`).join(" | "));
console.log("Amber's replies still filed as the user:", misfiled[0].n, "(should be 0 after the migration)");
console.log("announce rows carrying capturedOutcomes:", announce[0].n);

await closePool();
