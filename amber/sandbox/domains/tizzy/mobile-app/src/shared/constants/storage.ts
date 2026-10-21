/**
 * Storage Keys
 * Centralized constants for AsyncStorage keys
 */

export const STORAGE_KEYS = {
  AUTH_TOKEN: 'auth_token',
  USER: 'user',
  DEVICE_ID: 'device_id',
  DEMO_MODE: 'demo_mode',

  // Settings
  CONSENT_MODE: 'settings_consent_mode',
  RECORDING_PREFERENCES: 'settings_recording_preferences',
  DATA_RETENTION: 'settings_data_retention',
  AUDIO_QUALITY: 'settings_audio_quality',
  MIC_SENSITIVITY: 'settings_mic_sensitivity',
  NOISE_REDUCTION: 'settings_noise_reduction',
  SESSION_REMINDERS: 'settings_session_reminders',
  COACHING_INSIGHTS: 'settings_coaching_insights',
  ACHIEVEMENT_ALERTS: 'settings_achievement_alerts',
  QUIET_HOURS_ENABLED: 'settings_quiet_hours_enabled',
  QUIET_HOURS_START: 'settings_quiet_hours_start',
  QUIET_HOURS_END: 'settings_quiet_hours_end',
  CONNECTION_TIMEOUT: 'settings_connection_timeout',
} as const;
