# API Specification v1.0

## Overview

This document specifies the API design for Tizzy's ecosystem:
1. **Device-to-App API:** Communication between wearable device and mobile app
2. **App-to-Cloud API:** Mobile app to backend cloud services
3. **Therapist Dashboard API:** Web dashboard for clinicians and therapists
4. **External Integration APIs:** Modulate, speech-to-text, and future partners

All APIs are designed with privacy-first principles, encryption, authentication, and minimal data transmission.

---

## Design Principles

### 1. Privacy by Default
- Raw audio never transmitted unless explicitly enabled by user
- Features and embeddings preferred over raw data
- End-to-end encryption for sensitive data
- Minimal metadata collection

### 2. Offline-First
- Device continues capturing when phone disconnected
- App provides cached insights when cloud unavailable
- Sync when connectivity restored

### 3. Versioning and Backward Compatibility
- All APIs versioned (e.g., /v1/sessions)
- Breaking changes require new version
- Old versions supported for 12 months after deprecation notice

### 4. Rate Limiting and Abuse Prevention
- Per-user rate limits to prevent abuse
- Exponential backoff for retries
- DDoS protection at API gateway level

### 5. Security
- HTTPS/TLS 1.3 for all communication
- OAuth 2.0 for authentication
- JWT tokens with expiration and refresh
- API keys for device-cloud communication

---

## 1. Device-to-App API (Bluetooth LE)

### Overview
The wearable device communicates with the mobile app via Bluetooth Low Energy (BLE). This API handles data sync, device control, and firmware updates.

### Connection Protocol

**Service UUID:** `0000TIZZ-0000-1000-8000-00805F9B34FB` (custom Tizzy service)

**Characteristics:**

| Characteristic | UUID | Properties | Description |
|----------------|------|------------|-------------|
| Device Status | 0001 | Read, Notify | Battery level, storage used, firmware version |
| Command | 0002 | Write | Send commands (mute, unmute, mark moment, firmware update) |
| Feature Data Stream | 0003 | Notify | Stream feature vectors and metadata |
| Audio Clip Transfer | 0004 | Read | Transfer audio clips (if retention enabled) |
| Settings Sync | 0005 | Read, Write | Sync device settings (haptic intensity, privacy mode) |

---

### 1.1 Device Status

**Read Device Status**

Request: Read characteristic 0001

Response:
```json
{
  "device_id": "uuid",
  "firmware_version": "1.0.2",
  "battery_level": 78,
  "battery_charging": false,
  "storage_used_mb": 1234,
  "storage_total_mb": 8192,
  "uptime_seconds": 43200,
  "current_session_id": "uuid or null",
  "mute_state": "unmuted" | "muted" | "self_only",
  "haptics_enabled": true,
  "last_sync_timestamp": "ISO8601"
}
```

**Notify Device Status**

Device sends status update every 60 seconds or when significant change occurs (battery drops below 20%, storage >90%, etc.)

---

### 1.2 Command

**Send Command to Device**

Write to characteristic 0002:

```json
{
  "command": "mute" | "unmute" | "set_mode" | "mark_moment" | "start_firmware_update",
  "parameters": {
    // Command-specific parameters
  },
  "timestamp": "ISO8601"
}
```

**Commands:**

**Mute:**
```json
{
  "command": "mute",
  "parameters": {}
}
```

**Unmute / Set Mode:**
```json
{
  "command": "set_mode",
  "parameters": {
    "mode": "unmuted" | "self_only" | "muted"
  }
}
```

**Mark Moment** (user taps "this was confusing" in app):
```json
{
  "command": "mark_moment",
  "parameters": {
    "moment_type": "confused" | "uncomfortable" | "went_well" | "other",
    "timestamp": "ISO8601"
  }
}
```

**Start Firmware Update:**
```json
{
  "command": "start_firmware_update",
  "parameters": {
    "firmware_url": "https://...",
    "firmware_version": "1.0.3",
    "checksum": "sha256:..."
  }
}
```

Response (written to same characteristic):
```json
{
  "command": "mute",
  "status": "success" | "error",
  "error_message": "Optional error description"
}
```

