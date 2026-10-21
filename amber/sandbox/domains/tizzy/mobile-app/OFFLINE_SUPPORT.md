# Offline Support Infrastructure

This document describes the offline support infrastructure for the Tizzy mobile app.

## Overview

The app now supports full offline functionality with automatic synchronization when the device comes back online. All critical operations (sessions, goals, features) are queued locally and synced automatically.

## Architecture

### 1. Local Database (`/src/db/database.ts`)

SQLite database using `expo-sqlite` for local data persistence.

#### Tables:
- **sessions**: Practice sessions with sync status tracking
- **features**: Audio features linked to sessions
- **goals**: User goals with sync status
- **settings**: Key-value store for app settings
- **migrations**: Database version tracking

#### Key Features:
- Automatic migrations system
- Foreign key constraints
- Sync status tracking (pending/synced/failed)
- Retry attempt counting
- Indexing for performance

#### Usage:
```typescript
import { database } from './src/db/database';

// Initialize (call once at app startup)
await database.initialize();

// Create a session
await database.createSession({
  id: 'session-123',
  user_id: 'user-456',
  device_id: 'device-789',
  start_time: new Date().toISOString(),
  end_time: null,
  total_duration_seconds: 0,
  speaker_count_estimate: 0,
  environment_tag: 'office',
  consent_mode: 'full',
  conversation_count: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

// Get pending sessions
const pending = await database.getPendingSessions();

// Update sync status
await database.updateSession('session-123', { sync_status: 'synced' });
```

### 2. Network Service (`/src/services/NetworkService.ts`)

Monitors network connectivity and quality using `@react-native-community/netinfo`.

#### Features:
- Real-time network status monitoring
- Network quality assessment (excellent/good/fair/poor)
- Connection type detection (WiFi, cellular, etc.)
- Event-based notifications
- React hook for easy integration

#### Network Status:
- **online**: Good connection, all features available
- **offline**: No connection, offline mode active
- **poor**: Weak connection, limited features

#### Usage:
```typescript
import { networkService, useNetworkStatus } from './src/services/NetworkService';

// Initialize (call once at app startup)
await networkService.initialize();

// Check current status
const isOnline = networkService.isOnline();
const status = networkService.getStatus();
const quality = networkService.getQuality();

// Add listener
const unsubscribe = networkService.addListener((status, quality) => {
  console.log('Network status changed:', status, quality);
});

// Wait for online
await networkService.waitForOnline(5000); // 5 second timeout

// React Hook
function MyComponent() {
  const { status, isOnline, isPoor, quality } = useNetworkStatus();

  return (
    <Text>Status: {status}</Text>
  );
}
```

### 3. Sync Service (`/src/services/SyncService.ts`)

Manages offline operations queue and automatic synchronization.

#### Features:
- Operation queuing for offline mode
- Automatic sync when online
- Exponential backoff retry strategy
- Conflict resolution
- Persistent queue (survives app restarts)
- Auto-sync every 30 seconds when online
- React hook for sync status

#### Supported Operations:
- CREATE_SESSION
- END_SESSION
- UPLOAD_FEATURES
- CREATE_GOAL
- UPDATE_GOAL
- DELETE_GOAL
- UPDATE_USER_PROFILE

#### Retry Strategy:
- Max 5 retry attempts
- Exponential backoff: 1s → 2s → 4s → 8s → 16s (capped at 30s)
- Random jitter to prevent thundering herd

#### Usage:
```typescript
import { syncService, useSyncStatus } from './src/services/SyncService';

// Initialize (call once at app startup)
await syncService.initialize();

// Enqueue operation
const operationId = await syncService.enqueue('CREATE_SESSION', sessionData);

// Manual sync
await syncService.sync();

// Get status
const status = syncService.getStatus();
// {
//   isSyncing: false,
//   pendingOperations: 3,
//   lastSyncTime: '2026-02-13T10:30:00Z',
//   lastSyncError: null,
//   networkStatus: 'online'
// }

// Retry failed operations
await syncService.retryFailed();

// React Hook
function MyComponent() {
  const { isSyncing, pendingOperations, lastSyncTime, networkStatus } = useSyncStatus();

  return (
    <View>
      <Text>{isSyncing ? 'Syncing...' : 'Idle'}</Text>
      <Text>{pendingOperations} pending</Text>
    </View>
  );
}
```

