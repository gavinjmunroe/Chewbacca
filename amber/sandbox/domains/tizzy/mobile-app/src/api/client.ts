import axios, { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../shared/constants';
import { isTokenExpired } from '../shared/utils/tokenUtils';
import { networkService, NetworkStatus } from '../services/NetworkService';
import { classifyError, ErrorType } from '../shared/utils/errorHandling';
import {
  AuthResponse,
  LoginCredentials,
  SignupCredentials,
  User,
  UserProfileUpdate,
  Session,
  CreateSessionPayload,
  EndSessionPayload,
  SessionResponse,
  SessionSummary,
  SessionQueryParams,
  AudioFeaturesPayload,
  AudioFeature,
  BaselineData,
  WeeklyProgress,
  MonthlyProgress,
  Goal,
  CreateGoalPayload,
  UpdateGoalPayload,
  GoalQueryParams,
  FeedbackPayload,
  HapticFeedbackPayload,
  FeedbackResponse,
  DataExportRequest,
  DataExportResponse,
  ExportStatus,
  DeleteAccountPayload,
  DeleteAccountResponse,
  WebSocketMessage,
  SessionUpdateMessage,
  CoachingMomentMessage,
} from '../shared/types/api';

// API Configuration (from environment variables)
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.tizzy.app/v1';
const WS_BASE_URL = process.env.EXPO_PUBLIC_WS_URL || 'wss://api.tizzy.app/v1/ws';

// Configuration constants
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 10000; // 10 seconds
const RETRY_STATUS_CODES = [408, 429, 500, 502, 503, 504]; // Retryable status codes

// Types for internal request tracking
interface RetryConfig extends InternalAxiosRequestConfig {
  _startTime?: number;
  _retryCount?: number;
  _retry?: boolean;
  _retryTimestamps?: number[];
  _tokenRefreshAttempted?: boolean;
}

/**
 * Axios instance for Tizzy API
 */
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: DEFAULT_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Log API request
 */
function logRequest(config: AxiosRequestConfig): void {
  console.log(
    `[API Request] ${config.method?.toUpperCase()} ${config.url}`,
    {
      headers: {
        'Content-Type': config.headers?.['Content-Type'],
        'Authorization': config.headers?.Authorization ? 'Bearer [REDACTED]' : 'None',
      },
      timeout: config.timeout,
    }
  );
}

/**
 * Log API response
 */
function logResponse(response: AxiosResponse): void {
  console.log(
    `[API Response] ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`,
    {
      dataSize: JSON.stringify(response.data).length,
      duration: Date.now() - (response.config as any)._startTime,
    }
  );
}

/**
 * Log API error with helpful context
 */
function logError(error: AxiosError, context?: string): void {
  const startTime = (error.config as any)?._startTime || 0;
  const duration = startTime ? Date.now() - startTime : 'unknown';

  const errorInfo = {
    method: error.config?.method?.toUpperCase(),
    url: error.config?.url,
    status: error.response?.status,
    statusText: error.response?.statusText,
    code: error.code,
    message: error.message,
    duration,
    context,
  };

  if (error.response) {
    // Server responded with error status
    console.warn(`[API Error] ${error.response.status} ${error.config?.method?.toUpperCase()} ${error.config?.url}`, errorInfo);
  } else if (error.request) {
    // Request made but no response
    console.warn(`[API Error] No response from server`, errorInfo);
  } else {
    // Error in request setup
    console.error(`[API Error] Request setup failed`, errorInfo);
  }
}

/**
 * Get better error message for user
 */
function getErrorMessage(error: AxiosError): string {
  // Try using error classification first
  try {
    const classified = classifyError(error);
    return classified.userMessage || classified.message;
  } catch (e) {
    // Fall back to basic error messages
  }

  const status = error.response?.status;
  const data = error.response?.data as any;

  // Prefer error message from server
  if (data?.error?.message) {
    return data.error.message;
  }

  if (data?.message) {
    return data.message;
  }

  // Status-based messages
  switch (status) {
    case 400:
      return 'Invalid request. Please check your input.';
    case 401:
      return 'Session expired. Please log in again.';
    case 403:
      return 'You do not have permission to perform this action.';
    case 404:
      return 'Resource not found.';
    case 408:
    case 504:
      return 'Request timeout. Please check your connection and try again.';
    case 429:
      return 'Too many requests. Please wait a moment and try again.';
    case 500:
    case 502:
    case 503:
      return 'Server error. Our team is working on it. Please try again later.';
    default:
      break;
  }

  // Network errors
  if (!error.response) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return 'Request timed out. Please check your connection.';
    }
    return 'Network error. Please check your internet connection.';
  }

  return 'An unexpected error occurred. Please try again.';
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoffDelay(retryCount: number): number {
  const exponentialDelay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
  const cappedDelay = Math.min(exponentialDelay, MAX_RETRY_DELAY);
  const jitter = Math.random() * 1000; // Add up to 1s random jitter
  return Math.min(cappedDelay + jitter, MAX_RETRY_DELAY);
}