---

### 1.3 Feature Data Stream

**Stream Feature Vectors**

Device notifies when new feature data is ready (every 5-60 seconds depending on conversation activity).

Notification payload:
```json
{
  "session_id": "uuid",
  "timestamp": "ISO8601",
  "packet_sequence": 123,
  "feature_vector": [0.12, 0.45, -0.67, ...],  // 128-256 dimensions, compressed
  "metadata": {
    "vad_active": true,
    "speaker_role": "wearer" | "other_1" | "other_2" | "unknown",
    "diarization_confidence": 0.87,
    "prosody": {
      "pace_wpm": 165,
      "pitch_mean_hz": 220,
      "intensity_mean_db": 68
    },
    "haptic_sent": {
      "pattern": "double_pulse",
      "timestamp": "ISO8601"
    }
  }
}
```

**Data Format:**
- Binary protocol (Protocol Buffers or similar) to minimize bandwidth
- Compressed using gzip or brotli
- Typical packet size: 500 bytes - 2KB

**Sync Strategy:**
- Stream continuously when phone in range
- Buffer on-device if phone disconnected (up to 4 hours)
- Resume sync when connection restored

---

### 1.4 Audio Clip Transfer

**Request Audio Clip** (only if retention enabled)

Write request to characteristic 0004:
```json
{
  "session_id": "uuid",
  "start_timestamp": "ISO8601",
  "end_timestamp": "ISO8601"
}
```

Device responds with audio data in chunks:
```json
{
  "session_id": "uuid",
  "clip_id": "uuid",
  "chunk_index": 0,
  "total_chunks": 45,
  "audio_data": "base64_encoded_opus_audio",
  "sample_rate": 16000,
  "channels": 1,
  "checksum": "sha256:..."
}
```

App reassembles chunks and verifies checksum.

**Encryption:**
- Audio data encrypted on-device before transmission
- Decryption key stored in app secure enclave

---

### 1.5 Settings Sync

**Read Device Settings**

Read characteristic 0005:
```json
{
  "haptic_intensity": "subtle" | "medium" | "strong",
  "haptic_patterns_enabled": {
    "single_pulse": true,
    "double_pulse": true,
    "long_pulse": true
  },
  "privacy_mode": "self_only" | "consented_conversation" | "muted",
  "led_indicator_enabled": true,
  "quiet_hours": {
    "enabled": true,
    "start_time": "22:00",
    "end_time": "08:00"
  },
  "audio_retention_enabled": false
}
```

**Write Device Settings**

Write to characteristic 0005 with updated settings (same JSON format).

---

## 2. App-to-Cloud API (RESTful + WebSocket)

### Overview
The mobile app communicates with cloud backend for:
- Syncing feature data and conversation sessions
- ML inference (post-conversation analysis)
- User profile and baseline storage
- Progress tracking and insights

### Base URL
- Production: `https://api.tizzy.app/v1`
- Staging: `https://api-staging.tizzy.app/v1`

### Authentication

**OAuth 2.0 with JWT Tokens**

**Login:**
```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "hashed_password",
  "device_info": {
    "platform": "iOS",
    "os_version": "17.2",
    "app_version": "1.0.5"
  }
}
```

Response:
```json
{
  "access_token": "jwt_token",
  "refresh_token": "refresh_token",
  "expires_in": 3600,
  "user_id": "uuid"
}
```

**Refresh Token:**
```http
POST /auth/refresh
Content-Type: application/json

{
  "refresh_token": "refresh_token"
}
```

**All subsequent requests include:**
```http
Authorization: Bearer <access_token>
```

---

### 2.1 User Profile

**Get User Profile**

```http
GET /users/{user_id}
```

Response:
```json
{
  "user_id": "uuid",
  "email": "user@example.com",
  "name": "Alex",
  "date_of_birth": "2005-03-15",
  "autism_diagnosis": true,
  "onboarding_completed": true,
  "baseline_established": true,
  "baseline_start_date": "2026-01-15",
  "account_created": "2026-01-10T12:00:00Z",
  "subscription_tier": "free" | "premium" | "institutional"
}
```