### 4. Updated API Client (`/src/api/client.ts`)

Enhanced with offline support and automatic queueing.

#### Features:
- Network check before requests
- Automatic queueing when offline
- Retry logic for 5xx errors
- Graceful degradation

#### Changes:
- Request interceptor checks network before making requests
- Response interceptor retries 5xx errors (exponential backoff, max 3 retries)
- All write operations (create/update/delete) queue when offline
- Read operations throw errors when offline (can be cached separately)

#### Offline Behavior:
```typescript
// When offline, write operations are queued automatically
const session = await apiService.createSession(data);
// Returns mock response immediately, queues for sync

// When online, operations execute normally
const sessions = await apiService.getSessions(userId);
// Fetches from server
```

### 5. UI Components (`/src/shared/components/SyncStatusBanner.tsx`)

User-facing components to show sync status.

#### Components:

**SyncStatusBanner**
Full banner showing detailed sync status.

```typescript
import { SyncStatusBanner } from './src/shared/components';

<SyncStatusBanner
  detailed={true}
  position="top"
  onPress={() => console.log('Banner tapped')}
/>
```

**SyncIndicator**
Compact dot indicator for header/toolbar.

```typescript
import { SyncIndicator } from './src/shared/components';

<SyncIndicator />
```

## Integration Guide

### 1. App Initialization

Initialize all services at app startup:

```typescript
// In your App.tsx or root component
import { database } from './src/db/database';
import { networkService } from './src/services/NetworkService';
import { syncService } from './src/services/SyncService';

async function initializeApp() {
  try {
    // Initialize database
    await database.initialize();
    console.log('Database initialized');

    // Initialize network service
    await networkService.initialize();
    console.log('Network service initialized');

    // Initialize sync service
    await syncService.initialize();
    console.log('Sync service initialized');
  } catch (error) {
    console.error('Failed to initialize app:', error);
  }
}

export default function App() {
  React.useEffect(() => {
    initializeApp();
  }, []);

  return (
    <View>
      <SyncStatusBanner detailed position="top" />
      {/* Your app content */}
    </View>
  );
}
```

### 2. Using Offline-Capable API Calls

The API client automatically handles offline scenarios:

```typescript
import { apiService } from './src/api/client';

// Works offline - queues automatically
try {
  const session = await apiService.createSession({
    device_id: 'device-123',
    start_time: new Date().toISOString(),
    environment_tag: 'office',
    consent_mode: 'full',
  });
  console.log('Session created:', session.id);
} catch (error) {
  console.error('Failed to create session:', error);
}

// Also works offline
await apiService.endSession(sessionId, {
  end_time: new Date().toISOString(),
  total_duration_seconds: 300,
  speaker_count_estimate: 2,
});
```

### 3. Local Database Integration

For data that needs to be available offline:

```typescript
import { database } from './src/db/database';

// Save session locally
await database.createSession(sessionData);

// Retrieve local sessions
const sessions = await database.getSessions(userId);

// Get pending operations
const pending = await database.getPendingSessions();
```

### 4. Handling Sync Events

Listen to sync status changes:

```typescript
import { syncService } from './src/services/SyncService';

const unsubscribe = syncService.addListener((status) => {
  console.log('Sync status:', status);

  if (status.pendingOperations === 0) {
    console.log('All synced!');
  }

  if (status.lastSyncError) {
    console.error('Sync error:', status.lastSyncError);
  }
});

// Don't forget to unsubscribe
return () => unsubscribe();
```

## Best Practices

### 1. Optimistic Updates

When using the API, assume success and update UI immediately:

