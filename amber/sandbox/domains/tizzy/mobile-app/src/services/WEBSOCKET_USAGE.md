# WebSocket Service Usage Guide

Real-time updates service for coaching sessions with auto-reconnection, offline message queuing, and auth integration.

## Overview

The WebSocket Service provides:
- Real-time updates from backend (session_update, coaching_moment, insight_ready)
- Automatic reconnection with exponential backoff
- Message queuing for offline support
- Auth token integration with automatic refresh
- Heartbeat mechanism to keep connection alive
- Event-based subscription pattern
- Connection state monitoring

## Quick Start

### Basic Connection

```typescript
import { webSocketService } from '@/services';
import { useEffect } from 'react';

export function MyComponent() {
  useEffect(() => {
    // Connect to WebSocket (auto-retrieves token from AsyncStorage)
    webSocketService.connect();

    return () => {
      webSocketService.disconnect();
    };
  }, []);
}
```

### Subscribe to Events

```typescript
import { webSocketService, WebSocketEventType } from '@/services';

useEffect(() => {
  // Subscribe to session updates
  const unsubscribe = webSocketService.subscribe('session_update', (data) => {
    console.log('Session updated:', data);
    // Handle update
  });

  return unsubscribe;
}, []);
```

### Send Messages

```typescript
// Send a message to the server
await webSocketService.send({
  type: 'action',
  data: {
    action: 'pause_session',
    sessionId: 'abc123'
  }
});
```

## Supported Event Types

### `session_update`
Emitted when a session is updated (progress, status change, etc.)

```typescript
webSocketService.subscribe('session_update', (data) => {
  console.log('Session:', {
    sessionId: data.sessionId,
    status: data.status,
    duration: data.duration,
    progress: data.progress
  });
});
```

### `coaching_moment`
Emitted when a coaching moment/insight is delivered

```typescript
webSocketService.subscribe('coaching_moment', (data) => {
  console.log('Coaching Moment:', {
    title: data.title,
    message: data.message,
    actionable: data.actionable,
    timestamp: data.timestamp
  });
});
```

### `insight_ready`
Emitted when an insight analysis is complete

```typescript
webSocketService.subscribe('insight_ready', (data) => {
  console.log('Insight Ready:', {
    insightId: data.insightId,
    category: data.category,
    confidence: data.confidence,
    recommendations: data.recommendations
  });
});
```

### `state_changed`
Emitted when connection state changes

```typescript
webSocketService.subscribe('state_changed', (data) => {
  console.log('Connection state:', {
    from: data.from,
    to: data.to
  });
});
```

## React Hook Usage

Use the `useWebSocket` hook for easier integration in React components:

```typescript
import { useWebSocket, WebSocketState } from '@/services';

export function RealTimeUpdates() {
  const {
    state,
    stats,
    connect,
    disconnect,
    subscribe,
    send,
    isConnected
  } = useWebSocket();

  useEffect(() => {
    connect();
    return () => disconnect();
  }, []);

  useEffect(() => {
    if (!isConnected()) return;

    const unsubscribe = subscribe('session_update', (data) => {
      console.log('Update received:', data);
    });

    return unsubscribe;
  }, [isConnected()]);

  if (state === WebSocketState.DISCONNECTED) {
    return <Text>Disconnected</Text>;
  }

  if (state === WebSocketState.CONNECTING) {
    return <Text>Connecting...</Text>;
  }

  if (state === WebSocketState.CONNECTED) {
    return <Text>Connected!</Text>;
  }

  return <Text>Reconnecting...</Text>;
}
```

## Connection State Monitoring

Monitor connection state changes:

```typescript
const unsubscribeState = webSocketService.onStateChange((state) => {
  console.log('Connection state:', state);
  // WebSocketState: DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING
});

// Unsubscribe when done
unsubscribeState();
```

Or use the `useWebSocket` hook:

```typescript
const { state } = useWebSocket();

switch (state) {
  case WebSocketState.DISCONNECTED:
    return <Text>Not connected</Text>;
  case WebSocketState.CONNECTING:
    return <ActivityIndicator />;
  case WebSocketState.CONNECTED:
    return <Text>Connected</Text>;
  case WebSocketState.RECONNECTING:
    return <Text>Reconnecting...</Text>;
}
```