**Update User Profile**

```http
PATCH /users/{user_id}
Content-Type: application/json

{
  "name": "Alex Smith",
  "preferences": {
    "coaching_intensity": "moderate",
    "disabled_coaching_patterns": ["prosody"],
    "notification_preferences": {
      "daily_summary": true,
      "weekly_report": true
    }
  }
}
```

---

### 2.2 Conversation Sessions

**Create Session** (start of conversation)

```http
POST /sessions
Content-Type: application/json

{
  "device_id": "uuid",
  "start_time": "2026-02-13T14:30:00Z",
  "environment_tag": "school" | "home" | "therapy" | "work" | "public" | "other",
  "consent_mode": "self_only" | "consented_conversation" | "muted",
  "context_notes": "Lunch with Alex (optional)"
}
```

Response:
```json
{
  "session_id": "uuid",
  "status": "active",
  "created_at": "2026-02-13T14:30:05Z"
}
```

**Upload Feature Data**

```http
POST /sessions/{session_id}/features
Content-Type: application/json

{
  "features": [
    {
      "timestamp": "2026-02-13T14:30:10Z",
      "speaker_role": "wearer",
      "feature_vector": [0.12, 0.45, ...],
      "prosody": {
        "pace_wpm": 165,
        "pitch_mean_hz": 220,
        "intensity_mean_db": 68
      },
      "diarization_confidence": 0.87
    },
    // ... batch of features (up to 100 per request)
  ]
}
```

Response:
```json
{
  "received": 100,
  "session_id": "uuid",
  "status": "success"
}
```

**End Session**

```http
POST /sessions/{session_id}/end
Content-Type: application/json

{
  "end_time": "2026-02-13T14:38:22Z",
  "total_duration_seconds": 502,
  "speaker_count_estimate": 2
}
```

Response:
```json
{
  "session_id": "uuid",
  "status": "ended",
  "processing_started": true,
  "estimated_summary_ready_time": "2026-02-13T14:38:32Z"
}
```

**Get Session Summary**

```http
GET /sessions/{session_id}/summary
```

Response:
```json
{
  "session_id": "uuid",
  "summary": {
    "what_went_well": [
      "You asked 3 return questions—great reciprocity!",
      "You successfully repaired a confusion at 14:32"
    ],
    "what_to_improve": [
      "You spoke quickly when excited (180 wpm vs 140 baseline)",
      "You interrupted twice when discussing your project"
    ],
    "micro_goal": "Try pausing for 1 second after they finish speaking before you respond",
    "conversation_score": 72,
    "drill_suggestions": [
      {
        "skill": "turn_taking",
        "exercise": "Count '1 Mississippi' silently after they stop talking"
      }
    ]
  },
  "timeline": [
    {
      "timestamp": "2026-02-13T14:32:15Z",
      "moment_type": "confusion_detected",
      "severity": "medium",
      "explanation": "Long pause after you spoke—they might have been confused",
      "coaching_given": false
    },
    {
      "timestamp": "2026-02-13T14:32:18Z",
      "moment_type": "successful_repair",
      "severity": "low",
      "explanation": "You asked 'Does that make sense?' Good repair!",
      "coaching_given": false
    }
    // ... more moments
  ],
  "generated_at": "2026-02-13T14:38:30Z"
}
```

**List Sessions**

```http
GET /sessions?user_id={user_id}&limit=20&offset=0&start_date=2026-02-01&end_date=2026-02-13
```

Response:
```json
{
  "sessions": [
    {
      "session_id": "uuid",
      "start_time": "2026-02-13T14:30:00Z",
      "end_time": "2026-02-13T14:38:22Z",
      "duration_seconds": 502,
      "environment_tag": "school",
      "conversation_score": 72,
      "summary_available": true
    }
    // ... more sessions
  ],
  "total_count": 48,
  "has_more": true
}
```

**Delete Session**

```http
DELETE /sessions/{session_id}
```