/**
 * Check if a request should be retried
 */
function shouldRetry(error: AxiosError, retryCount: number): boolean {
  // Don't retry if max retries exceeded
  if (retryCount >= MAX_RETRIES) {
    return false;
  }

  // Don't retry on network errors (will be queued instead)
  if (!error.response) {
    return false;
  }

  // Only retry specific status codes
  return RETRY_STATUS_CODES.includes(error.response.status);
}

/**
 * Attempt token refresh for 401 errors
 */
async function attemptTokenRefresh(): Promise<boolean> {
  try {
    // In a real app, you'd call a refresh endpoint
    // For now, just clear the invalid token
    console.log('[API] Attempting token refresh...');

    // Remove expired token
    await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);

    // In production, call refresh endpoint and store new token
    // const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {});
    // await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, response.data.token);
    // return true;

    return false; // Refresh failed, user needs to login
  } catch (error) {
    console.error('[API] Token refresh failed:', error);
    return false;
  }
}

/**
 * Request interceptor to add authentication token and check network
 */
apiClient.interceptors.request.use(
  async (config: RetryConfig) => {
    // Record request start time for duration tracking
    config._startTime = Date.now();

    // Log the request
    logRequest(config);

    // Initialize retry tracking
    config._retryCount = config._retryCount || 0;
    config._retryTimestamps = config._retryTimestamps || [];

    // Check network connectivity before making request
    // Only check if NetworkService is initialized
    if (networkService['initialized']) {
      const networkStatus = networkService.getStatus();

      if (networkStatus === 'offline') {
        const error = new AxiosError(
          'No network connection',
          'NETWORK_ERROR',
          config,
          null,
          undefined
        );
        console.warn('[API] Network offline detected - will queue for sync');
        return Promise.reject(error);
      }
    }

    // Add authentication token
    const token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response interceptor for error handling with retry logic and token refresh
 */
apiClient.interceptors.response.use(
  (response) => {
    logResponse(response);
    return response;
  },
  async (error: AxiosError) => {
    const config = error.config as RetryConfig;
    const retryCount = config?._retryCount || 0;

    // Log the error
    logError(error, `Retry ${retryCount}/${MAX_RETRIES}`);

    // Handle network errors by queuing for sync
    if (!error.response) {
      if (error.code === 'NETWORK_ERROR' || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        console.warn('[API] Network error - attempting to queue request for offline sync');

        // Try to queue for offline sync if this is a mutation (POST, PATCH, DELETE)
        if (config && ['post', 'patch', 'delete'].includes(config.method?.toLowerCase() || '')) {
          try {
            // Lazy load syncService to avoid circular dependency
            const { syncService } = await import('../services/SyncService');
            const payload = config.data ? JSON.parse(config.data) : {};
            await syncService.enqueue('CREATE_SESSION', payload); // Generic queue for now
            console.log('[API] Request queued for offline sync');
          } catch (queueError) {
            console.error('[API] Failed to queue request:', queueError);
          }
        }
      }

      return Promise.reject(error);
    }

    // Handle 401 Unauthorized - attempt token refresh
    if (error.response.status === 401) {
      // Only attempt refresh once per request
      if (!config._tokenRefreshAttempted) {
        config._tokenRefreshAttempted = true;

        const refreshed = await attemptTokenRefresh();
        if (refreshed) {
          // Token was refreshed, retry the original request
          console.log('[API] Token refreshed, retrying original request');
          return apiClient.request(config);
        }
      }

      // Token refresh failed, clear auth and reject
      console.warn('[API] Token refresh failed, clearing authentication');
      await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
      return Promise.reject(error);
    }

    // Handle rate limiting (429) - wait longer before retry
    if (error.response.status === 429) {
      console.warn('[API] Rate limit exceeded - waiting before retry');
      if (shouldRetry(error, retryCount)) {
        config._retryCount = retryCount + 1;
        const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, retryCount + 1), 60000); // Up to 1 minute
        await new Promise(resolve => setTimeout(resolve, delay));
        return apiClient.request(config);
      }
    }

    // Handle retryable errors with exponential backoff
    if (shouldRetry(error, retryCount)) {
      config._retryCount = retryCount + 1;
      config._retryTimestamps!.push(Date.now());

      const delay = calculateBackoffDelay(retryCount);
      console.log(`[API] Retrying request (attempt ${retryCount + 1}/${MAX_RETRIES}) after ${delay}ms`);

      await new Promise(resolve => setTimeout(resolve, delay));
      return apiClient.request(config);
    }

    // Create enhanced error with user-friendly message
    const enhancedError = new AxiosError(
      getErrorMessage(error),
      error.code,
      error.config,
      error.request,
      error.response
    );

    return Promise.reject(enhancedError);
  }
);

