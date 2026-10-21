# WebSocket Service - Real-Time Coaching Updates

A robust, production-ready WebSocket service for real-time coaching updates with automatic reconnection, offline message queuing, and seamless authentication integration.

## Overview

The WebSocket Service provides a complete solution for real-time bidirectional communication between the Tizzy mobile app and backend servers. It handles all the complexity of managing WebSocket connections, including reconnection strategies, message queuing for offline scenarios, and authentication token management.

### Key Features

- **Real-time Updates** - Three event types for coaching sessions:
  - `session_update` - Session progress, status changes
  - `coaching_moment` - Real-time coaching insights and moments
  - `insight_ready` - Analysis results and recommendations

- **Auto-Reconnection** - Exponential backoff strategy:
  - Up to 10 reconnection attempts
  - Starts at 1 second, doubles each attempt
  - Caps at 30 seconds max delay
  - Validates auth token before each attempt

- **Message Queuing** - Offline message support:
  - Queues up to 100 messages by default
  - Persists in memory (not stored to disk)
  - Retries messages 3 times before dropping
  - Automatically processes queue when reconnected

- **Heartbeat** - Keeps connection alive:
  - Sends ping every 30 seconds
  - Detects stale connections
  - Triggers reconnection if needed

- **Auth Integration** - Seamless token management:
  - Auto-retrieves token from AsyncStorage
  - Validates token expiration
  - Refreshes token on reconnection
  - Prevents connection with expired tokens

- **Event-Based Pattern** - Subscribe/unsubscribe model:
  - Multiple subscribers per event type
  - Unsubscribe functions returned
  - Error handling per callback
  - Connection state monitoring

## File Structure

```
/src/services/
├── WebSocketService.ts              # Main service implementation (750 lines)
├── WEBSOCKET_USAGE.md              # Complete usage guide
├── WEBSOCKET_INTEGRATION.tsx       # 8 real-world integration examples
└── WEBSOCKET_README.md             # This file
```

## Quick Start

### 1. Connect to WebSocket

```typescript
import { webSocketService } from '@/services';

// In your app initialization or component
await webSocketService.connect();

// Or with explicit token
const token = await AsyncStorage.getItem('auth_token');
await webSocketService.connect(token);
```

### 2. Subscribe to Events

```typescript
// Subscribe to session updates
const unsubscribe = webSocketService.subscribe('session_update', (data) => {
  console.log('Session updated:', data);
});

// Later: unsubscribe
unsubscribe();
```

### 3. Send Messages

```typescript
// Send a message to the server
await webSocketService.send({
  type: 'session_action',
  data: {
    action: 'pause',
    sessionId: 'abc123'
  }
});

// If offline, message is automatically queued
```

### 4. Monitor Connection

```typescript
const unsubscribeState = webSocketService.onStateChange((state) => {
  console.log('Connection state:', state);
});
```

## Architecture

### Service Architecture

```
WebSocketService
├── Connection Management
│   ├── establish/maintain WebSocket
│   ├── handle reconnection with backoff
│   └── token validation & refresh
├── Message Queue
│   ├── queue messages when offline
│   ├── retry failed messages
│   └── process queue on reconnection
├── Event Subscriptions
│   ├── session_update
│   ├── coaching_moment
│   ├── insight_ready
│   └── state_changed
└── Monitoring
    ├── connection state listeners
    ├── statistics tracking
    └── error handling
```

### State Flow

```
DISCONNECTED
    ↓
CONNECTING → CONNECTED → (heartbeat)
    ↓           ↑
    └── (error) ┘
        RECONNECTING
```

## Configuration

Default configuration (can be customized):

```typescript
{
  url: 'wss://api.tizzy.app/v1/ws',
  heartbeatInterval: 30000,           // 30 seconds
  messageQueueCapacity: 100,          // Max messages
  maxReconnectAttempts: 10,           // Max retries
  maxMessageRetries: 3,               // Per message retries
  enableMessageQueue: true,           // Offline support
  enableHeartbeat: true,              // Keep alive
}
```

To customize, create a new instance:

```typescript
import { WebSocketService } from '@/services';

const customWS = new WebSocketService({
  url: 'wss://custom.com/ws',
  maxReconnectAttempts: 5,
  heartbeatInterval: 60000,
});

await customWS.connect();
```

## Event Types

### `session_update`

Emitted when session status or progress changes:

```typescript
{
  sessionId: string;
  status: 'active' | 'paused' | 'completed';
  duration: number;         // seconds
  progress: number;         // 0-100%
  timestamp: number;
}
```

Example:
```typescript
webSocketService.subscribe('session_update', (data) => {
  console.log(`Session ${data.sessionId} is ${data.progress}% complete`);
});
```

### `coaching_moment`

Emitted when a coaching insight is delivered:

```typescript
{
  id: string;
  title: string;
  message: string;
  actionable: boolean;
  category: 'insight' | 'suggestion' | 'alert';
  timestamp: number;
}
```