Response:
```json
{
  "session_id": "uuid",
  "deleted": true,
  "deleted_at": "2026-02-13T15:00:00Z"
}
```

---

### 2.3 User Baseline

**Get User Baseline**

```http
GET /users/{user_id}/baseline
```

Response:
```json
{
  "user_id": "uuid",
  "baseline_version": "1.2",
  "established_date": "2026-01-22",
  "last_updated": "2026-02-10",
  "metrics": {
    "pace_wpm": {
      "mean": 142,
      "std": 18,
      "percentile_80": 158
    },
    "turn_length_seconds": {
      "mean": 12.5,
      "median": 10.2
    },
    "interruption_rate_per_conversation": {
      "mean": 3.8,
      "median": 3.0
    },
    "turn_taking_balance": {
      "mean_wearer_percentage": 58
    }
    // ... more metrics
  },
  "coaching_thresholds": {
    "pace_too_fast_wpm": 170,
    "monologuing_seconds": 45,
    "interruption_rate_threshold": 5
  }
}
```

---

### 2.4 Progress Tracking

**Get Weekly Progress**

```http
GET /users/{user_id}/progress/weekly?week=2026-W07
```

Response:
```json
{
  "user_id": "uuid",
  "period": "2026-W07",
  "week_start": "2026-02-10",
  "week_end": "2026-02-16",
  "metrics": {
    "conversation_count": 12,
    "total_hours": 3.2,
    "average_conversation_score": 68,
    "breakdown_rate": 0.13,
    "skills": {
      "turn_taking": {
        "score": 78,
        "trend": "improving",
        "change_percent": 12,
        "rank": "B+"
      },
      "topic_management": {
        "score": 65,
        "trend": "stable",
        "change_percent": -2,
        "rank": "C+"
      },
      "prosody": {
        "score": 82,
        "trend": "improving",
        "change_percent": 8,
        "rank": "A-"
      }
    }
  }
}
```

**Get Monthly Report**

```http
GET /users/{user_id}/progress/monthly?month=2026-02
```

Response (similar structure, aggregated over month).

---

### 2.5 Goals

**List Goals**

```http
GET /users/{user_id}/goals
```

Response:
```json
{
  "goals": [
    {
      "goal_id": "uuid",
      "user_id": "uuid",
      "goal_text": "Improve turn-taking and reduce interruptions",
      "target_skills": ["reciprocity", "turn_taking"],
      "target_metric": "interruption_rate",
      "current_value": 3.1,
      "target_value": 2.0,
      "progress_percent": 65,
      "deadline": "2026-05-01",
      "set_by": "parent",
      "set_by_user_id": "uuid",
      "status": "active",
      "created_at": "2026-01-15T12:00:00Z"
    }
  ]
}
```

**Create Goal**

```http
POST /users/{user_id}/goals
Content-Type: application/json

{
  "goal_text": "Ask more follow-up questions",
  "target_skills": ["reciprocity"],
  "target_metric": "return_question_rate",
  "target_value": 0.8,
  "deadline": "2026-04-01",
  "set_by": "user"
}
```

**Update Goal**

```http
PATCH /goals/{goal_id}
Content-Type: application/json

{
  "status": "achieved" | "paused" | "active",
  "target_value": 1.5
}
```

**Delete Goal**

```http
DELETE /goals/{goal_id}
```

---

### 2.6 Feedback

**Submit Feedback on Coaching Moment**

```http
POST /feedback
Content-Type: application/json

{
  "moment_id": "uuid",
  "session_id": "uuid",
  "feedback_type": "helpful" | "not_helpful" | "unsure",
  "comment": "This was really helpful! (optional)"
}
```

**Submit Feedback on Haptic**

```http
POST /feedback/haptic
Content-Type: application/json

{
  "haptic_timestamp": "2026-02-13T14:35:12Z",
  "session_id": "uuid",
  "haptic_pattern": "double_pulse",
  "feedback": "helpful" | "not_helpful" | "unsure",
  "comment": "I wasn't sure what this meant (optional)"
}
```

---

### 2.7 Therapist Sharing