```typescript
// Optimistic update
const newGoal = {
  id: `temp-${Date.now()}`,
  title: 'New Goal',
  // ... other fields
};

// Update UI immediately
setGoals([...goals, newGoal]);

// Make API call (will queue if offline)
try {
  const savedGoal = await apiService.createGoal(userId, goalData);
  // Replace temp goal with real one
  setGoals(goals.map(g => g.id === newGoal.id ? savedGoal : g));
} catch (error) {
  // Revert on error
  setGoals(goals.filter(g => g.id !== newGoal.id));
}
```

### 2. Data Consistency

Always check sync status before showing data as "saved":

```typescript
const { pendingOperations } = useSyncStatus();

<Text>
  {pendingOperations > 0
    ? 'Saving changes...'
    : 'All changes saved'}
</Text>
```

### 3. Handle Network Transitions

React to network changes:

```typescript
const { isOnline } = useNetworkStatus();

useEffect(() => {
  if (isOnline) {
    // Refresh data when coming back online
    refetchData();
  }
}, [isOnline]);
```

### 4. User Communication

Always inform users about offline status:

```typescript
<SyncStatusBanner
  detailed={true}
  position="top"
  onPress={() => {
    // Show sync details modal
    navigation.navigate('SyncDetails');
  }}
/>
```

### 5. Testing Offline Scenarios

Test offline behavior:

```typescript
// Development helper
if (__DEV__) {
  // Simulate offline
  networkService['currentStatus'] = 'offline';

  // Trigger sync
  await syncService.sync();

  // Check queue
  const queue = syncService.getQueue();
  console.log('Queued operations:', queue);
}
```

## Migration Guide

If you have existing data that needs to be migrated:

### 1. Add New Migration

```typescript
// In database.ts, add to migrations array
{
  version: 2,
  up: async (db) => {
    await db.execAsync(`
      ALTER TABLE sessions ADD COLUMN new_field TEXT;
    `);
  },
  down: async (db) => {
    // Rollback logic
    await db.execAsync(`
      ALTER TABLE sessions DROP COLUMN new_field;
    `);
  }
}
```

### 2. Version Bumps

```typescript
// Update DB_VERSION constant
const DB_VERSION = 2;
```

## Troubleshooting

### Sync Not Working

1. Check network status: `networkService.getStatus()`
2. Check queue: `syncService.getQueue()`
3. Check for errors: `syncService.getStatus().lastSyncError`
4. Manually trigger sync: `await syncService.sync()`

### Database Errors

1. Check initialization: `database['initialized']`
2. Clear data (caution): `await database.clearAllData()`
3. Check migration version: Query `migrations` table

### Network Detection Issues

1. Refresh network state: `await networkService.refresh()`
2. Check permissions (if needed on Android)
3. Verify NetInfo installation

## Performance Considerations

1. **Batch Operations**: Queue related operations together
2. **Limit Queue Size**: Monitor `pendingOperations` count
3. **Database Indexes**: Already optimized for common queries
4. **Auto-Sync Interval**: 30 seconds (configurable in SyncService)
5. **Feature Upload Limit**: 100 features per batch (configurable in database.ts)

## Security Notes

1. Database is encrypted on device (iOS/Android)
2. Queue is stored in AsyncStorage (encrypted on iOS)
3. No sensitive data in sync queue payloads
4. Token validation before sync operations

## Dependencies

- `expo-sqlite`: ^14.0.0+ - Local SQLite database
- `@react-native-community/netinfo`: ^11.0.0+ - Network detection
- `@react-native-async-storage/async-storage`: ^2.0.0+ - Persistent queue storage
- `axios`: ^1.6.0+ - HTTP client

## Future Enhancements

- [ ] Conflict resolution strategies (last-write-wins, merge, user-choice)
- [ ] Selective sync (sync only certain data types)
- [ ] Background sync (using background tasks)
- [ ] Delta sync (only sync changes)
- [ ] Compression for large payloads
- [ ] Offline analytics
- [ ] Smart sync scheduling (WiFi-only option)
