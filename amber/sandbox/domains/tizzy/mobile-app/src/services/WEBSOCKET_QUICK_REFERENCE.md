# WebSocket Service - Quick Reference Card

## Installation & Setup

```typescript
// Already exported in services/index.ts
import {
  webSocketService,
  WebSocketService,
  useWebSocket,
  WebSocketState
} from '@/services';
```

## Connect & Disconnect

```typescript
// Connect (auto-retrieves token from AsyncStorage)
await webSocketService.connect();

// Connect with explicit token
await webSocketService.connect(token);

// Disconnect
await webSocketService.disconnect();

// Destroy (clear all subscriptions)
webSocketService.destroy();
```

## Subscribe to Events

```typescript
// Subscribe to session updates
const unsubSession = webSocketService.subscribe('session_update', (data) => {
  console.log('Session:', data.sessionId, data.progress);
});

// Subscribe to coaching moments
const unsubCoaching = webSocketService.subscribe('coaching_moment', (data) => {
  console.log('Coaching:', data.title, data.message);
});

// Subscribe to insights
const unsubInsights = webSocketService.subscribe('insight_ready', (data) => {
  console.log('Insight:', data.category, data.confidence);
});

// Subscribe to errors
const unsubError = webSocketService.subscribe('error', (error) => {
  console.error('Error:', error.code, error.message);
});

// Unsubscribe
unsubSession();
unsubCoaching();
unsubInsights();
unsubError();

// Unsubscribe all from event type
webSocketService.unsubscribe('session_update');
```

## Send Messages

```typescript
// Send simple message
await webSocketService.send({
  type: 'user_feedback',
  data: { rating: 5 }
});

// Send with session context
await webSocketService.send({
  type: 'session_action',
  data: {
    action: 'pause',
    sessionId: 'abc123'
  }
});

// Send with metadata
await webSocketService.send({
  type: 'coaching_feedback',
  data: { momentId: 'xyz', understood: true },
  timestamp: Date.now(),
  sessionId: 'abc123'
});
```

## Monitor Connection State

```typescript
// Get current state
const state = webSocketService.getState();
console.log(state); // WebSocketState: DISCONNECTED | CONNECTING | CONNECTED | RECONNECTING

// Check if connected
const connected = webSocketService.isConnected();

// Listen to state changes
const unsubscribe = webSocketService.onStateChange((state) => {
  console.log('New state:', state);
});

// Get statistics
const stats = webSocketService.getStats();
console.log({
  state: stats.state,
  isConnected: stats.isConnected,
  reconnectAttempts: stats.reconnectAttempts,
  maxReconnectAttempts: stats.maxReconnectAttempts,
  messageQueueSize: stats.messageQueueSize
});
```

## Offline Message Queue

```typescript
// Get queue size
const size = webSocketService.getMessageQueueSize();

// Get queued messages
const messages = webSocketService.getQueuedMessages();
messages.forEach(msg => {
  console.log(`${msg.id}: ${msg.message.type} (retries: ${msg.retries})`);
});

// Clear queue
webSocketService.clearMessageQueue();

// Queue size is automatically limited to 100 messages
// Oldest messages are dropped if full
```

## React Hook Usage

```typescript
import { useWebSocket } from '@/services';

function MyComponent() {
  const {
    state,           // WebSocketState
    stats,           // Statistics object
    connect,         // () => Promise<void>
    disconnect,      // () => Promise<void>
    subscribe,       // (type, callback) => unsubscribe
    unsubscribe,     // (type, callback?) => void
    send,            // (message) => Promise<void>
    isConnected      // () => boolean
  } = useWebSocket();

  useEffect(() => {
    connect();
    return () => disconnect();
  }, []);

  return <Text>Connected: {isConnected().toString()}</Text>;
}
```

## Auth Integration

```typescript
import { useAuthContext } from '@/shared/contexts/AuthContext';

function AuthIntegration() {
  const { isAuthenticated } = useAuthContext();
  const { connect, disconnect, isConnected } = useWebSocket();

  useEffect(() => {
    if (isAuthenticated && !isConnected()) {
      connect();
    } else if (!isAuthenticated && isConnected()) {
      disconnect();
    }
  }, [isAuthenticated]);
}
```

## Connection State Checks

```typescript
// All connection states
WebSocketState.DISCONNECTED    // Not connected
WebSocketState.CONNECTING      // Attempting to connect
WebSocketState.CONNECTED       // Connected
WebSocketState.RECONNECTING    // Reconnecting after disconnect
WebSocketState.CLOSING         // User initiated close

// Check states
if (state === WebSocketState.CONNECTED) {
  // Ready to send/receive
}

if (state === WebSocketState.RECONNECTING) {
  // Temporarily offline, messages queued
}

if (state === WebSocketState.DISCONNECTED) {
  // Not connected, need to connect
}
```

## Error Handling

```typescript
// Subscribe to errors
webSocketService.subscribe('error', (error) => {
  switch (error.code) {
    case 'NO_AUTH_TOKEN':
      // Redirect to login
      break;
    case 'TOKEN_EXPIRED':
      // Request token refresh
      break;
    case 'MAX_RECONNECT_ATTEMPTS_REACHED':
      // Show offline UI
      break;
    case 'CONNECTION_TIMEOUT':
      // Check network
      break;
  }
});

// Try/catch for send errors
try {
  await webSocketService.send(message);
} catch (error) {
  console.error('Send failed:', error);
  // Message is queued if offline
}
```