**Grant Therapist Access to Session**

```http
POST /sessions/{session_id}/share
Content-Type: application/json

{
  "therapist_email": "therapist@clinic.com",
  "access_level": "read_summary" | "read_timeline" | "read_full",
  "expiration_date": "2026-03-01"
}
```

Response:
```json
{
  "share_id": "uuid",
  "shared_with": "therapist@clinic.com",
  "access_granted": true,
  "share_url": "https://dashboard.tizzy.app/shared/{share_token}"
}
```

**Revoke Therapist Access**

```http
DELETE /sessions/{session_id}/share/{share_id}
```

---

### 2.8 Data Export and Deletion

**Request Data Export**

```http
POST /users/{user_id}/export
Content-Type: application/json

{
  "format": "json" | "csv",
  "include_audio": false
}
```

Response:
```json
{
  "export_id": "uuid",
  "status": "processing",
  "estimated_ready_time": "2026-02-13T15:30:00Z"
}
```

**Check Export Status**

```http
GET /exports/{export_id}
```

Response:
```json
{
  "export_id": "uuid",
  "status": "ready" | "processing" | "failed",
  "download_url": "https://...",
  "expires_at": "2026-02-14T15:30:00Z"
}
```

**Request Account Deletion**

```http
DELETE /users/{user_id}
Content-Type: application/json

{
  "confirm": true,
  "reason": "optional feedback"
}
```

Response:
```json
{
  "user_id": "uuid",
  "deletion_scheduled": true,
  "deletion_date": "2026-02-20T00:00:00Z",
  "cancellation_deadline": "2026-02-19T23:59:59Z"
}
```

---

### 2.9 Real-Time Updates (WebSocket)

For live updates (e.g., conversation score updating in real-time), use WebSocket connection.

**Connect:**
```
wss://api.tizzy.app/v1/ws?token={jwt_token}
```

**Subscribe to Session Updates:**
```json
{
  "action": "subscribe",
  "session_id": "uuid"
}
```

**Receive Updates:**
```json
{
  "event": "moment_detected",
  "session_id": "uuid",
  "moment": {
    "timestamp": "2026-02-13T14:35:12Z",
    "moment_type": "good_reciprocity",
    "explanation": "You asked a return question!"
  }
}
```

---

## 3. Therapist Dashboard API

### Overview
Web-based dashboard for clinicians to view client progress, annotate sessions, and export reports.

### Base URL
`https://dashboard.tizzy.app/api/v1`

### Authentication
Same OAuth 2.0 + JWT as app-to-cloud API, but with therapist role.

---

### 3.1 Clients

**List Clients**

```http
GET /therapist/{therapist_id}/clients
```

Response:
```json
{
  "clients": [
    {
      "user_id": "uuid",
      "name": "Alex S.",
      "age": 21,
      "consent_granted": true,
      "consent_date": "2026-01-15",
      "last_session": "2026-02-13T14:38:22Z",
      "total_sessions": 48,
      "current_goals": 2
    }
  ]
}
```

**Get Client Details**

```http
GET /therapist/{therapist_id}/clients/{client_user_id}
```

Response:
```json
{
  "user_id": "uuid",
  "name": "Alex S.",
  "age": 21,
  "consent_granted": true,
  "baseline": { /* baseline data */ },
  "recent_progress": { /* weekly/monthly progress */ },
  "goals": [ /* goals list */ ],
  "recent_sessions": [ /* session list */ ]
}
```

---

### 3.2 Session Review

**Get Session for Review**

```http
GET /therapist/{therapist_id}/sessions/{session_id}
```

Response: Same as app-to-cloud `/sessions/{session_id}/summary`, plus:
```json
{
  "therapist_annotations": [
    {
      "annotation_id": "uuid",
      "timestamp": "2026-02-13T14:32:15Z",
      "therapist_note": "Good example of perspective-taking. Discuss in next session.",
      "created_at": "2026-02-13T16:00:00Z"
    }
  ]
}
```

**Add Annotation**

