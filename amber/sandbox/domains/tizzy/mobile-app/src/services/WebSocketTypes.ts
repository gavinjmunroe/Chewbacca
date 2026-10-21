/**
 * WebSocket Service Type Definitions
 * Complete type system for type-safe WebSocket communication
 */

/**
 * WebSocket connection states
 */
export enum WebSocketState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  CLOSING = 'CLOSING',
}

/**
 * Supported event types
 */
export type WebSocketEventType =
  | 'session_update'
  | 'coaching_moment'
  | 'insight_ready'
  | 'error'
  | 'connected'
  | 'disconnected'
  | 'state_changed';

/**
 * Base WebSocket message interface
 */
export interface WebSocketMessage {
  type: WebSocketEventType | string;
  timestamp?: number;
  data?: any;
  sessionId?: string;
  userId?: string;
}

/**
 * Session Update Event
 * Emitted when a session progresses or status changes
 */
export interface SessionUpdateEvent extends WebSocketMessage {
  type: 'session_update';
  data: {
    sessionId: string;
    status: 'idle' | 'active' | 'paused' | 'completed';
    duration: number;           // seconds
    progress: number;           // 0-100%
    speakerCount?: number;
    conversationCount?: number;
    environmentTag?: string;
    timestamp: number;
  };
}

/**
 * Coaching Moment Event
 * Emitted when a coaching insight or moment is delivered
 */
export interface CoachingMomentEvent extends WebSocketMessage {
  type: 'coaching_moment';
  data: {
    id: string;
    title: string;
    message: string;
    actionable: boolean;
    category: 'insight' | 'suggestion' | 'alert' | 'encouragement';
    priority?: 'high' | 'medium' | 'low';
    actions?: CoachingAction[];
    timestamp: number;
  };
}

/**
 * Coaching Action
 * Actions that can be suggested in a coaching moment
 */
export interface CoachingAction {
  id: string;
  label: string;
  type: 'open_url' | 'show_detail' | 'log_action' | 'schedule_reminder';
  payload?: any;
}

/**
 * Insight Ready Event
 * Emitted when analysis/insight generation completes
 */
export interface InsightReadyEvent extends WebSocketMessage {
  type: 'insight_ready';
  data: {
    insightId: string;
    sessionId: string;
    category: string;           // e.g., 'speech_clarity', 'engagement', 'pacing'
    confidence: number;         // 0-1
    severity?: 'critical' | 'warning' | 'info';
    recommendations: string[];
    metrics?: Record<string, number>;
    timestamp: number;
  };
}

/**
 * Error Event
 * Emitted when an error occurs
 */
export interface ErrorEvent extends WebSocketMessage {
  type: 'error';
  data: {
    message: string;
    code?: string;
    details?: any;
  };
}

/**
 * Connection State Changed Event
 * Emitted when connection state changes
 */
export interface StateChangedEvent extends WebSocketMessage {
  type: 'state_changed';
  data: {
    from: WebSocketState;
    to: WebSocketState;
    reason?: string;
  };
}

/**
 * Generic event union type
 */
export type WebSocketEvent =
  | SessionUpdateEvent
  | CoachingMomentEvent
  | InsightReadyEvent
  | ErrorEvent
  | StateChangedEvent
  | { type: string; data?: any };

/**
 * Queued message for offline support
 */
export interface QueuedMessage {
  id: string;
  message: WebSocketMessage;
  timestamp: number;
  retries: number;
}

/**
 * WebSocket configuration
 */
export interface WebSocketConfig {
  url: string;
  heartbeatInterval?: number;           // milliseconds
  messageQueueCapacity?: number;        // max messages
  maxReconnectAttempts?: number;        // max retries
  maxMessageRetries?: number;           // per message
  enableMessageQueue?: boolean;
  enableHeartbeat?: boolean;
}

/**
 * Connection statistics
 */
export interface WebSocketStats {
  state: WebSocketState;
  isConnected: boolean;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  messageQueueSize: number;
  uptime?: number;
}

/**
 * Subscription callback type
 */
export type SubscriptionCallback = (data: any) => void;

/**
 * Connection state listener type
 */
export type ConnectionStateListener = (state: WebSocketState) => void;

/**
 * WebSocket service action messages
 */
export namespace WebSocketActions {
  /**
   * Session control actions
   */
  export interface SessionActionMessage extends WebSocketMessage {
    type: 'session_action';
    data: {
      action: 'start' | 'pause' | 'resume' | 'end' | 'cancel';
      sessionId: string;
      payload?: any;
    };
  }

  /**
   * User feedback actions
   */
  export interface FeedbackMessage extends WebSocketMessage {
    type: 'user_feedback';
    data: {
      sessionId: string;
      rating?: number;             // 1-5
      feedback?: string;
      tags?: string[];
    };
  }