/**
 * API Service Class
 * Enhanced with network detection, automatic retries, token refresh, and better error handling
 */
export class TizzyAPIService {
  private client: AxiosInstance;

  constructor(client: AxiosInstance = apiClient) {
    this.client = client;
  }

  /**
   * Wraps API calls with enhanced error handling and logging
   */
  private async executeRequest<T>(
    requestFn: () => Promise<AxiosResponse<T>>,
    operationName: string
  ): Promise<T> {
    try {
      const response = await requestFn();
      console.log(`[API:${operationName}] Success`);
      return response.data;
    } catch (error: any) {
      const errorMessage = error?.message || 'Unknown error';
      console.error(`[API:${operationName}] Failed: ${errorMessage}`);
      throw error;
    }
  }

  // Authentication
  async login(email: string, password: string): Promise<AuthResponse> {
    return this.executeRequest(
      () => this.client.post<AuthResponse>('/auth/login', { email, password }),
      'login'
    ).then(async (data) => {
      // Store token on successful login
      try {
        await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, data.token);
      } catch (error) {
        console.error('[API] Failed to store auth token after login:', error);
        // Re-throw with more context - this is critical as user won't be authenticated
        throw new Error('Login succeeded but failed to save authentication token. Please try again.');
      }
      return data;
    });
  }

  async signup(credentials: SignupCredentials): Promise<AuthResponse> {
    return this.executeRequest(
      () => this.client.post<AuthResponse>('/auth/signup', credentials),
      'signup'
    ).then(async (data) => {
      // Store token on successful signup
      try {
        await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, data.token);
      } catch (error) {
        console.error('[API] Failed to store auth token after signup:', error);
        // Re-throw with more context - this is critical as user won't be authenticated
        throw new Error('Signup succeeded but failed to save authentication token. Please try again.');
      }
      return data;
    });
  }

  async logout(): Promise<void> {
    try {
      await this.client.post('/auth/logout');
    } catch (error) {
      console.warn('[API:logout] Server logout failed, clearing local token');
    } finally {
      // Always clear token locally, even if server call fails
      await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    }
  }

  /**
   * Checks if the stored token is valid (not expired)
   * Removes the token if it's expired
   * @returns Promise<boolean> - true if token is valid, false if expired or not found
   */
  async checkTokenValidity(): Promise<boolean> {
    try {
      const token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);

      if (!token) {
        return false;
      }

      if (isTokenExpired(token)) {
        console.log('[Auth] Token expired, removing from storage');
        await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[Auth] Error checking token validity:', error);
      return false;
    }
  }

  // User Profile
  async getUserProfile(userId: string): Promise<User> {
    return this.executeRequest(
      () => this.client.get<User>(`/users/${userId}`),
      `getUserProfile:${userId}`
    );
  }

  async updateUserProfile(userId: string, data: UserProfileUpdate): Promise<User> {
    try {
      return await this.executeRequest(
        () => this.client.patch<User>(`/users/${userId}`, data),
        `updateUserProfile:${userId}`
      );
    } catch (error) {
      // Queue for offline sync if network error
      if (this.isNetworkError(error)) {
        console.log('[API] Queueing updateUserProfile for offline sync');
        // Lazy load syncService to avoid circular dependency
        const { syncService } = await import('../services/SyncService');
        await syncService.enqueue('UPDATE_USER_PROFILE', { userId, updates: data });
        // Return a mock response - in real app, should fetch from local DB
        throw new Error('Profile update queued for sync - refresh from local database');
      }
      throw error;
    }
  }

  /**
   * Check if error is a network error
   */
  private isNetworkError(error: any): boolean {
    return (
      error?.code === 'NETWORK_ERROR' ||
      error?.message === 'Network Error' ||
      error?.message === 'No network connection' ||
      !error?.response
    );
  }

  // Sessions
  async createSession(data: CreateSessionPayload): Promise<SessionResponse> {
    try {
      return await this.executeRequest(
        () => this.client.post<SessionResponse>('/sessions', data),
        'createSession'
      );
    } catch (error) {
      // Queue for offline sync if network error
      if (this.isNetworkError(error)) {
        console.log('[API] Queueing createSession for offline sync');
        // Lazy load syncService to avoid circular dependency
        const { syncService } = await import('../services/SyncService');
        await syncService.enqueue('CREATE_SESSION', data);
        // Return mock response with local ID
        return {
          id: data.start_time, // Use timestamp as temporary ID
          user_id: data.device_id,
          device_id: data.device_id,
          start_time: data.start_time,
          total_duration_seconds: 0,
          duration_seconds: 0,
          speaker_count_estimate: 0,
          environment_tag: data.environment_tag,
          consent_mode: data.consent_mode,
          conversation_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as SessionResponse;
      }
      throw error;
    }
  }

  async uploadFeatures(sessionId: string, features: AudioFeature[]): Promise<void> {
    try {
      await this.executeRequest(
        () => this.client.post(`/sessions/${sessionId}/features`, { features }),
        `uploadFeatures:${sessionId}`
      );
    } catch (error) {
      // Queue for offline sync if network error
      if (this.isNetworkError(error)) {
        console.log('[API] Queueing uploadFeatures for offline sync');
        // Lazy load syncService to avoid circular dependency
        const { syncService } = await import('../services/SyncService');
        await syncService.enqueue('UPLOAD_FEATURES', { sessionId, features });
        return; // Return successfully to not block the app
      }
      throw error;
    }
  }

  async endSession(sessionId: string, data: EndSessionPayload): Promise<void> {
    try {
      await this.executeRequest(
        () => this.client.post(`/sessions/${sessionId}/end`, data),
        `endSession:${sessionId}`
      );
    } catch (error) {
      // Queue for offline sync if network error
      if (this.isNetworkError(error)) {
        console.log('[API] Queueing endSession for offline sync');
        // Lazy load syncService to avoid circular dependency
        const { syncService } = await import('../services/SyncService');
        await syncService.enqueue('END_SESSION', { sessionId, data });
        return; // Return successfully to not block the app
      }
      throw error;
    }
  }

  async getSessionSummary(sessionId: string): Promise<SessionSummary> {
    return this.executeRequest(
      () => this.client.get<SessionSummary>(`/sessions/${sessionId}/summary`),
      `getSessionSummary:${sessionId}`
    );
  }

  async getSessions(userId: string, params?: Omit<SessionQueryParams, 'user_id'>): Promise<Session[]> {
    return this.executeRequest(
      () => this.client.get<Session[]>(`/sessions`, {
        params: { user_id: userId, ...params }
      }),
      `getSessions:${userId}`
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.executeRequest(
      () => this.client.delete(`/sessions/${sessionId}`),
      `deleteSession:${sessionId}`
    );
  }

  // Baseline
  async getUserBaseline(userId: string): Promise<BaselineData> {
    return this.executeRequest(
      () => this.client.get<BaselineData>(`/users/${userId}/baseline`),
      `getUserBaseline:${userId}`
    );
  }

  // Progress
  async getWeeklyProgress(userId: string, week: string): Promise<WeeklyProgress> {
    return this.executeRequest(
      () => this.client.get<WeeklyProgress>(`/users/${userId}/progress/weekly`, {
        params: { week }
      }),
      `getWeeklyProgress:${userId}:${week}`
    );
  }

  async getMonthlyProgress(userId: string, month: string): Promise<MonthlyProgress> {
    return this.executeRequest(
      () => this.client.get<MonthlyProgress>(`/users/${userId}/progress/monthly`, {
        params: { month }
      }),
      `getMonthlyProgress:${userId}:${month}`
    );
  }

  // Goals
  async getGoals(userId: string): Promise<Goal[]> {
    return this.executeRequest(
      () => this.client.get<Goal[]>(`/users/${userId}/goals`),
      `getGoals:${userId}`
    );
  }

  async createGoal(userId: string, goal: CreateGoalPayload): Promise<Goal> {
    try {
      return await this.executeRequest(
        () => this.client.post<Goal>(`/users/${userId}/goals`, goal),
        `createGoal:${userId}`
      );
    } catch (error) {
      // Queue for offline sync if network error
      if (this.isNetworkError(error)) {
        console.log('[API] Queueing createGoal for offline sync');
        const tempGoal: Goal = {
          id: `temp-${Date.now()}`,
          user_id: userId,
          title: goal.title,
          description: goal.description,
          target_metric: goal.target_metric,
          target_value: goal.target_value,
          current_value: undefined,
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          target_date: goal.target_date,
          completed_at: undefined,
        };
        // Lazy load syncService to avoid circular dependency
        const { syncService } = await import('../services/SyncService');
        await syncService.enqueue('CREATE_GOAL', { userId, goal: tempGoal });
        return tempGoal;
      }
      throw error;
    }
  }

  async updateGoal(goalId: string, updates: UpdateGoalPayload): Promise<Goal> {
    try {
      return await this.executeRequest(
        () => this.client.patch<Goal>(`/goals/${goalId}`, updates),
        `updateGoal:${goalId}`
      );
    } catch (error) {
      // Queue for offline sync if network error
      if (this.isNetworkError(error)) {
        console.log('[API] Queueing updateGoal for offline sync');
        // Lazy load syncService to avoid circular dependency
        const { syncService } = await import('../services/SyncService');
        await syncService.enqueue('UPDATE_GOAL', { goalId, updates });
        // Return a mock response - in real app, should fetch from local DB
        throw new Error('Goal update queued for sync - refresh from local database');
      }
      throw error;
    }
  }

  async deleteGoal(goalId: string): Promise<void> {
    try {
      await this.executeRequest(
        () => this.client.delete(`/goals/${goalId}`),
        `deleteGoal:${goalId}`
      );
    } catch (error) {
      // Queue for offline sync if network error
      if (this.isNetworkError(error)) {
        console.log('[API] Queueing deleteGoal for offline sync');
        // Lazy load syncService to avoid circular dependency
        const { syncService } = await import('../services/SyncService');
        await syncService.enqueue('DELETE_GOAL', { goalId });
        return; // Return successfully to not block the app
      }
      throw error;
    }
  }

  // Feedback
  async submitFeedback(feedback: FeedbackPayload): Promise<FeedbackResponse> {
    return this.executeRequest(
      () => this.client.post<FeedbackResponse>('/feedback', feedback),
      'submitFeedback'
    );
  }

  async submitHapticFeedback(feedback: HapticFeedbackPayload): Promise<FeedbackResponse> {
    return this.executeRequest(
      () => this.client.post<FeedbackResponse>('/feedback/haptic', feedback),
      'submitHapticFeedback'
    );
  }

  // Data Export
  async requestDataExport(userId: string, format: 'json' | 'csv', includeAudio = false): Promise<DataExportResponse> {
    return this.executeRequest(
      () => this.client.post<DataExportResponse>(`/users/${userId}/export`, {
        format,
        include_audio: includeAudio
      }),
      `requestDataExport:${userId}`
    );
  }

  async getExportStatus(exportId: string): Promise<ExportStatus> {
    return this.executeRequest(
      () => this.client.get<ExportStatus>(`/exports/${exportId}`),
      `getExportStatus:${exportId}`
    );
  }

  // Account Deletion
  async deleteAccount(userId: string): Promise<DeleteAccountResponse> {
    return this.executeRequest(
      () => this.client.delete<DeleteAccountResponse>(`/users/${userId}`, {
        data: { confirm: true }
      }),
      `deleteAccount:${userId}`
    );
  }
}

/**
 * WebSocket Service for Real-Time Updates
 */
export class TizzyWebSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private messageCallbacks: Set<(data: WebSocketMessage) => void> = new Set();

  constructor(url: string = WS_BASE_URL) {
    this.url = url;
  }

  async connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`${this.url}?token=${token}`);

        this.ws.onopen = () => {
          console.log('[WS] Connected');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.messageCallbacks.forEach(cb => cb(data));
          } catch (error) {
            console.error('[WS] Failed to parse message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[WS] Error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[WS] Disconnected');
          this.handleReconnection();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  subscribeToSession(sessionId: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        action: 'subscribe',
        session_id: sessionId
      }));
    }
  }

  onMessage(callback: (data: WebSocketMessage) => void): () => void {
    this.messageCallbacks.add(callback);
    return () => this.messageCallbacks.delete(callback);
  }

  private handleReconnection(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnection attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    setTimeout(async () => {
      try {
        const token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
        if (token) {
          await this.connect(token);
        } else {
          console.warn('[WS] No auth token available for reconnection');
        }
      } catch (error) {
        console.error('[WS] Reconnection error:', error);
        // Retry again if we haven't exceeded max attempts
        this.handleReconnection();
      }
    }, delay);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.messageCallbacks.clear();
  }
}

// Singleton instances
export const apiService = new TizzyAPIService();
export const wsService = new TizzyWebSocketService();
export default apiClient;
