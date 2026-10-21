/**
 * API Response Type Definitions
 * Comprehensive TypeScript types for all Tizzy API responses
 */

// ============================================================================
// Generic API Response Wrapper
// ============================================================================

/**
 * Generic API response wrapper
 * All API responses follow this structure
 */
export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
  error?: ApiError;
}

/**
 * API Error structure
 */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
  field?: string;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

// ============================================================================
// User Types
// ============================================================================

/**
 * User profile data
 */
export interface User {
  id: string;
  email: string;
  name?: string;
  created_at: string;
  updated_at: string;
  avatar_url?: string;
  preferences: UserPreferences;
}

/**
 * User preferences
 */
export interface UserPreferences {
  notifications_enabled: boolean;
  haptic_feedback_enabled: boolean;
  coaching_frequency: 'daily' | 'weekly' | 'custom';
  privacy_mode: 'full' | 'minimal';
  data_sharing_consent: boolean;
  theme?: 'light' | 'dark' | 'auto';
}

/**
 * User profile update payload
 */
export interface UserProfileUpdate {
  name?: string;
  avatar_url?: string;
  preferences?: Partial<UserPreferences>;
}

// ============================================================================
// Authentication Types
// ============================================================================

/**
 * Authentication response (login/signup)
 */
export interface AuthResponse {
  token: string;
  user: User;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * Login credentials
 */
export interface LoginCredentials {
  email: string;
  password: string;
}

/**
 * Signup credentials
 */
export interface SignupCredentials {
  email: string;
  password: string;
  name?: string;
}

// ============================================================================
// Session Types
// ============================================================================

/**
 * Practice session data
 */
export interface Session {
  id: string;
  user_id: string;
  device_id: string;
  start_time: string;
  end_time?: string;
  total_duration_seconds: number;
  duration_seconds: number; // Alias for total_duration_seconds for compatibility
  speaker_count_estimate: number;
  environment_tag: string;
  consent_mode: string;
  conversation_count?: number;
  created_at: string;
  updated_at: string;
}

/**
 * Session creation payload
 */
export interface CreateSessionPayload {
  device_id: string;
  start_time: string;
  environment_tag: string;
  consent_mode: string;
}

/**
 * Session end payload
 */
export interface EndSessionPayload {
  end_time: string;
  total_duration_seconds: number;
  speaker_count_estimate: number;
}

/**
 * Session creation response
 */
export interface SessionResponse extends Session {
  upload_url?: string;
}

/**
 * Session summary with insights
 */
export interface SessionSummary {
  session_id: string;
  date: string;
  duration_minutes: number;
  summary: string;
  insights: SessionInsights;
  metrics: SessionMetrics;
  progress_data: SessionProgressData;
}

/**
 * Session insights
 */
export interface SessionInsights {
  what_went_well: string[];
  areas_for_growth: string[];
  micro_goal: MicroGoal;
}

/**
 * Micro goal for improvement
 */
export interface MicroGoal {
  title: string;
  description: string;
  target_date: string;
  status?: 'pending' | 'in_progress' | 'completed';
}

/**
 * Session performance metrics
 */
export interface SessionMetrics {
  speech_clarity: number;
  pace_consistency: number;
  vocal_variety: number;
  pause_effectiveness: number;
}

/**
 * Session progress data
 */
export interface SessionProgressData {
  week: string;
  sessions_completed: number;
  total_practice_minutes: number;
  improvement_trend: 'improving' | 'stable' | 'needs_attention';
}

/**
 * Audio features upload payload
 */
export interface AudioFeaturesPayload {
  features: AudioFeature[];
}

/**
 * Individual audio feature
 */
export interface AudioFeature {
  timestamp: string;
  feature_vector: number[];
  metadata?: Record<string, any>;
}

// ============================================================================
// Baseline Types
// ============================================================================

/**
 * User baseline data
 */
export interface BaselineData {
  user_id: string;
  created_at: string;
  updated_at: string;
  session_count: number;
  baseline_metrics: BaselineMetrics;
  is_established: boolean;
  next_calibration_date?: string;
}

/**
 * Baseline metrics
 */
export interface BaselineMetrics {
  average_speech_clarity: number;
  average_pace: number;
  average_vocal_variety: number;
  average_pause_effectiveness: number;
  typical_session_duration_minutes: number;
  preferred_environment: string;
}

// ============================================================================
// Progress Types
// ============================================================================

/**
 * Weekly progress data
 */
export interface WeeklyProgress {
  user_id: string;
  week: string;
  sessions_completed: number;
  conversation_count: number;
  total_practice_minutes: number;
  metrics: ProgressMetrics;
  trend: TrendData;
  goals_completed: number;
  goals_in_progress: number;
}

/**
 * Monthly progress data
 */
export interface MonthlyProgress {
  user_id: string;
  month: string;
  sessions_completed: number;
  total_practice_minutes: number;
  weekly_breakdown: WeeklyProgress[];
  metrics: ProgressMetrics;
  trend: TrendData;
  achievements: Achievement[];
}

/**
 * Progress metrics
 */
export interface ProgressMetrics {
  speech_clarity: MetricProgress;
  pace_consistency: MetricProgress;
  vocal_variety: MetricProgress;
  pause_effectiveness: MetricProgress;
}

/**
 * Individual metric progress
 */
export interface MetricProgress {
  current: number;
  previous: number;
  change_percentage: number;
  trend: 'up' | 'down' | 'stable';
}

/**
 * Trend data
 */
export interface TrendData {
  overall: 'improving' | 'stable' | 'needs_attention';
  confidence_score: number;
  insights: string[];
}

/**
 * Achievement data
 */
export interface Achievement {
  id: string;
  title: string;
  description: string;
  earned_at: string;
  icon?: string;
  category: 'consistency' | 'improvement' | 'milestone';
}

// ============================================================================
// Goal Types
// ============================================================================

/**
 * User goal
 */
export interface Goal {
  id: string;
  user_id: string;
  title: string;
  description: string;
  target_metric: 'speech_clarity' | 'pace_consistency' | 'vocal_variety' | 'pause_effectiveness' | 'custom';
  target_value?: number;
  current_value?: number;
  status: 'active' | 'completed' | 'archived';
  created_at: string;
  updated_at: string;
  target_date?: string;
  completed_at?: string;
}

/**
 * Goal creation payload
 */
export interface CreateGoalPayload {
  title: string;
  description: string;
  target_metric: Goal['target_metric'];
  target_value?: number;
  target_date?: string;
}

/**
 * Goal update payload
 */
export interface UpdateGoalPayload {
  title?: string;
  description?: string;
  target_value?: number;
  target_date?: string;
  status?: Goal['status'];
}

// ============================================================================
// Feedback Types
// ============================================================================

/**
 * General feedback submission
 */
export interface FeedbackPayload {
  moment_id?: string;
  session_id: string;
  feedback_type: 'helpful' | 'not_helpful' | 'unsure';
  comment?: string;
}

/**
 * Haptic feedback submission
 */
export interface HapticFeedbackPayload {
  haptic_timestamp: string;
  session_id: string;
  haptic_pattern: string;
  feedback: 'helpful' | 'not_helpful' | 'unsure';
  comment?: string;
}

/**
 * Feedback response
 */
export interface FeedbackResponse {
  id: string;
  submitted_at: string;
  status: 'received' | 'processed';
}

// ============================================================================
// Data Export Types
// ============================================================================

/**
 * Data export request payload
 */
export interface DataExportRequest {
  format: 'json' | 'csv';
  include_audio: boolean;
  date_range?: {
    start_date: string;
    end_date: string;
  };
}

/**
 * Data export response
 */
export interface DataExportResponse {
  export_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  created_at: string;
  estimated_completion_time?: string;
}

/**
 * Export status response
 */
export interface ExportStatus {
  export_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress_percentage: number;
  download_url?: string;
  expires_at?: string;
  error_message?: string;
}

// ============================================================================
// Device Types
// ============================================================================

/**
 * Device information
 */
export interface Device {
  id: string;
  user_id: string;
  device_name: string;
  device_type: string;
  firmware_version: string;
  last_connected: string;
  battery_level?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Device registration payload
 */
export interface RegisterDevicePayload {
  device_name: string;
  device_type: string;
  firmware_version: string;
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

/**
 * WebSocket message base
 */
export interface WebSocketMessage<T = any> {
  type: string;
  payload: T;
  timestamp: string;
}

/**
 * Real-time session update
 */
export interface SessionUpdateMessage {
  session_id: string;
  status: 'started' | 'processing' | 'completed';
  progress?: number;
  metrics?: Partial<SessionMetrics>;
}

/**
 * Real-time coaching moment
 */
export interface CoachingMomentMessage {
  moment_id: string;
  session_id: string;
  timestamp: string;
  type: 'encouragement' | 'tip' | 'alert';
  message: string;
  priority: 'low' | 'medium' | 'high';
}

// ============================================================================
// Query Parameter Types
// ============================================================================

/**
 * Common query parameters for list endpoints
 */
export interface ListQueryParams {
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

/**
 * Session list query parameters
 */
export interface SessionQueryParams extends ListQueryParams {
  user_id?: string;
  start_date?: string;
  end_date?: string;
  environment_tag?: string;
}

/**
 * Goal list query parameters
 */
export interface GoalQueryParams extends ListQueryParams {
  status?: Goal['status'];
  target_metric?: Goal['target_metric'];
}

// ============================================================================
// Account Management Types
// ============================================================================

/**
 * Account deletion confirmation
 */
export interface DeleteAccountPayload {
  confirm: boolean;
  reason?: string;
}

/**
 * Account deletion response
 */
export interface DeleteAccountResponse {
  status: 'scheduled' | 'deleted';
  scheduled_deletion_date?: string;
  message: string;
}