```http
POST /therapist/{therapist_id}/sessions/{session_id}/annotations
Content-Type: application/json

{
  "timestamp": "2026-02-13T14:32:15Z",
  "note": "Good example of perspective-taking. Discuss in next session.",
  "flag_for_discussion": true
}
```

---

### 3.3 Goal Management

Therapists can create/update goals for clients (same endpoints as user goals, with therapist authentication).

---

### 3.4 Reports

**Generate Client Report**

```http
POST /therapist/{therapist_id}/clients/{client_user_id}/reports
Content-Type: application/json

{
  "report_type": "monthly" | "custom",
  "start_date": "2026-01-01",
  "end_date": "2026-01-31",
  "format": "pdf" | "json"
}
```

Response:
```json
{
  "report_id": "uuid",
  "status": "processing",
  "estimated_ready_time": "2026-02-13T15:05:00Z"
}
```

**Download Report**

```http
GET /reports/{report_id}/download
```

Returns PDF or JSON file.

---

## 4. External Integration APIs

### 4.1 Modulate API Integration

Tizzy integrates with Modulate's Ensemble Listening Model (ELM) for voice intent and tone understanding.

**Endpoint:** `https://api.modulate.ai/v1/analyze` (example, actual endpoint TBD)

**Request:**
```http
POST /v1/analyze
Authorization: Bearer {modulate_api_key}
Content-Type: application/json

{
  "audio_embedding": [0.12, 0.45, ...],
  "prosody_features": {
    "pace_wpm": 165,
    "pitch_mean_hz": 220,
    "intensity_mean_db": 68
  },
  "context": {
    "speaker_count": 2,
    "environment": "conversational"
  }
}
```

**Response:**
```json
{
  "intent": "statement",
  "intent_confidence": 0.89,
  "emotion": {
    "neutral": 0.60,
    "positive": 0.25,
    "negative": 0.10,
    "frustrated": 0.05
  },
  "conversational_signals": {
    "interest": 0.78,
    "disengagement": 0.12,
    "confusion": 0.10,
    "rapport": 0.65
  }
}
```

**Error Handling:**
- If Modulate API unavailable, fall back to on-device lightweight model
- Cache Modulate results for similar patterns (reduce API costs)
- Monitor API usage and costs

---

### 4.2 Speech-to-Text Integration (Optional)

When user enables transcription, use Whisper API or Deepgram.

**Example: Whisper API**

```http
POST https://api.openai.com/v1/audio/transcriptions
Authorization: Bearer {openai_api_key}
Content-Type: multipart/form-data

{
  "file": audio_file.opus,
  "model": "whisper-1",
  "language": "en"
}
```

Response:
```json
{
  "text": "This is the transcribed conversation..."
}
```

**Privacy Note:**
- Only send audio to STT provider if user explicitly enables transcription
- Inform user that audio is sent to third party
- Option to use on-device STT in future (iOS: Speech framework, Android: Speech-to-Text)

---

## 5. API Security and Best Practices

### 5.1 Rate Limiting

**Per-User Limits:**
- 1000 requests per hour per user
- 100 session uploads per day per user
- 10 data export requests per day per user

**Exceed Limit Response:**
```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json

{
  "error": "rate_limit_exceeded",
  "message": "You have exceeded your request limit. Try again in 15 minutes.",
  "retry_after": 900
}
```

### 5.2 Error Responses

**Standard Error Format:**
```json
{
  "error": "error_code",
  "message": "Human-readable error description",
  "details": {
    "field": "specific_field_with_error",
    "reason": "detailed_reason"
  },
  "request_id": "uuid",
  "timestamp": "ISO8601"
}
```

**Common Error Codes:**
- `authentication_failed`: Invalid or expired token
- `authorization_failed`: User doesn't have permission
- `resource_not_found`: Session, user, or resource doesn't exist
- `validation_error`: Invalid request parameters
- `rate_limit_exceeded`: Too many requests
- `internal_server_error`: Backend failure
- `service_unavailable`: Temporary outage

### 5.3 Logging and Monitoring