Example:
```typescript
webSocketService.subscribe('coaching_moment', (data) => {
  // Show notification with coaching insight
  showNotification(data.title, data.message);
});
```

### `insight_ready`

Emitted when analysis completes:

```typescript
{
  insightId: string;
  category: string;
  confidence: number;       // 0-1
  recommendations: string[];
  timestamp: number;
}
```

Example:
```typescript
webSocketService.subscribe('insight_ready', (data) => {
  console.log(`New insight: ${data.category} (confidence: ${data.confidence})`);
  data.recommendations.forEach(rec => console.log(`- ${rec}`));
});
```

### `state_changed`

Emitted when connection state changes:

```typescript
{
  from: WebSocketState;
  to: WebSocketState;
}
```

## React Integration

### Hook Pattern

```typescript
import { useWebSocket } from '@/services';

function MyComponent() {
  const {
    state,              // Current WebSocketState
    stats,              // Connection statistics
    connect,            // () => Promise<void>
    disconnect,         // () => Promise<void>
    subscribe,          // (type, callback) => unsubscribe
    unsubscribe,        // (type, callback?) => void
    send,               // (message) => Promise<void>
    isConnected         // () => boolean
  } = useWebSocket();

  useEffect(() => {
    connect();
    return () => disconnect();
  }, []);

  // Use state, stats, etc.
}
```

### Provider Pattern

Wrap your app for automatic connection management:

```typescript
import { WebSocketAuthProvider } from '@/services';
import { AuthProvider } from '@/shared/contexts/AuthContext';

export default function App() {
  return (
    <AuthProvider>
      <WebSocketAuthProvider>
        {/* Your app */}
      </WebSocketAuthProvider>
    </AuthProvider>
  );
}
```

## Offline Support

### Automatic Message Queuing

Messages sent while offline are automatically queued:

```typescript
// App goes offline
await webSocketService.send({
  type: 'feedback',
  data: { rating: 5 }
});
// Message is queued

// App comes back online
// Message is automatically sent
```

### Queue Management

```typescript
// Check queue size
const size = webSocketService.getMessageQueueSize();

// Get queued messages
const messages = webSocketService.getQueuedMessages();
messages.forEach(msg => {
  console.log(`${msg.id}: ${msg.message.type} (retries: ${msg.retries})`);
});

// Clear queue manually
webSocketService.clearMessageQueue();
```

## Error Handling

### Connection Errors

```typescript
webSocketService.subscribe('error', (error) => {
  console.error('WebSocket error:', {
    message: error.message,
    code: error.code
  });

  // Handle specific errors
  switch (error.code) {
    case 'NO_AUTH_TOKEN':
      // Redirect to login
      break;
    case 'TOKEN_EXPIRED':
      // Request token refresh
      break;
    case 'MAX_RECONNECT_ATTEMPTS_REACHED':
      // Show offline message
      break;
  }
});
```

### Connection State Monitoring

```typescript
const unsubscribe = webSocketService.onStateChange((state) => {
  if (state === WebSocketState.CONNECTED) {
    console.log('Connection restored');
  } else if (state === WebSocketState.RECONNECTING) {
    console.log('Attempting to reconnect...');
  } else if (state === WebSocketState.DISCONNECTED) {
    console.log('Connection lost');
  }
});
```

## Statistics & Monitoring

### Get Connection Stats

```typescript
const stats = webSocketService.getStats();
console.log({
  state: stats.state,              // Current state
  isConnected: stats.isConnected,  // boolean
  reconnectAttempts: stats.reconnectAttempts,
  maxReconnectAttempts: stats.maxReconnectAttempts,
  messageQueueSize: stats.messageQueueSize
});
```

### Monitor Over Time

```typescript
setInterval(() => {
  const stats = webSocketService.getStats();
  console.log(`Queue: ${stats.messageQueueSize}, Attempts: ${stats.reconnectAttempts}`);
}, 5000);
```

## Integration with Auth

### Automatic Auth Integration

Token is automatically managed:

```typescript
// Token is retrieved from AsyncStorage on connect()
await webSocketService.connect();

// Token is validated before reconnection
// Expired tokens prevent connection

// Token is refreshed on app resume
// (via AuthContext.useEffect)
```

### Manual Auth Integration

```typescript
import { useAuthContext } from '@/shared/contexts/AuthContext';
import { useWebSocket } from '@/services';

function AuthIntegration() {
  const { isAuthenticated } = useAuthContext();
  const { connect, disconnect, isConnected } = useWebSocket();

  useEffect(() => {
    if (isAuthenticated && !isConnected()) {
      connect();
    } else if (!isAuthenticated) {
      disconnect();
    }
  }, [isAuthenticated]);
}
```

## Performance Considerations

### Message Queue Size

- Default capacity: 100 messages
- Each message ~500 bytes ≈ 50KB overhead
- Adjust based on app memory constraints:

```typescript
const customWS = new WebSocketService({
  url: 'wss://api.tizzy.app/v1/ws',
  messageQueueCapacity: 50,  // Smaller for low-memory devices
});
```

