/**
 * Database Module Exports
 * Complete local database setup with migration system, CRUD helpers, and sync management
 */

export {
  database,
  TizzyDatabase,
  initDatabase,
  getDatabase,
  migrations,
} from './database';

export type {
  SessionTable,
  AudioFeatureTable,
  GoalTable,
  SyncQueueTable,
  SettingsTable,
  SyncStatus,
} from './database';
