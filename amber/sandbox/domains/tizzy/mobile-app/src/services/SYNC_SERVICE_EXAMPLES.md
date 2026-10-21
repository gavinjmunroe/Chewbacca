# SyncService Code Examples

## Quick Start

### Initialize on App Startup

```typescript
import { syncService } from '@/services';

// In your app's main component or root context
useEffect(() => {
  const initSync = async () => {
    try {
      await syncService.initialize();
      console.log('Sync service initialized');
    } catch (error) {
      console.error('Failed to initialize sync service:', error);
    }
  };

  initSync();

  return () => syncService.cleanup();
}, []);
```

## Queue Operations

### Queue a Create Operation

```typescript
async function createGoal(userId: string, goalData: any) {
  // Create locally first
  const localGoal = await database.createGoal(goalData);

  // Queue for sync
  const operationId = await syncService.queueOperation(
    'CREATE_GOAL',
    {
      userId,
      goal: localGoal
    },
    priority = 10, // High priority
    metadata = {
      userId,
      entityId: localGoal.id,
      batch: 'goals-batch-001'
    }
  );

  console.log(`Goal queued with operation ID: ${operationId}`);
  return localGoal;
}
```

### Queue an Update Operation

```typescript
async function updateGoal(goalId: string, updates: any) {
  // Update locally
  await database.updateGoal(goalId, updates);

  // Queue for sync
  const operationId = await syncService.queueOperation(
    'UPDATE_GOAL',
    {
      goalId,
      updates
    },
    priority = 5
  );

  return operationId;
}
```

### Queue with Legacy Method

```typescript
// Backwards compatible
const opId = await syncService.enqueue(
  'CREATE_SESSION',
  { sessionData }
);
```

## Monitor Sync Status

### Use the Hook

```typescript
import { useSyncStatus } from '@/services';

function SyncStatusBar() {
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
      <Text>Network: {networkStatus}</Text>
      {isSyncing ? (
        <View>
          <Text>Syncing...</Text>
          <ProgressBar
            progress={totalSynced}
            total={totalSynced + pendingOperations}
          />
        </View>
      ) : (
        <Text>Synced {totalSynced} operations</Text>
      )}
      {pendingOperations > 0 && (
        <Text>
          {pendingOperations} pending
          {networkStatus === 'offline' && ' (queued for later)'}
        </Text>
      )}
      {failedOperations > 0 && (
        <Button
          title={`Retry ${failedOperations} failed`}
          onPress={handleRetryFailed}
        />
      )}
      {lastSyncError && (
        <Text style={{ color: 'red' }}>{lastSyncError}</Text>
      )}
    </View>
  );
}

async function handleRetryFailed() {
  await syncService.retryFailed();
}
```

### Manual Status Check

```typescript
function checkSyncStatus() {
  const status = syncService.getStatus();

  console.log('Sync Status:', {
    syncing: status.isSyncing,
    pending: status.pendingOperations,
    failed: status.failedOperations,
    network: status.networkStatus,
    lastSync: status.lastSyncTime,
    queueSize: status.queueSize
  });

  return status;
}
```

## Handle Conflicts

### Monitor Conflicts with Hook

```typescript
import { useSyncConflicts, syncService } from '@/services';

function ConflictUI() {
  const conflicts = useSyncConflicts();

  const handleResolve = async (
    conflictId: string,
    resolution: 'server' | 'client'
  ) => {
    try {
      await syncService.resolveConflict(conflictId, resolution);
      console.log(`Conflict ${conflictId} resolved with ${resolution}-wins`);
    } catch (error) {
      console.error('Failed to resolve conflict:', error);
    }
  };

  if (conflicts.length === 0) {
    return <Text>No conflicts</Text>;
  }

  return (
    <ScrollView>
      {conflicts.map(conflict => (
        <View key={conflict.id} style={styles.conflictCard}>
          <Text style={styles.title}>
            Conflict: {conflict.type}
          </Text>
          <View style={styles.dataSection}>
            <Text style={styles.label}>Server Version:</Text>
            <Text>{JSON.stringify(conflict.serverData, null, 2)}</Text>
          </View>
          <View style={styles.dataSection}>
            <Text style={styles.label}>Your Version:</Text>
            <Text>{JSON.stringify(conflict.clientData, null, 2)}</Text>
          </View>
          <View style={styles.buttonRow}>
            <Button
              title="Accept Server"
              onPress={() => handleResolve(conflict.id, 'server')}
            />
            <Button
              title="Keep Mine"
              onPress={() => handleResolve(conflict.id, 'client')}
            />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
```

