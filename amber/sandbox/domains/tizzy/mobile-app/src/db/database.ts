/**
 * Local Database Setup using expo-sqlite
 * Provides offline storage for sessions, features, goals, and sync queue
 * Implements migration system, transaction support, and CRUD helpers
 */

import * as SQLite from 'expo-sqlite';
import { Session, AudioFeature, Goal } from '../shared/types/api';

const DB_NAME = 'tizzy.db';
const DB_VERSION = 1;

/**
 * Sync status type for tracking API synchronization
 */
export type SyncStatus = 'pending' | 'synced' | 'failed' | 'in_progress';

/**
 * Database tables schema
 */
export interface SessionTable {
  id: string;
  user_id: string;
  device_id: string;
  start_time: string;
  end_time: string | null;
  total_duration_seconds: number;
  speaker_count_estimate: number;
  environment_tag: string;
  consent_mode: string;
  conversation_count: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  sync_attempts: number;
  last_sync_attempt: string | null;
}

export interface AudioFeatureTable {
  id: string;
  session_id: string;
  timestamp: string;
  feature_vector: string; // JSON stringified
  metadata: string | null; // JSON stringified
  sync_status: SyncStatus;
  created_at: string;
}

export interface GoalTable {
  id: string;
  user_id: string;
  title: string;
  description: string;
  target_metric: string;
  target_value: number | null;
  current_value: number | null;
  status: string;
  created_at: string;
  updated_at: string;
  target_date: string | null;
  completed_at: string | null;
  sync_status: SyncStatus;
  sync_attempts: number;
  last_sync_attempt: string | null;
}

export interface SyncQueueTable {
  id: string;
  entity_type: 'session' | 'audio_feature' | 'goal';
  entity_id: string;
  operation: 'create' | 'update' | 'delete';
  payload: string; // JSON stringified
  sync_status: SyncStatus;
  sync_attempts: number;
  last_sync_attempt: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettingsTable {
  key: string;
  value: string; // JSON stringified
  updated_at: string;
}

/**
 * Migration definition
 */
interface Migration {
  version: number;
  name: string;
  up: (db: SQLite.SQLiteDatabase) => Promise<void>;
  down: (db: SQLite.SQLiteDatabase) => Promise<void>;
}

/**
 * Transaction callback type
 */
type TransactionCallback<T> = (db: SQLite.SQLiteDatabase) => Promise<T>;

/**
 * Database class for local storage
 * Provides comprehensive CRUD operations, transaction support, and sync management
 */
export class TizzyDatabase {
  private db: SQLite.SQLiteDatabase | null = null;
  private initialized: boolean = false;
  private inTransaction: boolean = false;