### Heartbeat Tuning

- Default: 30 seconds
- Adjust based on server timeout
- Disable for battery efficiency (trade-off: may lose connection)

### Reconnection Strategy

- Exponential backoff prevents server overwhelming
- 10 attempts covers ~17 minutes of downtime
- Adjust for your use case:

```typescript
const customWS = new WebSocketService({
  url: 'wss://api.tizzy.app/v1/ws',
  maxReconnectAttempts: 20,  // More aggressive
});
```

## Cleanup & Lifecycle

### Component Level

```typescript
useEffect(() => {
  const unsubscribe = webSocketService.subscribe('session_update', handler);

  return unsubscribe;  // Unsubscribe on unmount
}, []);
```

### App Level

```typescript
// On logout
await webSocketService.disconnect();

// On app destroy
webSocketService.destroy();  // Clears all subscriptions
```

## Testing

### Mock WebSocket

```typescript
// In your test setup
jest.mock('@/services', () => ({
  webSocketService: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    subscribe: jest.fn(),
    send: jest.fn(),
    getStats: jest.fn(() => ({
      state: 'CONNECTED',
      isConnected: true,
      messageQueueSize: 0
    }))
  }
}));
```

### Test Connection

```typescript
test('connects on mount', async () => {
  const { connect } = useWebSocket();

  await connect();

  expect(connect).toHaveBeenCalled();
});
```

## Troubleshooting

### Connection Fails

```typescript
// 1. Check token
const token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
console.log('Has token:', !!token);

// 2. Check if expired
console.log('Token expired:', isTokenExpired(token));

// 3. Check URL
console.log('WS URL:', process.env.EXPO_PUBLIC_WS_URL);

// 4. Check state
const state = webSocketService.getState();
console.log('Current state:', state);
```

### Messages Not Received

```typescript
// 1. Check subscription
const stats = webSocketService.getStats();
console.log('Connected:', stats.isConnected);

// 2. Check connection state
webSocketService.onStateChange(state => {
  console.log('State changed:', state);
});

// 3. Check message format
await webSocketService.send({
  type: 'valid_type',  // Check backend for valid types
  data: { /* ... */ }
});
```

### Queue Growing

```typescript
// Monitor queue
setInterval(() => {
  const size = webSocketService.getMessageQueueSize();
  if (size > 50) {
    console.warn('Large queue:', size);
  }
}, 5000);

// Clear if necessary
webSocketService.clearMessageQueue();
```

## Examples

See `WEBSOCKET_INTEGRATION.tsx` for 8 complete examples:

1. **BasicWebSocketExample** - Simple connection
2. **RealTimeSessionUpdates** - Session progress updates
3. **CoachingMomentsListener** - Coaching insights
4. **InsightListener** - Analytics with insights
5. **OfflineQueueMonitor** - Queue management
6. **ConnectionStateMonitor** - State monitoring
7. **WebSocketAuthProvider** - Auth integration
8. **CompleteCoachinSession** - Full session component

## API Reference

### WebSocketService Class

```typescript
// Constructor
new WebSocketService(config: WebSocketConfig)

// Connection
connect(token?: string): Promise<void>
disconnect(): Promise<void>

// Messages
send(message: WebSocketMessage): Promise<void>

// Subscriptions
subscribe(eventType: string, callback: SubscriptionCallback): () => void
unsubscribe(eventType: string, callback?: SubscriptionCallback): void

// State
getState(): WebSocketState
isConnected(): boolean
onStateChange(listener: ConnectionStateListener): () => void

// Queue
getMessageQueueSize(): number
getQueuedMessages(): QueuedMessage[]
clearMessageQueue(): void

// Info
getStats(): WebSocketStats

// Cleanup
destroy(): void
```

### React Hook

```typescript
useWebSocket(): {
  state: WebSocketState;
  stats: WebSocketStats;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  subscribe: (eventType: string, callback: SubscriptionCallback) => () => void;
  unsubscribe: (eventType: string, callback?: SubscriptionCallback) => void;
  send: (message: WebSocketMessage) => Promise<void>;
  isConnected: () => boolean;
}
```

## Related Files

- **AuthContext** - `/src/shared/contexts/AuthContext.tsx`
- **NetworkService** - `/src/services/NetworkService.ts`
- **API Client** - `/src/api/client.ts`
- **Constants** - `/src/shared/constants.ts`
- **Token Utils** - `/src/shared/utils/tokenUtils.ts`

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review `WEBSOCKET_USAGE.md` for detailed examples
3. Examine `WEBSOCKET_INTEGRATION.tsx` for real-world patterns
4. Check console logs (service logs all state changes)

## Version Info

- **Created**: 2026-02-13
- **TypeScript**: Fully typed
- **React Native**: Compatible with Expo
- **Dependencies**:
  - React Native AsyncStorage
  - Native WebSocket API
  - React (for hooks)

## License

Part of the Tizzy Mobile App