### Configure Conflict Strategy

```typescript
function setupConflictHandling() {
  // Set to server-wins (automatic resolution)
  syncService.setConflictStrategy('server-wins');

  // Or set to manual (requires user input)
  syncService.setConflictStrategy('manual');

  // Check current strategy
  const strategy = syncService.getConflictStrategy();
  console.log(`Conflict strategy: ${strategy}`);
}
```

### Listen to Conflicts Directly

```typescript
function setupConflictListener() {
  const unsubscribe = syncService.addConflictListener(conflict => {
    console.log('New conflict detected:', {
      id: conflict.id,
      type: conflict.type,
      clientData: conflict.clientData,
      serverData: conflict.serverData
    });

    // Send notification to user
    showNotification(
      'Sync Conflict',
      `A conflict was detected in ${conflict.type}`
    );
  });

  // Cleanup
  return () => unsubscribe();
}
```

## Monitor Metrics

### Use the Metrics Hook

```typescript
import { useSyncMetrics } from '@/services';

function SyncMetricsScreen() {
  const metrics = useSyncMetrics();

  return (
    <ScrollView style={styles.container}>
      <Section title="Operations">
        <Metric
          label="Total Queued"
          value={metrics.totalOperations}
        />
        <Metric
          label="Successfully Synced"
          value={metrics.successfulSyncs}
        />
        <Metric
          label="Failed"
          value={metrics.failedSyncs}
        />
        <Metric
          label="Success Rate"
          value={`${calculateSuccessRate(metrics)}%`}
        />
      </Section>

      <Section title="Performance">
        <Metric
          label="Last Sync Time"
          value={`${metrics.lastSyncDuration}ms`}
        />
        <Metric
          label="Average Sync Time"
          value={`${metrics.averageSyncTime.toFixed(0)}ms`}
        />
      </Section>

      <Section title="Conflicts">
        <Metric
          label="Resolved"
          value={metrics.resolvedConflicts}
        />
      </Section>

      {metrics.queuedSince && (
        <Section title="Queue Timing">
          <Metric
            label="Queued Since"
            value={new Date(metrics.queuedSince).toLocaleString()}
          />
        </Section>
      )}
    </ScrollView>
  );
}

function calculateSuccessRate(metrics: SyncMetrics): number {
  if (metrics.totalOperations === 0) return 0;
  return Math.round(
    (metrics.successfulSyncs / metrics.totalOperations) * 100
  );
}
```

## Listen to Status Changes

### Add Status Listener

```typescript
function setupStatusListener() {
  const unsubscribe = syncService.addListener(status => {
    if (status.isSyncing) {
      console.log('Sync started');
    }

    if (!status.isSyncing && status.pendingOperations === 0) {
      console.log('All operations synced!');
      showNotification('Sync Complete', 'All changes saved to server');
    }

    if (status.lastSyncError) {
      console.error('Sync error:', status.lastSyncError);
      showNotification('Sync Failed', status.lastSyncError);
    }
  });

  // Return cleanup function
  return unsubscribe;
}
```

## Queue Management

### View Queue

```typescript
function viewQueue() {
  const queue = syncService.getQueue();

  console.log('Current Queue:');
  queue.forEach((op, index) => {
    console.log(`${index + 1}. ${op.type}`, {
      id: op.id,
      status: op.status,
      priority: op.priority,
      retries: op.retryCount,
      timestamp: op.timestamp,
      metadata: op.metadata
    });
  });

  return queue;
}
```

### Clear Operations

```typescript
async function manageQueue() {
  // Clear only completed operations
  await syncService.clearCompleted();

  // Clear all queued operations (use with caution!)
  if (confirm('Clear all pending operations?')) {
    await syncService.clearQueue();
  }

  // Clear conflicts
  await syncService.clearConflicts();
}
```

## Retry Failed Operations

### Manual Retry