  /**
   * Initialize database connection and run migrations
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.db = await SQLite.openDatabaseAsync(DB_NAME);

      // Enable foreign keys and other optimizations
      await this.db.execAsync(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
      `);

      // Run migrations
      await this.runMigrations();

      this.initialized = true;
      console.log('[Database] Initialized successfully');
    } catch (error) {
      console.error('[Database] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Get database instance
   */
  private getDb(): SQLite.SQLiteDatabase {
    if (!this.db || !this.initialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Execute a transaction with automatic rollback on error
   */
  async transaction<T>(callback: TransactionCallback<T>): Promise<T> {
    const db = this.getDb();

    if (this.inTransaction) {
      return callback(db);
    }

    try {
      this.inTransaction = true;
      await db.execAsync('BEGIN TRANSACTION');
      const result = await callback(db);
      await db.execAsync('COMMIT');
      return result;
    } catch (error) {
      await db.execAsync('ROLLBACK');
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  /**
   * Run database migrations
   */
  private async runMigrations(): Promise<void> {
    const db = this.getDb();

    // Create migrations table if it doesn't exist
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    // Get current version
    const result = await db.getFirstAsync<{ version: number }>(
      'SELECT MAX(version) as version FROM migrations'
    );
    const currentVersion = result?.version || 0;

    console.log(`[Database] Current version: ${currentVersion}`);

    // Apply pending migrations
    for (const migration of migrations) {
      if (migration.version > currentVersion) {
        console.log(`[Database] Applying migration ${migration.version}: ${migration.name}`);
        await migration.up(db);
        await db.runAsync(
          'INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)',
          [migration.version, migration.name, new Date().toISOString()]
        );
      }
    }
  }

  // ==========================================
  // Sessions CRUD
  // ==========================================

  /**
   * Create a new session
   */
  async createSession(
    session: Omit<SessionTable, 'sync_status' | 'sync_attempts' | 'last_sync_attempt'>
  ): Promise<SessionTable> {
    const db = this.getDb();
    await db.runAsync(
      `INSERT INTO sessions (
        id, user_id, device_id, start_time, end_time, total_duration_seconds,
        speaker_count_estimate, environment_tag, consent_mode, conversation_count,
        created_at, updated_at, sync_status, sync_attempts, last_sync_attempt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.user_id,
        session.device_id,
        session.start_time,
        session.end_time,
        session.total_duration_seconds,
        session.speaker_count_estimate,
        session.environment_tag,
        session.consent_mode,
        session.conversation_count,
        session.created_at,
        session.updated_at,
        'pending',
        0,
        null
      ]
    );
    return {
      ...session,
      sync_status: 'pending',
      sync_attempts: 0,
      last_sync_attempt: null
    };
  }

  /**
   * Update an existing session
   */
  async updateSession(id: string, updates: Partial<SessionTable>): Promise<SessionTable | null> {
    const db = this.getDb();
    const fields: string[] = [];
    const values: any[] = [];

    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'sync_status' || value !== 'synced') {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    });

    if (fields.length === 0) {
      return this.getSession(id);
    }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    await db.runAsync(
      `UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return this.getSession(id);
  }

  /**
   * Get session by ID
   */
  async getSession(id: string): Promise<SessionTable | null> {
    const db = this.getDb();
    return await db.getFirstAsync<SessionTable>(
      'SELECT * FROM sessions WHERE id = ?',
      [id]
    );
  }

  /**
   * Get all sessions for a user
   */
  async getSessions(userId: string, limit: number = 50, offset: number = 0): Promise<SessionTable[]> {
    const db = this.getDb();
    return await db.getAllAsync<SessionTable>(
      'SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [userId, limit, offset]
    );
  }

  /**
   * Get sessions pending sync
   */
  async getPendingSessions(limit: number = 100): Promise<SessionTable[]> {
    const db = this.getDb();
    return await db.getAllAsync<SessionTable>(
      "SELECT * FROM sessions WHERE sync_status IN ('pending', 'failed') ORDER BY created_at ASC LIMIT ?",
      [limit]
    );
  }

  /**
   * Delete session
   */
  async deleteSession(id: string): Promise<void> {
    const db = this.getDb();
    await db.runAsync('DELETE FROM sessions WHERE id = ?', [id]);
  }

  /**
   * Update session sync status
   */
  async updateSessionSyncStatus(id: string, status: SyncStatus, attempts?: number): Promise<void> {
    const db = this.getDb();
    const now = new Date().toISOString();
    const newAttempts = attempts ?? (status === 'failed' ? 1 : 0);

    await db.runAsync(
      'UPDATE sessions SET sync_status = ?, sync_attempts = ?, last_sync_attempt = ?, updated_at = ? WHERE id = ?',
      [status, newAttempts, now, now, id]
    );
  }

  // ==========================================
  // Audio Features CRUD
  // ==========================================

  /**
   * Create a new audio feature record
   */
  async createAudioFeature(
    feature: Omit<AudioFeatureTable, 'sync_status' | 'created_at'>
  ): Promise<AudioFeatureTable> {
    const db = this.getDb();
    await db.runAsync(
      `INSERT INTO audio_features (
        id, session_id, timestamp, feature_vector, metadata, sync_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        feature.id,
        feature.session_id,
        feature.timestamp,
        feature.feature_vector,
        feature.metadata,
        'pending',
        new Date().toISOString()
      ]
    );
    return {
      ...feature,
      sync_status: 'pending',
      created_at: new Date().toISOString()
    };
  }

  /**
   * Get audio features for a session
   */
  async getAudioFeatures(sessionId: string): Promise<AudioFeatureTable[]> {
    const db = this.getDb();
    return await db.getAllAsync<AudioFeatureTable>(
      'SELECT * FROM audio_features WHERE session_id = ? ORDER BY timestamp ASC',
      [sessionId]
    );
  }

  /**
   * Get features pending sync
   */
  async getPendingAudioFeatures(limit: number = 100): Promise<AudioFeatureTable[]> {
    const db = this.getDb();
    return await db.getAllAsync<AudioFeatureTable>(
      "SELECT * FROM audio_features WHERE sync_status IN ('pending', 'failed') ORDER BY created_at ASC LIMIT ?",
      [limit]
    );
  }

  /**
   * Update audio feature sync status
   */
  async updateAudioFeatureSyncStatus(id: string, status: SyncStatus): Promise<void> {
    const db = this.getDb();
    await db.runAsync(
      'UPDATE audio_features SET sync_status = ? WHERE id = ?',
      [status, id]
    );
  }

  /**
   * Delete audio features for a session
   */
  async deleteAudioFeatures(sessionId: string): Promise<void> {
    const db = this.getDb();
    await db.runAsync('DELETE FROM audio_features WHERE session_id = ?', [sessionId]);
  }

  /**
   * Get audio feature count for session
   */
  async getAudioFeatureCount(sessionId: string): Promise<number> {
    const db = this.getDb();
    const result = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM audio_features WHERE session_id = ?',
      [sessionId]
    );
    return result?.count || 0;
  }

  // ==========================================
  // Goals CRUD
  // ==========================================

  /**
   * Create a new goal
   */
  async createGoal(
    goal: Omit<GoalTable, 'sync_status' | 'sync_attempts' | 'last_sync_attempt'>
  ): Promise<GoalTable> {
    const db = this.getDb();
    await db.runAsync(
      `INSERT INTO goals (
        id, user_id, title, description, target_metric, target_value, current_value,
        status, created_at, updated_at, target_date, completed_at,
        sync_status, sync_attempts, last_sync_attempt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        goal.id,
        goal.user_id,
        goal.title,
        goal.description,
        goal.target_metric,
        goal.target_value,
        goal.current_value,
        goal.status,
        goal.created_at,
        goal.updated_at,
        goal.target_date,
        goal.completed_at,
        'pending',
        0,
        null
      ]
    );
    return {
      ...goal,
      sync_status: 'pending',
      sync_attempts: 0,
      last_sync_attempt: null
    };
  }

  /**
   * Update an existing goal
   */
  async updateGoal(id: string, updates: Partial<GoalTable>): Promise<GoalTable | null> {
    const db = this.getDb();
    const fields: string[] = [];
    const values: any[] = [];

    Object.entries(updates).forEach(([key, value]) => {
      fields.push(`${key} = ?`);
      values.push(value);
    });

    if (fields.length === 0) {
      return this.getGoal(id);
    }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    await db.runAsync(
      `UPDATE goals SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return this.getGoal(id);
  }

  /**
   * Get goal by ID
   */
  async getGoal(id: string): Promise<GoalTable | null> {
    const db = this.getDb();
    return await db.getFirstAsync<GoalTable>(
      'SELECT * FROM goals WHERE id = ?',
      [id]
    );
  }

  /**
   * Get all goals for a user
   */
  async getGoals(userId: string, status?: string): Promise<GoalTable[]> {
    const db = this.getDb();
    if (status) {
      return await db.getAllAsync<GoalTable>(
        'SELECT * FROM goals WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
        [userId, status]
      );
    }
    return await db.getAllAsync<GoalTable>(
      'SELECT * FROM goals WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
  }

  /**
   * Get goals pending sync
   */
  async getPendingGoals(limit: number = 100): Promise<GoalTable[]> {
    const db = this.getDb();
    return await db.getAllAsync<GoalTable>(
      "SELECT * FROM goals WHERE sync_status IN ('pending', 'failed') ORDER BY created_at ASC LIMIT ?",
      [limit]
    );
  }

  /**
   * Delete goal
   */
  async deleteGoal(id: string): Promise<void> {
    const db = this.getDb();
    await db.runAsync('DELETE FROM goals WHERE id = ?', [id]);
  }

  /**
   * Update goal sync status
   */
  async updateGoalSyncStatus(id: string, status: SyncStatus, attempts?: number): Promise<void> {
    const db = this.getDb();
    const now = new Date().toISOString();
    const newAttempts = attempts ?? (status === 'failed' ? 1 : 0);

    await db.runAsync(
      'UPDATE goals SET sync_status = ?, sync_attempts = ?, last_sync_attempt = ?, updated_at = ? WHERE id = ?',
      [status, newAttempts, now, now, id]
    );
  }

  // ==========================================
  // Sync Queue CRUD
  // ==========================================

  /**
   * Add an item to the sync queue
   */
  async addToSyncQueue(
    entityType: SyncQueueTable['entity_type'],
    entityId: string,
    operation: SyncQueueTable['operation'],
    payload: any
  ): Promise<SyncQueueTable> {
    const db = this.getDb();
    const id = `${entityType}-${entityId}-${Date.now()}`;
    const now = new Date().toISOString();

    await db.runAsync(
      `INSERT INTO sync_queue (
        id, entity_type, entity_id, operation, payload, sync_status, sync_attempts, last_sync_attempt, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, entityType, entityId, operation, JSON.stringify(payload), 'pending', 0, null, now, now]
    );

    return {
      id,
      entity_type: entityType,
      entity_id: entityId,
      operation,
      payload: JSON.stringify(payload),
      sync_status: 'pending',
      sync_attempts: 0,
      last_sync_attempt: null,
      created_at: now,
      updated_at: now
    };
  }

  /**
   * Get items pending sync
   */
  async getPendingSyncQueueItems(limit: number = 50): Promise<SyncQueueTable[]> {
    const db = this.getDb();
    return await db.getAllAsync<SyncQueueTable>(
      "SELECT * FROM sync_queue WHERE sync_status IN ('pending', 'failed') ORDER BY created_at ASC LIMIT ?",
      [limit]
    );
  }

  /**
   * Update sync queue item status
   */
  async updateSyncQueueStatus(id: string, status: SyncStatus, attempts?: number): Promise<void> {
    const db = this.getDb();
    const now = new Date().toISOString();
    const newAttempts = attempts ?? (status === 'failed' ? 1 : 0);

    await db.runAsync(
      'UPDATE sync_queue SET sync_status = ?, sync_attempts = ?, last_sync_attempt = ?, updated_at = ? WHERE id = ?',
      [status, newAttempts, now, now, id]
    );
  }

  /**
   * Remove item from sync queue
   */
  async removeSyncQueueItem(id: string): Promise<void> {
    const db = this.getDb();
    await db.runAsync('DELETE FROM sync_queue WHERE id = ?', [id]);
  }

  /**
   * Clear synced items from queue
   */
  async clearSyncedQueueItems(): Promise<void> {
    const db = this.getDb();
    await db.runAsync("DELETE FROM sync_queue WHERE sync_status = 'synced'");
  }

  /**
   * Get sync queue statistics
   */
  async getSyncQueueStats(): Promise<{ pending: number; failed: number; synced: number }> {
    const db = this.getDb();
    const result = await db.getFirstAsync<any>(
      `SELECT
        SUM(CASE WHEN sync_status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN sync_status = 'synced' THEN 1 ELSE 0 END) as synced
      FROM sync_queue`
    );

    return {
      pending: result?.pending || 0,
      failed: result?.failed || 0,
      synced: result?.synced || 0
    };
  }

  // ==========================================
  // Settings
  // ==========================================

  /**
   * Set a setting value
   */
  async setSetting(key: string, value: any): Promise<void> {
    const db = this.getDb();
    const valueStr = JSON.stringify(value);
    await db.runAsync(
      `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
      [key, valueStr, new Date().toISOString()]
    );
  }

  /**
   * Get a setting value
   */
  async getSetting<T>(key: string, defaultValue?: T): Promise<T | null> {
    const db = this.getDb();
    const result = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?',
      [key]
    );

    if (!result) return defaultValue || null;

    try {
      return JSON.parse(result.value) as T;
    } catch {
      return defaultValue || null;
    }
  }

  /**
   * Delete a setting
   */
  async deleteSetting(key: string): Promise<void> {
    const db = this.getDb();
    await db.runAsync('DELETE FROM settings WHERE key = ?', [key]);
  }

  /**
   * Get all settings
   */
  async getAllSettings(): Promise<Record<string, any>> {
    const db = this.getDb();
    const results = await db.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM settings'
    );

    const settings: Record<string, any> = {};
    results.forEach(row => {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    });

    return settings;
  }

  // ==========================================
  // Utilities & Maintenance
  // ==========================================

  /**
   * Clear all data from database
   */
  async clearAllData(): Promise<void> {
    const db = this.getDb();
    await db.execAsync(`
      DELETE FROM sessions;
      DELETE FROM audio_features;
      DELETE FROM goals;
      DELETE FROM sync_queue;
      DELETE FROM settings;
    `);
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{
    sessions: number;
    audio_features: number;
    goals: number;
    sync_queue: number;
    settings: number;
  }> {
    const db = this.getDb();
    const [sessionsResult, featuresResult, goalsResult, queueResult, settingsResult] = await Promise.all([
      db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM sessions'),
      db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM audio_features'),
      db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM goals'),
      db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM sync_queue'),
      db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM settings')
    ]);

    return {
      sessions: sessionsResult?.count || 0,
      audio_features: featuresResult?.count || 0,
      goals: goalsResult?.count || 0,
      sync_queue: queueResult?.count || 0,
      settings: settingsResult?.count || 0
    };
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.closeAsync();
      this.db = null;
      this.initialized = false;
    }
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Database migrations
 */
const migrations: Migration[] = [
  {
    version: 1,
    name: 'Initial schema creation',
    up: async (db: SQLite.SQLiteDatabase) => {
      // Create sessions table
      // Stores practice sessions with sync tracking
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT,
          total_duration_seconds INTEGER NOT NULL DEFAULT 0,
          speaker_count_estimate INTEGER NOT NULL DEFAULT 0,
          environment_tag TEXT NOT NULL,
          consent_mode TEXT NOT NULL,
          conversation_count INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          sync_status TEXT NOT NULL DEFAULT 'pending',
          sync_attempts INTEGER NOT NULL DEFAULT 0,
          last_sync_attempt TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_sync_status ON sessions(sync_status);
        CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
      `);

      // Create audio features table
      // Stores audio feature vectors extracted during sessions
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS audio_features (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          feature_vector TEXT NOT NULL,
          metadata TEXT,
          sync_status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_audio_features_session_id ON audio_features(session_id);
        CREATE INDEX IF NOT EXISTS idx_audio_features_sync_status ON audio_features(sync_status);
        CREATE INDEX IF NOT EXISTS idx_audio_features_timestamp ON audio_features(timestamp);
      `);

      // Create goals table
      // Stores user goals and targets for improvement
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS goals (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          target_metric TEXT NOT NULL,
          target_value REAL,
          current_value REAL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          target_date TEXT,
          completed_at TEXT,
          sync_status TEXT NOT NULL DEFAULT 'pending',
          sync_attempts INTEGER NOT NULL DEFAULT 0,
          last_sync_attempt TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_goals_user_id ON goals(user_id);
        CREATE INDEX IF NOT EXISTS idx_goals_sync_status ON goals(sync_status);
        CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
      `);

      // Create sync queue table
      // Tracks pending operations for offline-first synchronization
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS sync_queue (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          payload TEXT NOT NULL,
          sync_status TEXT NOT NULL DEFAULT 'pending',
          sync_attempts INTEGER NOT NULL DEFAULT 0,
          last_sync_attempt TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(sync_status);
        CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, entity_id);
        CREATE INDEX IF NOT EXISTS idx_sync_queue_created_at ON sync_queue(created_at);
      `);

      // Create settings table
      // Stores application settings and preferences
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
    down: async (db: SQLite.SQLiteDatabase) => {
      await db.execAsync(`
        DROP TABLE IF EXISTS sync_queue;
        DROP TABLE IF EXISTS audio_features;
        DROP TABLE IF EXISTS goals;
        DROP TABLE IF EXISTS sessions;
        DROP TABLE IF EXISTS settings;
      `);
    }
  }
];

/**
 * Initialize the database
 * Must be called once on app startup
 */
export async function initDatabase(): Promise<void> {
  await database.initialize();
}

/**
 * Get the database instance
 * Ensure initialize() has been called first
 */
export function getDatabase(): TizzyDatabase {
  return database;
}

/**
 * Export migrations for reference and testing
 */
export { migrations };

// Singleton instance
export const database = new TizzyDatabase();