  /**
   * Coaching moment acknowledgement
   */
  export interface AcknowledgeCoachingMessage extends WebSocketMessage {
    type: 'acknowledge_coaching';
    data: {
      momentId: string;
      understood: boolean;
      feedback?: string;
    };
  }

  /**
   * Heartbeat/ping
   */
  export interface HeartbeatMessage extends WebSocketMessage {
    type: 'ping' | 'pong';
    data?: {
      clientTime?: number;
      serverTime?: number;
    };
  }

  /**
   * Subscribe to session
   */
  export interface SubscribeMessage extends WebSocketMessage {
    type: 'subscribe';
    data: {
      sessionId: string;
      events?: string[];
    };
  }

  /**
   * Unsubscribe from session
   */
  export interface UnsubscribeMessage extends WebSocketMessage {
    type: 'unsubscribe';
    data: {
      sessionId: string;
    };
  }
}

/**
 * Common WebSocket constants
 */
export const WebSocketConstants = {
  // Event types
  EVENTS: {
    SESSION_UPDATE: 'session_update' as const,
    COACHING_MOMENT: 'coaching_moment' as const,
    INSIGHT_READY: 'insight_ready' as const,
    ERROR: 'error' as const,
    CONNECTED: 'connected' as const,
    DISCONNECTED: 'disconnected' as const,
    STATE_CHANGED: 'state_changed' as const,
  },

  // Default configuration
  DEFAULT_CONFIG: {
    HEARTBEAT_INTERVAL: 30000,
    MESSAGE_QUEUE_CAPACITY: 100,
    MAX_RECONNECT_ATTEMPTS: 10,
    MAX_MESSAGE_RETRIES: 3,
    CONNECTION_TIMEOUT: 10000,
    MAX_BACKOFF_DELAY: 30000,
    BASE_BACKOFF_DELAY: 1000,
  },

  // Error codes
  ERROR_CODES: {
    NO_AUTH_TOKEN: 'NO_AUTH_TOKEN',
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    MAX_RECONNECT_ATTEMPTS_REACHED: 'MAX_RECONNECT_ATTEMPTS_REACHED',
    CONNECTION_TIMEOUT: 'CONNECTION_TIMEOUT',
    MESSAGE_SEND_FAILED: 'MESSAGE_SEND_FAILED',
    INVALID_MESSAGE_FORMAT: 'INVALID_MESSAGE_FORMAT',
    NETWORK_ERROR: 'NETWORK_ERROR',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  },

  // Session statuses
  SESSION_STATUS: {
    IDLE: 'idle' as const,
    ACTIVE: 'active' as const,
    PAUSED: 'paused' as const,
    COMPLETED: 'completed' as const,
  },

  // Coaching categories
  COACHING_CATEGORIES: {
    INSIGHT: 'insight' as const,
    SUGGESTION: 'suggestion' as const,
    ALERT: 'alert' as const,
    ENCOURAGEMENT: 'encouragement' as const,
  },

  // Insight severity
  INSIGHT_SEVERITY: {
    CRITICAL: 'critical' as const,
    WARNING: 'warning' as const,
    INFO: 'info' as const,
  },

  // Priority levels
  PRIORITY: {
    HIGH: 'high' as const,
    MEDIUM: 'medium' as const,
    LOW: 'low' as const,
  },
};

/**
 * Type guard functions
 */
export const WebSocketTypeGuards = {
  isSessionUpdate(event: any): event is SessionUpdateEvent {
    return event?.type === 'session_update' && event?.data?.sessionId;
  },

  isCoachingMoment(event: any): event is CoachingMomentEvent {
    return event?.type === 'coaching_moment' && event?.data?.id;
  },

  isInsightReady(event: any): event is InsightReadyEvent {
    return event?.type === 'insight_ready' && event?.data?.insightId;
  },

  isError(event: any): event is ErrorEvent {
    return event?.type === 'error';
  },

  isStateChanged(event: any): event is StateChangedEvent {
    return event?.type === 'state_changed' && event?.data?.from && event?.data?.to;
  },

  isConnected(state: WebSocketState): boolean {
    return state === WebSocketState.CONNECTED;
  },

  isConnecting(state: WebSocketState): boolean {
    return state === WebSocketState.CONNECTING || state === WebSocketState.RECONNECTING;
  },

  isDisconnected(state: WebSocketState): boolean {
    return state === WebSocketState.DISCONNECTED || state === WebSocketState.CLOSING;
  },
};

/**
 * Utility type helpers
 */

/**
 * Extract event data type
 */
export type ExtractEventData<T extends WebSocketEvent> = T extends { data: infer D } ? D : never;

/**
 * Create type-safe event handler
 */
export type EventHandler<E extends WebSocketEvent> = (event: E) => void;

/**
 * Create subscription return type
 */
export type Unsubscribe = () => void;