```typescript
async function handleSyncFailures() {
  const status = syncService.getStatus();

  if (status.failedOperations > 0) {
    const confirmed = confirm(
      `Retry ${status.failedOperations} failed operations?`
    );

    if (confirmed) {
      console.log('Retrying failed operations...');
      await syncService.retryFailed();
    }
  }
}
```

### Auto-Retry on Network Recovery

```typescript
import { useNetworkStatus } from '@/services';

function AutoRetryOnOnline() {
  const { isOnline } = useNetworkStatus();
  const previousStatus = useRef(false);

  useEffect(() => {
    if (isOnline && !previousStatus.current) {
      // Just came back online
      console.log('Network restored, retrying failed operations...');
      syncService.retryFailed().catch(console.error);
    }
    previousStatus.current = isOnline;
  }, [isOnline]);

  return null;
}
```

## Complete Example: Offline-First Goal App

```typescript
import React, { useEffect } from 'react';
import { View, Text, Button, ScrollView } from 'react-native';
import {
  syncService,
  useSyncStatus,
  useSyncConflicts,
  useNetworkStatus
} from '@/services';

export function GoalScreen() {
  const syncStatus = useSyncStatus();
  const conflicts = useSyncConflicts();
  const networkStatus = useNetworkStatus();

  useEffect(() => {
    syncService.initialize();
  }, []);

  const createGoal = async (goalName: string) => {
    try {
      await syncService.queueOperation(
        'CREATE_GOAL',
        {
          userId: 'current-user-id',
          goal: {
            id: generateId(),
            title: goalName,
            createdAt: new Date().toISOString()
          }
        },
        priority = 10
      );
    } catch (error) {
      console.error('Failed to create goal:', error);
    }
  };

  const updateGoal = async (goalId: string, updates: any) => {
    try {
      await syncService.queueOperation(
        'UPDATE_GOAL',
        { goalId, updates },
        priority = 5
      );
    } catch (error) {
      console.error('Failed to update goal:', error);
    }
  };

  return (
    <ScrollView>
      {/* Network Status Bar */}
      <View style={{
        padding: 10,
        backgroundColor: networkStatus.isOnline ? '#4CAF50' : '#FF9800'
      }}>
        <Text style={{ color: 'white' }}>
          {networkStatus.isOnline ? 'Online' : 'Offline'}
          {syncStatus.pendingOperations > 0 &&
            ` - ${syncStatus.pendingOperations} pending`}
        </Text>
      </View>

      {/* Sync Progress */}
      {syncStatus.isSyncing && (
        <View style={{ padding: 10, backgroundColor: '#E3F2FD' }}>
          <Text>Syncing {syncStatus.pendingOperations} operations...</Text>
        </View>
      )}

      {/* Conflicts Alert */}
      {conflicts.length > 0 && (
        <View style={{ padding: 10, backgroundColor: '#FFE0B2' }}>
          <Text>You have {conflicts.length} conflicts to resolve</Text>
          <Button
            title="Review Conflicts"
            onPress={() => navigation.navigate('Conflicts')}
          />
        </View>
      )}

      {/* Goals List */}
      <View style={{ padding: 10 }}>
        <Button
          title="+ Create Goal"
          onPress={() => createGoal('New Goal')}
        />
      </View>

      {/* Sync Metrics */}
      <View style={{ padding: 10, borderTopWidth: 1 }}>
        <Text>Synced: {syncStatus.totalSynced}</Text>
        <Text>Failed: {syncStatus.failedOperations}</Text>
        {syncStatus.failedOperations > 0 && (
          <Button
            title="Retry Failed"
            onPress={() => syncService.retryFailed()}
          />
        )}
      </View>
    </ScrollView>
  );
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
```

## Error Handling

```typescript
import { syncService, SyncConflictError } from '@/services';

async function safeSyncOperation() {
  try {
    // Queue operation
    const opId = await syncService.queueOperation(
      'UPDATE_GOAL',
      { goalId: '123', updates: { title: 'Updated' } }
    );

    // Manual sync
    await syncService.sync();
  } catch (error) {
    if (error instanceof SyncConflictError) {
      console.log('Conflict detected:', {
        client: error.clientData,
        server: error.serverData
      });
      // Handle conflict - maybe show UI
    } else if (error.message.includes('Queue is full')) {
      console.error('Too many pending operations');
      // Ask user to wait or clear some
    } else {
      console.error('Sync error:', error);
    }
  }
}
```