## Configuration

```typescript
import { WebSocketService } from '@/services';

// Custom configuration
const customWS = new WebSocketService({
  url: 'wss://custom-api.com/ws',
  heartbeatInterval: 60000,           // 60 seconds
  messageQueueCapacity: 200,          // 200 messages max
  maxReconnectAttempts: 5,            // 5 retries
  maxMessageRetries: 5,               // 5 per message
  enableMessageQueue: true,           // Queue offline messages
  enableHeartbeat: true,              // Keep-alive pings
});

await customWS.connect();
```

## Event Data Structures

### Session Update
```typescript
{
  sessionId: string;
  status: 'active' | 'paused' | 'completed';
  duration: number;        // seconds
  progress: number;        // 0-100%
  timestamp: number;
}
```

### Coaching Moment
```typescript
{
  id: string;
  title: string;
  message: string;
  actionable: boolean;
  category: 'insight' | 'suggestion' | 'alert' | 'encouragement';
  priority?: 'high' | 'medium' | 'low';
  timestamp: number;
}
```

### Insight Ready
```typescript
{
  insightId: string;
  sessionId: string;
  category: string;
  confidence: number;      // 0-1
  recommendations: string[];
  severity?: 'critical' | 'warning' | 'info';
  timestamp: number;
}
```

## Common Patterns

### Connect on App Load
```typescript
useEffect(() => {
  webSocketService.connect().catch(console.error);
}, []);
```

### Connect on Login
```typescript
const { isAuthenticated } = useAuthContext();

useEffect(() => {
  if (isAuthenticated) {
    webSocketService.connect();
  }
}, [isAuthenticated]);
```

### Disconnect on Logout
```typescript
const handleLogout = async () => {
  await webSocketService.disconnect();
  // ... logout logic
};
```

### Show Connection Status
```typescript
const { state } = useWebSocket();

const status = {
  [WebSocketState.DISCONNECTED]: 'Offline',
  [WebSocketState.CONNECTING]: 'Connecting...',
  [WebSocketState.CONNECTED]: 'Connected',
  [WebSocketState.RECONNECTING]: 'Reconnecting...',
}[state];

return <Text>{status}</Text>;
```

### Handle All Events
```typescript
useEffect(() => {
  if (!isConnected()) return;

  const handlers = [
    webSocketService.subscribe('session_update', handleSession),
    webSocketService.subscribe('coaching_moment', handleCoaching),
    webSocketService.subscribe('insight_ready', handleInsight),
    webSocketService.subscribe('error', handleError),
  ];

  return () => handlers.forEach(h => h());
}, [isConnected()]);
```

### Monitor Queue
```typescript
useEffect(() => {
  const interval = setInterval(() => {
    const size = webSocketService.getMessageQueueSize();
    console.log(`Queue size: ${size}`);
  }, 5000);

  return () => clearInterval(interval);
}, []);
```

## Performance Tips

1. **Unsubscribe on unmount** - Prevent memory leaks
2. **Use hook pattern** - Cleaner component integration
3. **Monitor queue size** - Clear if growing too large
4. **Adjust heartbeat** - Trade off latency vs battery
5. **Custom retry strategy** - Tune for your use case

## Debugging

```typescript
// Check connection state
console.log(webSocketService.getState());

// Get full stats
console.log(webSocketService.getStats());

// List subscribers
const messages = webSocketService.getQueuedMessages();
console.log(`${messages.length} queued messages`);

// Monitor state changes
webSocketService.onStateChange(state => {
  console.log('State:', state);
});

// All logs start with [WebSocketService]
// Check console for detailed logging
```

## Type-Safe Usage

```typescript
import {
  WebSocketMessage,
  SessionUpdateEvent,
  CoachingMomentEvent,
  InsightReadyEvent
} from '@/services';

// Type-safe message sending
const message: WebSocketMessage = {
  type: 'session_action',
  data: { action: 'pause', sessionId: 'abc' }
};
await webSocketService.send(message);

// Type-safe event handling
const unsubscribe = webSocketService.subscribe(
  'session_update',
  (data: SessionUpdateEvent['data']) => {
    console.log(data.sessionId, data.progress);
  }
);
```

## Comparison with HTTP

| Feature | WebSocket | HTTP |
|---------|-----------|------|
| Real-time | Bidirectional | Request/Response |
| Queue | Built-in | Custom |
| Reconnection | Auto | Manual |
| Messages | Streamed | Batch |
| Offline | Supported | Needs queueing |

## Troubleshooting Quick Links

- **Connection fails**: Check token validity, WebSocket URL
- **Messages not received**: Verify subscription, connection state
- **Queue growing**: Check network status, clear if needed
- **High memory**: Reduce queue capacity, clear old messages
- **Battery drain**: Disable heartbeat, increase interval

## Environment Variables

```bash
# Set in .env or Expo config
EXPO_PUBLIC_WS_URL=wss://api.tizzy.app/v1/ws

# Default if not set
wss://api.tizzy.app/v1/ws
```

## Resources

- **Full API**: See `WEBSOCKET_README.md`
- **Usage Guide**: See `WEBSOCKET_USAGE.md`
- **Examples**: See `WEBSOCKET_INTEGRATION.tsx`
- **Types**: See `WebSocketTypes.ts`
- **Source**: See `WebSocketService.ts`

---

**Last Updated**: February 13, 2026
