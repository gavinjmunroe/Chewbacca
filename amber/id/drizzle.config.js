/**
 * Drizzle Kit configuration for amber-id.
 *
 * Usage:
 *   npx drizzle-kit generate   — generate SQL migration files
 *   npx drizzle-kit push       — push schema directly (dev only)
 *   npx drizzle-kit studio     — open Drizzle Studio UI
 */

/** @type {import('drizzle-kit').Config} */
export default {
  schema: "./src/db/schema.js",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
};