## Offline Message Queue

Messages sent while offline are automatically queued:

```typescript
// While offline
await webSocketService.send({
  type: 'user_feedback',
  data: { feedback: 'Great session!' }
});

// Message is queued

// When connection is restored
// Queued messages are automatically sent

// Check queue status
const queueSize = webSocketService.getMessageQueueSize();
const queued = webSocketService.getQueuedMessages();

console.log(`${queueSize} messages queued`);
```

### Queue Management

```typescript
// Get queue information
const stats = webSocketService.getStats();
console.log('Queue size:', stats.messageQueueSize);

// Clear queue manually (if needed)
webSocketService.clearMessageQueue();

// Get specific queued messages
const messages = webSocketService.getQueuedMessages();
messages.forEach(msg => {
  console.log(`${msg.id}: ${msg.message.type} (retries: ${msg.retries})`);
});
```

## Authentication & Token Management

The service automatically handles authentication tokens:

```typescript
// Automatically retrieves token from AsyncStorage
await webSocketService.connect();

// Or provide token explicitly
const token = 'eyJhbGc...';
await webSocketService.connect(token);

// Token is automatically validated
// - Expired tokens prevent connection
// - Token is sent with reconnection attempts
// - Service validates token on app resume
```

## Exponential Backoff Reconnection

Automatic reconnection with exponential backoff:

```
Attempt 1: 1 second delay
Attempt 2: 2 second delay
Attempt 3: 4 second delay
Attempt 4: 8 second delay
...
Attempt 10: 30 seconds delay (max)
```

```typescript
// Configuration (default values shown)
const config = {
  maxReconnectAttempts: 10,      // Max retry attempts
  heartbeatInterval: 30000,       // 30 seconds
  messageQueueCapacity: 100,      // Max queued messages
  maxMessageRetries: 3,           // Retry queued messages
  enableMessageQueue: true,       // Enable offline queue
  enableHeartbeat: true,          // Keep alive
  url: 'wss://api.tizzy.app/v1/ws'
};
```

## Advanced Usage

### Custom Configuration

Create a custom WebSocket instance:

```typescript
import { WebSocketService } from '@/services';

const customWS = new WebSocketService({
  url: 'wss://custom-api.com/ws',
  maxReconnectAttempts: 5,
  heartbeatInterval: 60000,
  messageQueueCapacity: 200,
  enableMessageQueue: true,
  enableHeartbeat: true
});

await customWS.connect();
```

### Monitor Connection Statistics

```typescript
setInterval(() => {
  const stats = webSocketService.getStats();
  console.log('WebSocket Stats:', {
    state: stats.state,
    isConnected: stats.isConnected,
    reconnectAttempts: stats.reconnectAttempts,
    messageQueueSize: stats.messageQueueSize
  });
}, 5000);
```

### Error Handling

```typescript
// Subscribe to errors
webSocketService.subscribe('error', (error) => {
  console.error('WebSocket Error:', {
    message: error.message,
    code: error.code
  });

  // Handle specific error codes
  if (error.code === 'NO_AUTH_TOKEN') {
    // Redirect to login
  } else if (error.code === 'TOKEN_EXPIRED') {
    // Request token refresh
  } else if (error.code === 'MAX_RECONNECT_ATTEMPTS_REACHED') {
    // Show offline message
  }
});
```

## Integration with Auth Context

```typescript
import { useAuthContext } from '@/shared/contexts/AuthContext';
import { useWebSocket } from '@/services';

export function SessionComponent() {
  const { user, isAuthenticated } = useAuthContext();
  const { connect, disconnect, isConnected } = useWebSocket();

  useEffect(() => {
    if (isAuthenticated && !isConnected()) {
      connect();
    } else if (!isAuthenticated && isConnected()) {
      disconnect();
    }
  }, [isAuthenticated]);

  return null;
}
```

## Real World Example

Complete coaching session with real-time updates:

```typescript
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useWebSocket, WebSocketState } from '@/services';
import { useAuthContext } from '@/shared/contexts/AuthContext';

interface SessionUpdate {
  sessionId: string;
  status: 'active' | 'paused' | 'completed';
  duration: number;
  progress: number;
}

export function CoachingSession() {
  const { user } = useAuthContext();
  const { state, connect, disconnect, subscribe, isConnected } = useWebSocket();
  const [session, setSession] = useState<SessionUpdate | null>(null);
  const [coachingMoments, setCoachingMoments] = useState<any[]>([]);

  useEffect(() => {
    if (user) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [user]);

  useEffect(() => {
    if (!isConnected()) return;

    // Subscribe to session updates
    const unsubSession = subscribe('session_update', (data) => {
      setSession(data);
    });

    // Subscribe to coaching moments
    const unsubCoaching = subscribe('coaching_moment', (data) => {
      setCoachingMoments(prev => [...prev, data]);
    });

    // Subscribe to insights
    const unsubInsights = subscribe('insight_ready', (data) => {
      console.log('New insight:', data);
    });

    return () => {
      unsubSession();
      unsubCoaching();
      unsubInsights();
    };
  }, [isConnected(), subscribe]);

  if (state === WebSocketState.DISCONNECTED) {
    return <Text>Offline - changes will sync when online</Text>;
  }

  if (state === WebSocketState.CONNECTING || state === WebSocketState.RECONNECTING) {
    return <ActivityIndicator />;
  }

  return (
    <View>
      <Text>{session?.status || 'Idle'}</Text>
      <Text>Duration: {session?.duration || 0}s</Text>
      <Text>Progress: {session?.progress || 0}%</Text>

      {coachingMoments.map((moment, i) => (
        <Text key={i}>{moment.title}: {moment.message}</Text>
      ))}
    </View>
  );
}
```

## Performance Considerations

### Message Queue Optimization

- Default capacity: 100 messages
- Oldest messages dropped when full
- Messages retried up to 3 times
- Consider clearing old messages to save memory:

```typescript
// Clear queue if it grows too large
const stats = webSocketService.getStats();
if (stats.messageQueueSize > 80) {
  webSocketService.clearMessageQueue();
}
```

### Heartbeat Tuning

- Default interval: 30 seconds
- Adjust based on server timeout settings
- Disable for battery efficiency (trade-off: may lose connection)

```typescript
// Custom service with longer heartbeat
const customWS = new WebSocketService({
  url: 'wss://api.tizzy.app/v1/ws',
  heartbeatInterval: 60000, // 60 seconds
});
```

### Reconnection Strategy

- Exponential backoff prevents server overwhelming
- Max 10 attempts (default) covers ~17 minutes
- Adjust based on criticality of connection

## Cleanup

Always clean up when done:

```typescript
useEffect(() => {
  webSocketService.connect();

  return () => {
    webSocketService.disconnect();
    // Or use cleanup:
    webSocketService.destroy(); // Clears all subscriptions
  };
}, []);
```

## Troubleshooting

### Connection Fails Immediately

```typescript
// Check if token is valid
const token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
console.log('Token valid:', !isTokenExpired(token));

// Check WebSocket URL
console.log('URL:', process.env.EXPO_PUBLIC_WS_URL);
```

### Messages Not Received

```typescript
// Verify subscription
const stats = webSocketService.getStats();
console.log('Connected:', stats.isConnected);

// Check state
const unsubscribe = webSocketService.onStateChange(state => {
  console.log('State:', state);
});
```

### Queue Growing Too Large

```typescript
// Monitor queue size
const stats = webSocketService.getStats();
if (stats.messageQueueSize > 50) {
  console.warn('Large message queue:', stats.messageQueueSize);
}

// Clear if necessary
webSocketService.clearMessageQueue();
```

## API Reference

See `WebSocketService.ts` for complete class and method documentation.

### Key Methods

- `connect(token?)` - Connect to WebSocket
- `disconnect()` - Disconnect from WebSocket
- `send(message)` - Send message to server
- `subscribe(eventType, callback)` - Subscribe to events
- `unsubscribe(eventType, callback?)` - Unsubscribe from events
- `onStateChange(listener)` - Monitor connection state
- `getStats()` - Get connection statistics
- `getMessageQueueSize()` - Get queue size
- `getQueuedMessages()` - Get queued messages
- `clearMessageQueue()` - Clear all queued messages
- `destroy()` - Clean up all resources

### Hooks

- `useWebSocket()` - React hook for WebSocket integration