**Request Logging:**
- Log all API requests with: user_id, endpoint, timestamp, response_code, latency
- Do NOT log request bodies containing sensitive data (audio, embeddings)

**Error Tracking:**
- Track 5xx errors and alert on-call engineer
- Track 4xx errors for abuse detection (repeated 401s = potential attack)

**Performance Monitoring:**
- Track API latency: p50, p95, p99
- Alert if p95 latency > 2 seconds

### 5.4 API Deprecation Policy

When deprecating an API version:
1. Announce deprecation 6 months in advance
2. Send in-app notifications to affected users
3. Continue supporting old version for 12 months
4. Provide migration guide and tools

---

## 6. API Versioning Strategy

**URL Versioning:**
- `/v1/sessions`, `/v2/sessions`, etc.

**Breaking Changes:**
- Removing fields from responses
- Changing required request parameters
- Changing authentication mechanism

**Non-Breaking Changes (Same Version):**
- Adding new optional fields
- Adding new endpoints
- Expanding enum values (if client code is forward-compatible)

**Current Version:** v1 (stable)

---

## 7. Testing and Documentation

### 7.1 API Documentation

**Tools:**
- OpenAPI/Swagger spec for all REST endpoints
- Auto-generated documentation hosted at `https://docs.tizzy.app/api`
- Interactive API explorer (Swagger UI)

### 7.2 Testing

**Unit Tests:**
- Test each endpoint handler independently
- Mock database and external APIs

**Integration Tests:**
- Test full request-response cycle
- Test authentication and authorization
- Test error handling (invalid tokens, missing parameters)

**Load Tests:**
- Simulate 1000 concurrent users
- Measure API latency and throughput
- Identify bottlenecks

---

## 8. Future API Enhancements

### 8.1 GraphQL API (V2)

Consider GraphQL for more flexible queries (e.g., fetch user + sessions + progress in single request).

### 8.2 Public API for Researchers

Allow researchers to query aggregated, anonymized data (with ethics board approval).

**Example:**
```http
GET /public/v1/aggregated-stats?cohort=college_students&metric=turn_taking_improvement
```

### 8.3 Webhooks

Allow therapist dashboards or external systems to subscribe to events (e.g., "client had breakthrough moment").

**Example:**
```http
POST https://therapist-system.com/webhook
Content-Type: application/json

{
  "event": "goal_achieved",
  "user_id": "uuid",
  "goal_id": "uuid",
  "achieved_at": "2026-03-15T14:00:00Z"
}
```

---

## 9. Open Questions

1. **Audio Retention API:**
   - Should there be an API for streaming audio clips to therapist dashboard?
   - Privacy risk: How to ensure consent and encryption?

2. **Multi-Device Support:**
   - If user has multiple devices (necklace + earring), how to handle session merging?

3. **Family Accounts:**
   - Should parent account have API access to child's data? (Requires COPPA compliance)

4. **Third-Party Integrations:**
   - Should Tizzy provide OAuth for third-party apps (e.g., school IEP tracking systems)?

5. **Real-Time Coaching Feedback Loop:**
   - Should therapists be able to send real-time coaching suggestions to user during session?
   - Ethical concern: Could this be intrusive or overwhelming?

---

## Conclusion

Tizzy's API architecture is designed for:
- **Privacy:** Minimal data transmission, encryption, user control
- **Performance:** Low latency, offline-first, efficient sync
- **Scalability:** Handle 10K+ users with minimal backend strain
- **Extensibility:** Easy to add new features and integrations

The API serves three primary stakeholders:
1. **Users:** Real-time coaching, post-conversation insights, progress tracking
2. **Therapists:** Client monitoring, annotation, reporting
3. **Researchers/Partners:** Aggregated data, integrations (future)

Success metrics:
- API latency p95 < 500ms for critical endpoints
- 99.9% uptime for user-facing APIs
- Zero data breaches or privacy violations
- Therapist adoption: >50% of institutional users utilize dashboard

This specification provides a foundation for building a robust, secure, and user-centric API ecosystem that scales with Tizzy's growth while maintaining unwavering commitment to privacy and user trust.
