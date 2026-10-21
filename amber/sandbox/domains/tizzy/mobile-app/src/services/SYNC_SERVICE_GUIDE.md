# SyncService Documentation

A robust offline-first synchronization service for managing offline operations with automatic conflict resolution.

## Features

- **Offline Operation Queue**: Queue operations when offline, automatically sync when online
- **Exponential Backoff Retry**: Failed operations retry with exponential backoff and jitter
- **Conflict Resolution**: Detects and resolves conflicts (server-wins strategy by default)
- **NetworkService Integration**: Automatically responds to network status changes
- **Database Integration**: Maintains sync status in local database
- **Real-time Status Tracking**: Observable sync state via listeners and React hooks
- **Priority Queue**: Operations can be prioritized for sync order
- **Metrics Tracking**: Detailed metrics on sync operations and performance
- **Persistent Storage**: Queue and conflicts persisted to AsyncStorage

## Core Concepts

### Operation Types

The following operations can be queued:
- `CREATE_SESSION`
- `END_SESSION`
- `UPLOAD_FEATURES`
- `CREATE_GOAL`
- `UPDATE_GOAL`
- `DELETE_GOAL`
- `UPDATE_USER_PROFILE`

### Operation Status

- `pending`: Waiting to be synced
- `processing`: Currently being synced
- `completed`: Successfully synced
- `failed`: Failed after max retries
- `conflict`: Detected server conflict

### Conflict Resolution Strategies

- `server-wins`: Server data overwrites client (default)
- `client-wins`: Client data overwrites server
- `manual`: Requires manual resolution

## API Reference

### Initialization

```typescript
import { syncService } from '@/services';

// Initialize once at app startup
await syncService.initialize();
```

### Queue an Operation

```typescript
// Basic queue
const opId = await syncService.queueOperation(
  'CREATE_GOAL',
  { userId: '123', goal: { title: 'Learn TypeScript' } }
);

// With priority (higher priority syncs first)
const opId = await syncService.queueOperation(
  'UPDATE_USER_PROFILE',
  { userId: '123', updates: { name: 'John' } },
  priority = 10
);

// With metadata
const opId = await syncService.queueOperation(
  'UPLOAD_FEATURES',
  { sessionId: 'abc', features: [...] },
  priority = 5,
  metadata = { userId: '123', batch: 'session-001' }
);
```

### Manual Sync

```typescript
// Force sync immediately
await syncService.sync();
```

### Queue Management

```typescript
// Get queue status
const status = syncService.getStatus();
console.log(`Pending: ${status.pendingOperations}`);
console.log(`Syncing: ${status.isSyncing}`);
console.log(`Network: ${status.networkStatus}`);

// Get full queue
const queue = syncService.getQueue();

// Get metrics
const metrics = syncService.getMetrics();
console.log(`Total synced: ${metrics.totalOperations}`);
console.log(`Successful: ${metrics.successfulSyncs}`);

// Retry failed operations
await syncService.retryFailed();

// Clear completed operations
await syncService.clearCompleted();

// Clear entire queue
await syncService.clearQueue();
```

### Conflict Management

```typescript
// Get pending conflicts
const conflicts = syncService.getConflicts();

// Resolve a conflict
await syncService.resolveConflict(conflictId, 'server'); // or 'client'

// Set conflict strategy
syncService.setConflictStrategy('server-wins');

// Get current strategy
const strategy = syncService.getConflictStrategy();

// Clear conflicts
await syncService.clearConflicts();
```

## React Hooks

### useSyncStatus

Monitor sync status changes in real-time:

```typescript
import { useSyncStatus } from '@/services';

function SyncMonitor() {
  const {
    isSyncing,
    pendingOperations,
    failedOperations,
    conflictOperations,
    lastSyncTime,
    lastSyncError,
    networkStatus,
    totalSynced,
    queueSize
  } = useSyncStatus();

  return (
    <View>
      <Text>Syncing: {isSyncing ? 'Yes' : 'No'}</Text>
      <Text>Pending: {pendingOperations}</Text>
      <Text>Network: {networkStatus}</Text>
      <Text>Total Synced: {totalSynced}</Text>
      {lastSyncError && <Text>Error: {lastSyncError}</Text>}
    </View>
  );
}
```

### useSyncConflicts

Handle sync conflicts:

```typescript
import { useSyncConflicts, syncService } from '@/services';

function ConflictResolver() {
  const conflicts = useSyncConflicts();

  const handleResolve = async (conflictId: string, resolution: 'server' | 'client') => {
    await syncService.resolveConflict(conflictId, resolution);
  };

  return (
    <View>
      {conflicts.map(conflict => (
        <View key={conflict.id}>
          <Text>Conflict: {conflict.type}</Text>
          <Button
            title="Accept Server"
            onPress={() => handleResolve(conflict.id, 'server')}
          />
          <Button
            title="Accept Client"
            onPress={() => handleResolve(conflict.id, 'client')}
          />
        </View>
      ))}
    </View>
  );
}
```

### useSyncMetrics

Track sync metrics:

```typescript
import { useSyncMetrics } from '@/services';

function SyncMetricsDisplay() {
  const metrics = useSyncMetrics();

  return (
    <View>
      <Text>Total Operations: {metrics.totalOperations}</Text>
      <Text>Successful: {metrics.successfulSyncs}</Text>
      <Text>Failed: {metrics.failedSyncs}</Text>
      <Text>Avg Sync Time: {metrics.averageSyncTime.toFixed(0)}ms</Text>
      <Text>Last Sync: {metrics.lastSyncDuration}ms</Text>
      <Text>Queued Since: {metrics.queuedSince}</Text>
    </View>
  );
}
```

## Usage Examples

### Example 1: Queue a Goal Creation

```typescript
import { syncService } from '@/services';

async function createGoal(userId: string, goal: Goal) {
  try {
    // Create locally first
    const localGoal = await database.createGoal(goal);

    // Queue for sync with high priority
    await syncService.queueOperation(
      'CREATE_GOAL',
      {
        userId,
        goal: {
          ...localGoal,
          id: localGoal.id
        }
      },
      priority = 10,
      metadata = { userId, entityId: localGoal.id }
    );

    return localGoal;
  } catch (error) {
    console.error('Failed to create goal:', error);
    throw error;
  }
}
```

### Example 2: Handle Offline Operations

```typescript
import { useSyncStatus, syncService } from '@/services';

function OfflineIndicator() {
  const { networkStatus, pendingOperations, isSyncing } = useSyncStatus();

  if (networkStatus === 'offline') {
    return (
      <View>
        <Text>You are offline</Text>
        <Text>Pending operations: {pendingOperations}</Text>
        {pendingOperations > 0 && (
          <Text>Will sync when back online</Text>
        )}
      </View>
    );
  }

  if (isSyncing) {
    return <Text>Syncing {pendingOperations} operations...</Text>;
  }

  return <Text>Online and synced</Text>;
}
```

### Example 3: Retry Failed Operations

```typescript
import { syncService } from '@/services';

async function handleRetryFailedOperations() {
  try {
    const status = syncService.getStatus();
    if (status.failedOperations > 0) {
      console.log(`Retrying ${status.failedOperations} failed operations...`);
      await syncService.retryFailed();
    }
  } catch (error) {
    console.error('Retry failed:', error);
  }
}
```

### Example 4: Conflict Resolution

```typescript
import { useSyncConflicts, syncService } from '@/services';

function ConflictHandler() {
  const conflicts = useSyncConflicts();

  // Set strategy to manual for user confirmation
  React.useEffect(() => {
    syncService.setConflictStrategy('manual');
  }, []);

  const resolveAllAsServer = async () => {
    for (const conflict of conflicts) {
      await syncService.resolveConflict(conflict.id, 'server');
    }
  };

  return (
    <View>
      {conflicts.length > 0 && (
        <>
          <Text>You have {conflicts.length} conflicts to resolve</Text>
          <Button
            title="Accept All Server Versions"
            onPress={resolveAllAsServer}
          />
        </>
      )}
    </View>
  );
}
```

## Network Integration

The SyncService automatically:

1. **Listens to network changes** via NetworkService
2. **Starts auto-sync** when network comes online
3. **Stops auto-sync** when network goes offline
4. **Syncs immediately** when operations are queued and online
5. **Respects network quality** (will still queue on poor connections)

```typescript
import { useNetworkStatus } from '@/services';

function AutoSyncExample() {
  const { networkStatus } = useNetworkStatus();

  // No manual action needed - SyncService handles it
  return <Text>Network: {networkStatus}</Text>;
}
```

## Performance Considerations

### Exponential Backoff

Retries use exponential backoff with jitter:
- Attempt 1: 0ms (no delay)
- Attempt 2: 1s + jitter
- Attempt 3: 2s + jitter
- Attempt 4: 4s + jitter
- Attempt 5: 8s + jitter
- Maximum: 60 seconds

### Queue Size Limits

- Maximum queue size: 1000 operations
- Oldest operations are preserved
- Queue is persisted to AsyncStorage

### Memory Management

- Queue is loaded on initialization
- Operations sorted by priority and timestamp
- Completed operations can be cleared
- Conflicts are stored separately for manual review

## Error Handling

```typescript
import { syncService, SyncConflictError } from '@/services';

async function robustSync() {
  try {
    await syncService.sync();
  } catch (error) {
    if (error instanceof SyncConflictError) {
      console.log('Conflict detected:', {
        client: error.clientData,
        server: error.serverData
      });
      // Handle conflict
    } else {
      console.error('Sync failed:', error);
      // Handle other errors
    }
  }
}
```

## Cleanup

Always cleanup on app termination:

```typescript
import { syncService } from '@/services';

// On app cleanup
useEffect(() => {
  return () => {
    syncService.cleanup();
  };
}, []);
```

## Testing

```typescript
import { syncService } from '@/services';

// Mock network offline
networkService.mockStatus('offline');

// Queue operation
await syncService.queueOperation('CREATE_GOAL', {...});

// Verify queued
expect(syncService.getQueue()).toHaveLength(1);

// Go back online
networkService.mockStatus('online');

// Verify auto-sync occurred
await new Promise(resolve => setTimeout(resolve, 100));
expect(syncService.getQueue()).toHaveLength(0);
```
