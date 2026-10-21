/**
 * Sync Service
 * Manages offline operations queue and synchronization with conflict resolution
 *
 * Features:
 * - Offline operation queue with persistence
 * - Automatic sync when network comes online
 * - Exponential backoff retry strategy
 * - Conflict resolution (server wins strategy)
 * - NetworkService integration
 * - Database integration for local caching
 * - Comprehensive sync status tracking
 * - Real-time listeners for sync state changes
 */

import { database, SessionTable, GoalTable, AudioFeatureTable } from '../db/database';
import { networkService, NetworkStatus } from './NetworkService';
import { apiService } from '../api/client';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SYNC_QUEUE_KEY = '@tizzy/sync_queue';
const SYNC_CONFLICTS_KEY = '@tizzy/sync_conflicts';
const SYNC_METADATA_KEY = '@tizzy/sync_metadata';
const MAX_RETRY_ATTEMPTS = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const AUTO_SYNC_INTERVAL = 30000; // 30 seconds
const MAX_QUEUE_SIZE = 1000;
const DB_INIT_TIMEOUT = 10000; // 10 seconds

/**
 * Utility function to wrap promises with timeout protection
 */
const withTimeout = <T>(promise: Promise<T>, ms: number, operation: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timeout after ${ms}ms`)), ms)
    )
  ]);
};

/**
 * Operation types that can be queued
 */
export type OperationType =
  | 'CREATE_SESSION'
  | 'END_SESSION'
  | 'UPLOAD_FEATURES'
  | 'CREATE_GOAL'
  | 'UPDATE_GOAL'
  | 'DELETE_GOAL'
  | 'UPDATE_USER_PROFILE';

/**
 * Conflict resolution strategy
 */
export type ConflictResolutionStrategy = 'server-wins' | 'client-wins' | 'manual';

/**
 * Sync conflict information
 */
export interface SyncConflict {
  id: string;
  operationId: string;
  type: OperationType;
  clientData: any;
  serverData: any;
  timestamp: string;
  resolved: boolean;
  resolution?: 'server' | 'client';
}

/**
 * Queued operation structure with enhanced metadata
 */
export interface QueuedOperation {
  id: string;
  type: OperationType;
  payload: any;
  timestamp: string;
  retryCount: number;
  lastAttempt: string | null;
  status: 'pending' | 'processing' | 'failed' | 'completed' | 'conflict';
  error?: string;
  priority: number; // Higher priority syncs first
  metadata?: {
    userId?: string;
    entityId?: string;
    batch?: string;
  };
}

/**
 * Enhanced sync status information
 */
export interface SyncStatus {
  isSyncing: boolean;
  pendingOperations: number;
  processingOperations: number;
  failedOperations: number;
  conflictOperations: number;
  lastSyncTime: string | null;
  lastSyncError: string | null;
  networkStatus: NetworkStatus;
  totalSynced: number; // Total operations synced in this session
  queueSize: number;
}

/**
 * Sync metrics for monitoring
 */
export interface SyncMetrics {
  totalOperations: number;
  successfulSyncs: number;
  failedSyncs: number;
  resolvedConflicts: number;
  averageSyncTime: number;
  lastSyncDuration: number;
  queuedSince: string | null;
}

export type SyncStatusListener = (status: SyncStatus) => void;
export type SyncConflictListener = (conflict: SyncConflict) => void;

/**
 * Sync Service Class
 * Handles offline operations and synchronization with conflict resolution
 */
export class SyncService {
  private queue: QueuedOperation[] = [];
  private conflicts: Map<string, SyncConflict> = new Map();
  private isSyncing: boolean = false;
  private syncInterval: NodeJS.Timeout | null = null;
  private listeners: Set<SyncStatusListener> = new Set();
  private conflictListeners: Set<SyncConflictListener> = new Set();
  private lastSyncTime: string | null = null;
  private lastSyncError: string | null = null;
  private initialized: boolean = false;
  private totalSynced: number = 0;
  private metrics: SyncMetrics = {
    totalOperations: 0,
    successfulSyncs: 0,
    failedSyncs: 0,
    resolvedConflicts: 0,
    averageSyncTime: 0,
    lastSyncDuration: 0,
    queuedSince: null
  };
  private conflictStrategy: ConflictResolutionStrategy = 'server-wins';

  /**
   * Initialize the sync service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Initialize database with timeout protection
      await withTimeout(
        database.initialize(),
        DB_INIT_TIMEOUT,
        'Database initialization'
      );

      // Load persisted queue and conflicts
      await this.loadQueue();
      await this.loadConflicts();
      await this.loadMetrics();

      // Initialize network service
      await networkService.initialize();

      // Listen for network changes
      networkService.addListener(this.handleNetworkChange.bind(this));

      // Start auto-sync if online
      if (networkService.isOnline()) {
        this.startAutoSync();
      }

      this.initialized = true;
      if (__DEV__) {
        console.log('[SyncService] Initialized successfully', {
          queueSize: this.queue.length,
          conflicts: this.conflicts.size,
          totalSynced: this.totalSynced
        });
      }
    } catch (error) {
      console.error('[SyncService] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Handle network status changes
   */
  private handleNetworkChange(status: NetworkStatus): void {
    if (__DEV__) {
      console.log(`[SyncService] Network status changed: ${status}`);
    }

    if (status === 'online') {
      // Start syncing when online
      this.startAutoSync();

      // Immediately try to sync if queue is not empty
      if (this.queue.length > 0 && !this.isSyncing) {
        this.sync().catch(error => {
          console.error('[SyncService] Auto-sync failed:', error);
        });
      }
    } else {
      // Stop syncing when offline
      this.stopAutoSync();
    }

    this.notifyListeners();
  }

  /**
   * Start automatic synchronization
   */
  private startAutoSync(): void {
    if (this.syncInterval) {
      return;
    }

    // Sync periodically when online and queue is not empty
    this.syncInterval = setInterval(() => {
      if (this.queue.length > 0 && !this.isSyncing) {
        this.sync().catch(error => {
          console.error('[SyncService] Periodic sync failed:', error);
        });
      }
    }, AUTO_SYNC_INTERVAL);

    if (__DEV__) {
      console.log('[SyncService] Auto-sync started (interval: 30s)');
    }
  }

  /**
   * Stop automatic synchronization
   */
  private stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      if (__DEV__) {
        console.log('[SyncService] Auto-sync stopped');
      }
    }
  }

  /**
   * Load queue from persistent storage
   */
  private async loadQueue(): Promise<void> {
    try {
      const queueJson = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
      if (queueJson) {
        this.queue = JSON.parse(queueJson).sort((a: QueuedOperation, b: QueuedOperation) => {
          // Sort by priority (descending) then by timestamp (ascending)
          if (a.priority !== b.priority) {
            return b.priority - a.priority;
          }
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        });

        if (this.queue.length > 0 && !this.metrics.queuedSince) {
          this.metrics.queuedSince = new Date(this.queue[0].timestamp).toISOString();
        }

        if (__DEV__) {
          console.log(`[SyncService] Loaded ${this.queue.length} operations from queue`);
        }
      }
    } catch (error) {
      console.error('[SyncService] Failed to load queue:', error);
      this.queue = [];
    }
  }

  /**
   * Save queue to persistent storage
   */
  private async saveQueue(): Promise<void> {
    try {
      // Limit queue size to prevent storage overflow
      const queueToSave = this.queue.slice(0, MAX_QUEUE_SIZE);
      await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queueToSave));
    } catch (error) {
      console.error('[SyncService] Failed to save queue:', error);
    }
  }

  /**
   * Load conflicts from persistent storage
   */
  private async loadConflicts(): Promise<void> {
    try {
      const conflictsJson = await AsyncStorage.getItem(SYNC_CONFLICTS_KEY);
      if (conflictsJson) {
        const conflictsList = JSON.parse(conflictsJson);
        conflictsList.forEach((conflict: SyncConflict) => {
          this.conflicts.set(conflict.id, conflict);
        });
        if (__DEV__) {
          console.log(`[SyncService] Loaded ${this.conflicts.size} conflicts`);
        }
      }
    } catch (error) {
      console.error('[SyncService] Failed to load conflicts:', error);
      this.conflicts.clear();
    }
  }

  /**
   * Save conflicts to persistent storage
   */
  private async saveConflicts(): Promise<void> {
    try {
      const conflictsList = Array.from(this.conflicts.values());
      await AsyncStorage.setItem(SYNC_CONFLICTS_KEY, JSON.stringify(conflictsList));
    } catch (error) {
      console.error('[SyncService] Failed to save conflicts:', error);
    }
  }

  /**
   * Load metrics from persistent storage
   */
  private async loadMetrics(): Promise<void> {
    try {
      const metricsJson = await AsyncStorage.getItem(SYNC_METADATA_KEY);
      if (metricsJson) {
        this.metrics = { ...this.metrics, ...JSON.parse(metricsJson) };
        if (__DEV__) {
          console.log('[SyncService] Metrics loaded:', this.metrics);
        }
      }
    } catch (error) {
      console.error('[SyncService] Failed to load metrics:', error);
    }
  }

  /**
   * Save metrics to persistent storage
   */
  private async saveMetrics(): Promise<void> {
    try {
      await AsyncStorage.setItem(SYNC_METADATA_KEY, JSON.stringify(this.metrics));
    } catch (error) {
      console.error('[SyncService] Failed to save metrics:', error);
    }
  }

  /**
   * Queue an operation for synchronization
   * @param type - Operation type
   * @param payload - Operation payload
   * @param priority - Priority level (default: 0, higher = syncs first)
   * @param metadata - Additional metadata for the operation
   */
  async queueOperation(
    type: OperationType,
    payload: any,
    priority: number = 0,
    metadata?: Record<string, any>
  ): Promise<string> {
    // Check queue size limit
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      throw new Error(`Queue is full (max: ${MAX_QUEUE_SIZE})`);
    }

    const operation: QueuedOperation = {
      id: this.generateId(),
      type,
      payload,
      timestamp: new Date().toISOString(),
      retryCount: 0,
      lastAttempt: null,
      status: 'pending',
      priority,
      metadata
    };

    // Insert operation maintaining priority order
    const insertIndex = this.queue.findIndex(
      op => op.priority < priority
    );

    if (insertIndex === -1) {
      this.queue.push(operation);
    } else {
      this.queue.splice(insertIndex, 0, operation);
    }

    this.metrics.totalOperations++;

    // Update queued since timestamp
    if (!this.metrics.queuedSince) {
      this.metrics.queuedSince = operation.timestamp;
    }

    await this.saveQueue();
    await this.saveMetrics();

    if (__DEV__) {
      console.log(`[SyncService] Queued operation: ${type} (priority: ${priority})`, {
        id: operation.id,
        queueSize: this.queue.length
      });
    }

    // Try to sync immediately if online
    if (networkService.isOnline() && !this.isSyncing) {
      this.sync().catch(error => {
        console.error('[SyncService] Immediate sync failed:', error);
      });
    }

    this.notifyListeners();
    return operation.id;
  }

  /**
   * Legacy alias for backwards compatibility
   */
  async enqueue(type: OperationType, payload: any): Promise<string> {
    return this.queueOperation(type, payload, 0);
  }

  /**
   * Synchronize all pending operations
   */
  async sync(): Promise<void> {
    if (this.isSyncing) {
      if (__DEV__) {
        console.log('[SyncService] Sync already in progress');
      }
      return;
    }

    if (!networkService.isOnline()) {
      if (__DEV__) {
        console.log('[SyncService] Cannot sync - offline');
      }
      return;
    }

    this.isSyncing = true;
    const syncStartTime = Date.now();
    this.notifyListeners();

    try {
      if (__DEV__) {
        console.log(`[SyncService] Starting sync - ${this.queue.length} operations pending`);
      }

      // Process queue in order, handling conflicts
      const operations = [...this.queue].filter(
        op => op.status === 'pending' || op.status === 'conflict'
      );

      for (const operation of operations) {
        try {
          await this.processOperation(operation);

          // Remove from queue on success
          this.queue = this.queue.filter(op => op.id !== operation.id);
          this.metrics.successfulSyncs++;
          this.totalSynced++;
          await this.saveQueue();
        } catch (error) {
          console.error(`[SyncService] Failed to process operation ${operation.id}:`, error);

          // Check if this is a conflict
          if (error instanceof SyncConflictError) {
            operation.status = 'conflict';
            this.handleConflict(operation, error);
          } else {
            // Update retry count and status
            operation.retryCount++;
            operation.lastAttempt = new Date().toISOString();

            if (operation.retryCount >= MAX_RETRY_ATTEMPTS) {
              operation.status = 'failed';
              operation.error = error instanceof Error ? error.message : 'Unknown error';
              this.metrics.failedSyncs++;
              this.lastSyncError = operation.error;
            }
          }

          await this.saveQueue();
        }
      }

      this.lastSyncTime = new Date().toISOString();
      this.metrics.lastSyncDuration = Date.now() - syncStartTime;

      // Update average sync time
      if (this.metrics.successfulSyncs > 0) {
        this.metrics.averageSyncTime =
          (this.metrics.averageSyncTime * (this.metrics.successfulSyncs - 1) +
            this.metrics.lastSyncDuration) /
          this.metrics.successfulSyncs;
      }

      // Clear queued since if queue is empty
      if (this.queue.length === 0) {
        this.metrics.queuedSince = null;
      }

      await this.saveMetrics();

      if (__DEV__) {
        console.log('[SyncService] Sync completed', {
          duration: this.metrics.lastSyncDuration,
          totalSynced: this.totalSynced,
          remaining: this.queue.length
        });
      }
    } catch (error) {
      console.error('[SyncService] Sync failed:', error);
      this.lastSyncError = error instanceof Error ? error.message : 'Unknown error';
    } finally {
      this.isSyncing = false;
      this.notifyListeners();
    }
  }

  /**
   * Process a single operation with exponential backoff and conflict resolution
   */
  private async processOperation(operation: QueuedOperation): Promise<void> {
    // Calculate backoff delay (no delay on first attempt)
    const delay = this.calculateBackoffDelay(operation.retryCount);

    if (delay > 0) {
      if (__DEV__) {
        console.log(
          `[SyncService] Backing off before retry: ${operation.id} (${delay}ms)`
        );
      }
      await this.sleep(delay);
    }

    operation.status = 'processing';
    if (__DEV__) {
      console.log(
        `[SyncService] Processing operation: ${operation.type} (attempt ${
          operation.retryCount + 1
        }/${MAX_RETRY_ATTEMPTS})`,
        { id: operation.id }
      );
    }

    try {
      switch (operation.type) {
        case 'CREATE_SESSION':
          await apiService.createSession(operation.payload);
          await database.updateSession(operation.payload.id, { sync_status: 'synced' });
          break;

        case 'END_SESSION':
          await apiService.endSession(operation.payload.sessionId, operation.payload.data);
          await database.updateSession(operation.payload.sessionId, { sync_status: 'synced' });
          break;

        case 'UPLOAD_FEATURES':
          await apiService.uploadFeatures(
            operation.payload.sessionId,
            operation.payload.features
          );
          // Update all features sync status
          for (const feature of operation.payload.features) {
            await database.updateAudioFeatureSyncStatus(feature.id, 'synced');
          }
          break;

        case 'CREATE_GOAL':
          await apiService.createGoal(operation.payload.userId, operation.payload.goal);
          await database.updateGoal(operation.payload.goal.id, { sync_status: 'synced' });
          break;

        case 'UPDATE_GOAL':
          // Fetch server version to detect conflicts
          const serverGoals = await apiService.getGoals(operation.payload.userId || operation.payload.goalId);
          const serverGoal = Array.isArray(serverGoals)
            ? serverGoals.find(g => g.id === operation.payload.goalId)
            : null;
          const clientGoal = operation.payload.updates;

          if (serverGoal && this.detectConflict(clientGoal, serverGoal)) {
            throw new SyncConflictError(
              `Conflict detected for goal ${operation.payload.goalId}`,
              clientGoal,
              serverGoal
            );
          }

          await apiService.updateGoal(operation.payload.goalId, operation.payload.updates);
          await database.updateGoal(operation.payload.goalId, {
            sync_status: 'synced',
            ...operation.payload.updates
          });
          break;

        case 'DELETE_GOAL':
          await apiService.deleteGoal(operation.payload.goalId);
          await database.deleteGoal(operation.payload.goalId);
          break;

        case 'UPDATE_USER_PROFILE':
          await apiService.updateUserProfile(
            operation.payload.userId,
            operation.payload.updates
          );
          break;

        default:
          throw new Error(`Unknown operation type: ${operation.type}`);
      }

      operation.status = 'completed';
    } catch (error) {
      // Re-throw to be caught by sync()
      throw error;
    }
  }

  /**
   * Detect conflict between client and server versions
   */
  private detectConflict(clientData: any, serverData: any): boolean {
    // If server data has been modified (check timestamps or version)
    if (serverData.updatedAt && clientData.updatedAt) {
      const serverTime = new Date(serverData.updatedAt).getTime();
      const clientTime = new Date(clientData.updatedAt).getTime();
      return serverTime > clientTime;
    }

    // Simple content comparison fallback
    return JSON.stringify(serverData) !== JSON.stringify(clientData);
  }

  /**
   * Handle sync conflict with server-wins strategy
   */
  private handleConflict(operation: QueuedOperation, error: SyncConflictError): void {
    const conflictId = this.generateId();
    const conflict: SyncConflict = {
      id: conflictId,
      operationId: operation.id,
      type: operation.type,
      clientData: error.clientData,
      serverData: error.serverData,
      timestamp: new Date().toISOString(),
      resolved: false,
      resolution: this.conflictStrategy === 'server-wins' ? 'server' : undefined
    };

    this.conflicts.set(conflictId, conflict);

    // Apply server-wins strategy by default
    if (this.conflictStrategy === 'server-wins') {
      if (__DEV__) {
        console.log(`[SyncService] Applying server-wins resolution for conflict: ${conflictId}`);
      }
      this.resolveConflict(conflictId, 'server').catch(error => {
        console.error(`[SyncService] Failed to resolve conflict: ${error}`);
      });
    } else {
      // Notify listeners about the conflict
      this.notifyConflictListeners(conflict);
    }

    this.metrics.resolvedConflicts++;
  }

  /**
   * Resolve a conflict manually
   */
  async resolveConflict(conflictId: string, resolution: 'server' | 'client'): Promise<void> {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) {
      throw new Error(`Conflict not found: ${conflictId}`);
    }

    if (__DEV__) {
      console.log(`[SyncService] Resolving conflict with ${resolution}-wins:`, conflictId);
    }

    try {
      const operation = this.queue.find(op => op.id === conflict.operationId);

      if (!operation) {
        throw new Error(`Operation not found for conflict: ${conflict.operationId}`);
      }

      if (resolution === 'server') {
        // Remove operation from queue (accept server version)
        this.queue = this.queue.filter(op => op.id !== operation.id);
      } else if (resolution === 'client') {
        // Retry operation
        operation.status = 'pending';
        operation.retryCount = 0;
      }

      conflict.resolved = true;
      conflict.resolution = resolution;

      await this.saveQueue();
      await this.saveConflicts();
      this.notifyListeners();

      if (__DEV__) {
        console.log(`[SyncService] Conflict resolved: ${conflictId} (${resolution}-wins)`);
      }
    } catch (error) {
      console.error(`[SyncService] Error resolving conflict:`, error);
      throw error;
    }
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateBackoffDelay(retryCount: number): number {
    if (retryCount === 0) return 0;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s
    const baseDelay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount - 1);

    // Add jitter (random 0-1000ms) to prevent thundering herd
    const jitter = Math.random() * 1000;

    // Cap at 60 seconds
    return Math.min(baseDelay + jitter, 60000);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Retry failed operations
   */
  async retryFailed(): Promise<void> {
    const failed = this.queue.filter(op => op.status === 'failed');

    if (__DEV__) {
      console.log(`[SyncService] Retrying ${failed.length} failed operations`);
    }

    // Reset failed operations to pending
    failed.forEach(op => {
      op.status = 'pending';
      op.retryCount = 0;
      op.error = undefined;
    });

    await this.saveQueue();

    // Attempt sync if online
    if (networkService.isOnline()) {
      await this.sync();
    }
  }

  /**
   * Clear completed operations
   */
  async clearCompleted(): Promise<void> {
    const completedCount = this.queue.filter(op => op.status === 'completed').length;
    this.queue = this.queue.filter(op => op.status !== 'completed');
    await this.saveQueue();

    if (__DEV__) {
      console.log(`[SyncService] Cleared ${completedCount} completed operations`);
    }
    this.notifyListeners();
  }

  /**
   * Clear the entire queue (use with caution)
   */
  async clearQueue(): Promise<void> {
    const count = this.queue.length;
    this.queue = [];
    this.metrics.queuedSince = null;

    await this.saveQueue();
    await this.saveMetrics();

    if (__DEV__) {
      console.log(`[SyncService] Cleared entire queue (${count} operations removed)`);
    }
    this.notifyListeners();
  }

  /**
   * Clear conflicts
   */
  async clearConflicts(): Promise<void> {
    const count = this.conflicts.size;
    this.conflicts.clear();
    await this.saveConflicts();

    if (__DEV__) {
      console.log(`[SyncService] Cleared ${count} conflicts`);
    }
  }

  /**
   * Get pending conflicts
   */
  getConflicts(): SyncConflict[] {
    return Array.from(this.conflicts.values()).filter(c => !c.resolved);
  }

  /**
   * Get sync metrics
   */
  getMetrics(): SyncMetrics {
    return { ...this.metrics };
  }

  /**
   * Get detailed sync status
   */
  getStatus(): SyncStatus {
    return {
      isSyncing: this.isSyncing,
      pendingOperations: this.queue.filter(op => op.status === 'pending').length,
      processingOperations: this.queue.filter(op => op.status === 'processing').length,
      failedOperations: this.queue.filter(op => op.status === 'failed').length,
      conflictOperations: this.queue.filter(op => op.status === 'conflict').length,
      lastSyncTime: this.lastSyncTime,
      lastSyncError: this.lastSyncError,
      networkStatus: networkService.getStatus(),
      totalSynced: this.totalSynced,
      queueSize: this.queue.length
    };
  }

  /**
   * Get queue of operations
   */
  getQueue(): QueuedOperation[] {
    return [...this.queue];
  }

  /**
   * Add status listener
   */
  addListener(listener: SyncStatusListener): () => void {
    this.listeners.add(listener);

    // Immediately notify with current status
    listener(this.getStatus());

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Add conflict listener
   */
  addConflictListener(listener: SyncConflictListener): () => void {
    this.conflictListeners.add(listener);

    // Notify with existing conflicts
    this.getConflicts().forEach(conflict => {
      listener(conflict);
    });

    // Return unsubscribe function
    return () => {
      this.conflictListeners.delete(listener);
    };
  }

  /**
   * Set conflict resolution strategy
   */
  setConflictStrategy(strategy: ConflictResolutionStrategy): void {
    this.conflictStrategy = strategy;
    if (__DEV__) {
      console.log(`[SyncService] Conflict strategy set to: ${strategy}`);
    }
  }

  /**
   * Get conflict resolution strategy
   */
  getConflictStrategy(): ConflictResolutionStrategy {
    return this.conflictStrategy;
  }

  /**
   * Notify all listeners of status changes
   */
  private notifyListeners(): void {
    const status = this.getStatus();
    this.listeners.forEach(listener => {
      try {
        listener(status);
      } catch (error) {
        console.error('[SyncService] Listener error:', error);
      }
    });
  }

  /**
   * Notify all listeners of conflicts
   */
  private notifyConflictListeners(conflict: SyncConflict): void {
    this.conflictListeners.forEach(listener => {
      try {
        listener(conflict);
      } catch (error) {
        console.error('[SyncService] Conflict listener error:', error);
      }
    });
  }

  /**
   * Cleanup and stop sync
   */
  cleanup(): void {
    this.stopAutoSync();
    this.listeners.clear();
    this.conflictListeners.clear();
    this.initialized = false;
    if (__DEV__) {
      console.log('[SyncService] Cleanup complete');
    }
  }
}

/**
 * Custom error for sync conflicts
 */
export class SyncConflictError extends Error {
  constructor(
    message: string,
    public clientData: any,
    public serverData: any
  ) {
    super(message);
    this.name = 'SyncConflictError';
  }
}

// Singleton instance
export const syncService = new SyncService();

/**
 * React Hook for sync status
 * Usage:
 * const {
 *   isSyncing,
 *   pendingOperations,
 *   lastSyncTime,
 *   networkStatus,
 *   totalSynced
 * } = useSyncStatus();
 */
export function useSyncStatus() {
  const [status, setStatus] = React.useState<SyncStatus>({
    isSyncing: false,
    pendingOperations: 0,
    processingOperations: 0,
    failedOperations: 0,
    conflictOperations: 0,
    lastSyncTime: null,
    lastSyncError: null,
    networkStatus: 'offline',
    totalSynced: 0,
    queueSize: 0
  });

  React.useEffect(() => {
    // Initialize if needed
    if (!syncService['initialized']) {
      syncService.initialize().catch(error => {
        console.error('[SyncStatus Hook] Failed to initialize sync service:', error);
      });
    }

    // Subscribe to changes
    const unsubscribe = syncService.addListener(setStatus);

    return unsubscribe;
  }, []);

  return status;
}

/**
 * React Hook for sync conflicts
 * Usage:
 * const conflicts = useSyncConflicts();
 */
export function useSyncConflicts() {
  const [conflicts, setConflicts] = React.useState<SyncConflict[]>([]);

  React.useEffect(() => {
    // Initialize if needed
    if (!syncService['initialized']) {
      syncService.initialize().catch(error => {
        console.error('[SyncConflicts Hook] Failed to initialize sync service:', error);
      });
    }

    // Set initial conflicts
    setConflicts(syncService.getConflicts());

    // Subscribe to conflict changes
    const unsubscribe = syncService.addConflictListener(() => {
      setConflicts(syncService.getConflicts());
    });

    return unsubscribe;
  }, []);

  return conflicts;
}

/**
 * React Hook for sync metrics
 * Usage:
 * const metrics = useSyncMetrics();
 */
export function useSyncMetrics() {
  const [metrics, setMetrics] = React.useState<SyncMetrics>(syncService.getMetrics());

  React.useEffect(() => {
    // Initialize if needed
    if (!syncService['initialized']) {
      syncService.initialize().catch(error => {
        console.error('[SyncMetrics Hook] Failed to initialize sync service:', error);
      });
    }

    // Update metrics on status changes
    const unsubscribe = syncService.addListener(() => {
      setMetrics(syncService.getMetrics());
    });

    return unsubscribe;
  }, []);

  return metrics;
}

// Import React for the hooks
import * as React from 'react';
