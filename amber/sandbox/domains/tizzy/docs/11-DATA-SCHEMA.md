# Conversation Output Schema

**Document Version:** 1.0
**Last Updated:** February 13, 2026
**Status:** V1 Technical Specification

---

## Overview

This document defines the complete data schema for Tizzy's conversation analysis pipeline. The schema is designed to be ambitious yet realistic for V1 (without video), capturing acoustic and conversational patterns that matter for autism coaching. All data structures are JSON-serializable for API communication and storage.

---

## Schema Design Principles

1. **Privacy by Design:** Schema separates personally identifiable information (PII) from conversational features
2. **Confidence Scoring:** Every model output includes confidence; low confidence triggers clarification rather than false coaching
3. **Auditability:** Every coaching action traceable to specific features and model decisions
4. **Extensibility:** Schema allows adding new features without breaking existing clients
5. **Therapist-Readable:** Field names and values understandable by speech-language pathologists

---

## Core Data Types

### Timestamp Format
All timestamps use ISO 8601 format with millisecond precision in UTC:
```
"2026-02-13T14:32:45.123Z"
```

### UUID Format
All IDs use UUIDv4 for uniqueness:
```
"550e8400-e29b-41d4-a716-446655440000"
```

### Confidence Score
Float between 0.0 and 1.0:
- `< 0.5`: Low confidence, model uncertain
- `0.5 - 0.75`: Medium confidence, likely accurate
- `> 0.75`: High confidence, use for coaching

---

## 1. Conversation Session Schema

**Purpose:** Top-level container for a discrete conversation period

```json
{
  "session_id": "sess_550e8400",
  "user_id": "user_a1b2c3d4",
  "device_id": "dev_xyz789",
  "start_time": "2026-02-13T14:00:00.000Z",
  "end_time": "2026-02-13T14:15:30.500Z",
  "duration_seconds": 930.5,

  "environment": {
    "type": "school_cafeteria",
    "noise_level": "moderate",
    "estimated_participants": 3,
    "user_labeled": true
  },

  "consent_mode": "CONVERSATION",
  "recording_enabled": false,

  "device_state": {
    "battery_percent": 78,
    "firmware_version": "1.0.3",
    "microphone_quality": "good",
    "under_clothing": true
  },

  "speaker_stats": {
    "total_speakers_estimated": 3,
    "wearer_turn_count": 12,
    "other_turn_count": 15,
    "overlapping_speech_seconds": 23.5,
    "silence_seconds": 145.2
  },

  "summary": {
    "conversation_type": "CASUAL_SOCIAL",
    "primary_topics": ["weekend_plans", "lunch_food", "video_games"],
    "overall_quality_score": 0.72,
    "reciprocity_score": 0.68,
    "wearer_engagement_level": "MODERATE"
  },

  "turns": [ /* Array of Turn objects, see section 2 */ ],
  "moments": [ /* Array of Moment objects, see section 3 */ ],
  "haptic_events": [ /* Array of Haptic objects, see section 4 */ ],
  "user_markers": [ /* Array of UserMarker objects, see section 5 */ ],

  "coaching_summary": { /* See section 6 */ },

  "metadata": {
    "created_at": "2026-02-13T14:15:35.000Z",
    "synced_at": "2026-02-13T14:20:12.000Z",
    "analysis_version": "v1.2.0",
    "flags": ["muffled_audio_detected", "baseline_learning_period"]
  }
}
```

### Field Definitions

**session_id:** Unique identifier for this conversation session

**environment.type:** Enum values:
- `home`, `school_classroom`, `school_cafeteria`, `school_hallway`, `school_playground`
- `therapy_office`, `public_indoor`, `public_outdoor`, `workplace`, `unknown`

**consent_mode:** Enum values:
- `SELF_ONLY`: Capturing only wearer's voice (privacy-first mode)
- `CONVERSATION`: Multi-speaker capture with consent
- `AMBIENT`: Background audio context, no speech processing
- `MUTED`: Recording disabled

**speaker_stats.overlapping_speech_seconds:** Total time multiple speakers talking simultaneously (interruption proxy)

**summary.conversation_type:** Enum values:
- `CASUAL_SOCIAL`, `STRUCTURED_TASK`, `THERAPY_SESSION`, `CLASSROOM_DISCUSSION`, `ONE_ON_ONE`, `GROUP`, `PRESENTATION`, `UNKNOWN`

**summary.reciprocity_score:**
- Ratio of balanced turn-taking, 0.0 (completely one-sided) to 1.0 (perfectly balanced)
- Algorithm: `1 - abs(0.5 - (wearer_turns / total_turns))`

---

## 2. Turn Schema

**Purpose:** Individual speaking turn by a participant

```json
{
  "turn_id": "turn_1a2b3c4d",
  "session_id": "sess_550e8400",
  "turn_index": 5,

  "speaker": {
    "role": "WEARER",
    "confidence": 0.89,
    "voice_signature_match": 0.92
  },

  "timing": {
    "start_time": "2026-02-13T14:03:22.100Z",
    "end_time": "2026-02-13T14:03:28.600Z",
    "duration_seconds": 6.5,
    "inter_turn_gap_seconds": 1.2,
    "follows_turn_id": "turn_0z9y8x7w"
  },

  "prosody": {
    "mean_pitch_hz": 185.3,
    "pitch_range_hz": 45.7,
    "pitch_variance": 22.1,
    "pitch_contour": "RISING",

    "speech_rate_syllables_per_sec": 4.8,
    "articulation_rate_syllables_per_sec": 5.2,

    "mean_intensity_db": -18.5,
    "intensity_variance_db": 8.2,
    "intensity_trend": "INCREASING",

    "pause_count": 2,
    "mean_pause_duration_sec": 0.4,
    "max_pause_duration_sec": 0.7,
    "voiced_unvoiced_ratio": 0.78
  },

  "voice_quality": {
    "jitter_percent": 0.8,
    "shimmer_db": 0.3,
    "harmonic_noise_ratio_db": 18.5,
    "spectral_centroid_hz": 1250,
    "breathiness": 0.3,
    "tension": 0.4
  },

  "overlap": {
    "has_overlap": true,
    "overlap_duration_sec": 1.2,
    "overlap_position": "END",
    "interrupted_other": true,
    "was_interrupted": false
  },

  "transcript": {
    "available": false,
    "text": null,
    "confidence": null,
    "model": null
  },

  "semantic": {
    "intent": "STATEMENT",
    "emotion": "NEUTRAL",
    "topic": "video_games",
    "contains_question": false,
    "contains_clarification": false,
    "contains_agreement": true
  },

  "coaching_flags": [
    {
      "flag": "SPEAKING_TOO_FAST",
      "confidence": 0.82,
      "threshold_exceeded": 1.3,
      "baseline_comparison": "33% faster than user's baseline"
    }
  ]
}
```

### Field Definitions

**speaker.role:** Enum values:
- `WEARER`: User wearing the device
- `OTHER_SPEAKER`: Other participant(s) in conversation
- `MULTIPLE`: Cannot distinguish (poor audio or simultaneous speech)
- `UNCERTAIN`: Diarization low confidence

**timing.inter_turn_gap_seconds:**
- Time between end of previous turn and start of this turn
- Negative value indicates overlap (interruption)

**prosody.pitch_contour:** Enum values:
- `FLAT`, `RISING`, `FALLING`, `RISE_FALL`, `FALL_RISE`, `VARIABLE`

**prosody.speech_rate_syllables_per_sec:**
- Total syllables / total duration (including pauses)
- Typical range: 3-6 sps

**prosody.articulation_rate_syllables_per_sec:**
- Total syllables / speaking time (excluding pauses)
- Higher than speech_rate

**voice_quality.jitter_percent:**
- Pitch perturbation, indicator of vocal strain or stress
- Normal: <1%, Elevated: 1-2%, High: >2%

**voice_quality.harmonic_noise_ratio_db:**
- Voice clarity measure
- Normal: >15dB, Strained: 10-15dB, Very strained: <10dB

**overlap.overlap_position:** Enum values:
- `START`: This turn started before previous turn ended
- `MIDDLE`: Overlap occurred mid-turn
- `END`: This turn continued as next turn started

**semantic.intent:** Enum values:
- `STATEMENT`, `QUESTION`, `COMMAND`, `EXCLAMATION`, `ACKNOWLEDGMENT`, `CLARIFICATION`, `UNCERTAIN`

**semantic.emotion:** Enum values (from Modulate ELM or equivalent):
- `NEUTRAL`, `HAPPY`, `SAD`, `ANGRY`, `EXCITED`, `ANXIOUS`, `FRUSTRATED`, `CONFUSED`, `SARCASTIC`, `UNCERTAIN`

**coaching_flags:** Array of detected patterns for this turn
- Each flag links to a coaching action (haptic, insight, or micro-goal)

---

## 3. Moment Schema

**Purpose:** Significant conversational events detected by ML models

```json
{
  "moment_id": "moment_5f6g7h8i",
  "session_id": "sess_550e8400",
  "timestamp": "2026-02-13T14:05:45.300Z",
  "type": "CONFUSION_DETECTED",
  "confidence": 0.78,

  "context": {
    "turns_involved": ["turn_1a2b3c4d", "turn_2b3c4d5e"],
    "duration_seconds": 8.5,
    "speakers": ["WEARER", "OTHER_SPEAKER"]
  },

  "signals": [
    {
      "signal_type": "LONG_PAUSE_AFTER_WEARER_TURN",
      "value": 3.2,
      "unit": "seconds",
      "weight": 0.6
    },
    {
      "signal_type": "OTHER_SPEAKER_CLARIFYING_QUESTION",
      "detected": true,
      "weight": 0.8
    },
    {
      "signal_type": "PROSODY_MISMATCH",
      "description": "Flat tone for emotionally-laden topic",
      "weight": 0.4
    }
  ],

  "classification": {
    "model_name": "tizzy_confusion_detector_v1.2",
    "model_version": "1.2.0",
    "primary_label": "LIKELY_CONFUSION",
    "secondary_labels": ["MISSED_REPAIR_OPPORTUNITY"],
    "confidence_breakdown": {
      "acoustic_confidence": 0.71,
      "temporal_confidence": 0.85,
      "semantic_confidence": 0.68,
      "combined_confidence": 0.78
    }
  },

  "coaching_action": {
    "action_type": "INSIGHT_GENERATED",
    "message": "When your friend paused for 3 seconds after your explanation, they might have been confused. Try asking: 'Does that make sense?'",
    "micro_goal": "After explaining something, pause and check understanding.",
    "haptic_triggered": false
  },

  "user_feedback": {
    "user_confirmed": true,
    "feedback_timestamp": "2026-02-13T15:30:00.000Z",
    "comment": "Yeah, I didn't notice they were confused."
  }
}
```

### Field Definitions

**type:** Enum values:
- `CONFUSION_DETECTED`, `ESCALATION_DETECTED`, `REPAIR_ATTEMPTED`, `REPAIR_SUCCESSFUL`, `MISSED_REPAIR_OPPORTUNITY`
- `TOPIC_DRIFT`, `ABRUPT_TOPIC_SHIFT`, `TOPIC_MAINTAINED_WELL`
- `ONE_SIDED_WEARER`, `ONE_SIDED_OTHER`, `BALANCED_RECIPROCITY`
- `LITERAL_INTERPRETATION`, `MISSED_SARCASM`, `MISSED_IMPLIED_MEANING`
- `OVERSHARING_RISK`, `BOUNDARY_ISSUE`, `AWKWARD_SILENCE`
- `POSITIVE_MOMENT`, `SUCCESSFUL_QUESTION_ASKING`, `GOOD_CLARIFICATION`
- `OVERLOAD_RISK`, `STRESS_DETECTED`, `GRACEFUL_EXIT`

**signals:** Array of evidence pieces contributing to classification
- Transparent ML: show why model made this decision
- Enables therapist review and model debugging

**classification.confidence_breakdown:**
- Shows contribution from different feature types
- Helps diagnose model weaknesses

**coaching_action.action_type:** Enum values:
- `HAPTIC_TRIGGERED`: Real-time vibration sent to device
- `INSIGHT_GENERATED`: Post-conversation coaching message
- `MICRO_GOAL_SUGGESTED`: Tomorrow's practice goal
- `NO_ACTION`: Logged but not surfaced to user (low confidence or low priority)

**user_feedback:**
- Critical for model improvement
- Tracks whether coaching was helpful

---

## 4. Haptic Event Schema

**Purpose:** Log of real-time haptic feedback delivered during conversation

```json
{
  "haptic_id": "hap_9j0k1l2m",
  "session_id": "sess_550e8400",
  "timestamp": "2026-02-13T14:07:12.400Z",

  "pattern": "DOUBLE_PULSE",
  "intensity": 1.2,
  "duration_ms": 400,

  "trigger": {
    "reason": "ONE_SIDED_WEARER",
    "confidence": 0.84,
    "model": "tizzy_reciprocity_detector_v1.0"
  },

  "context": {
    "wearer_turn_count_since_last_other": 5,
    "time_since_last_other_turn_sec": 78,
    "conversation_duration_so_far_sec": 120
  },

  "outcome": {
    "next_turn_speaker": "OTHER_SPEAKER",
    "seconds_until_next_turn": 4.2,
    "user_changed_behavior": true,
    "effectiveness_score": 0.78
  },

  "user_feedback": {
    "provided": true,
    "rating": "HELPFUL",
    "timestamp": "2026-02-13T15:32:00.000Z"
  }
}
```

### Field Definitions

**pattern:** Enum values (matches hardware spec):
- `SINGLE_PULSE`: Pacing or volume adjustment cue
- `DOUBLE_PULSE`: Reciprocity or question-asking cue
- `LONG_PULSE`: Escalation or overload warning

**intensity:** G-force (0.5 to 2.0)

**trigger.reason:** Enum values (maps to coaching taxonomy):
- `SPEAKING_TOO_FAST`, `SPEAKING_TOO_SLOW`, `SPEAKING_TOO_LOUD`
- `ONE_SIDED_WEARER`, `MONOLOGUING`
- `ESCALATION_DETECTED`, `OVERLOAD_RISK`

**outcome.effectiveness_score:**
- Did wearer change behavior after haptic?
- Algorithm: if next turn is OTHER_SPEAKER within 10 seconds, score = 0.8+
- Used for personalization: reduce haptic sensitivity if ineffective

**user_feedback.rating:** Enum values:
- `HELPFUL`, `NEUTRAL`, `ANNOYING`, `CONFUSING`, `MISSED_IT`

---

## 5. User Marker Schema

**Purpose:** User-initiated annotations during conversation

```json
{
  "marker_id": "mark_3n4o5p6q",
  "session_id": "sess_550e8400",
  "timestamp": "2026-02-13T14:09:30.100Z",

  "type": "BUTTON_PRESS",
  "label": "INTERESTING_MOMENT",

  "context": {
    "turn_at_marker": "turn_7r8s9t0u",
    "speaker_at_marker": "OTHER_SPEAKER",
    "preceding_turns": 3,
    "following_turns": 2
  },

  "audio_retention": {
    "enabled": true,
    "snippet_start": "2026-02-13T14:09:25.000Z",
    "snippet_end": "2026-02-13T14:09:35.000Z",
    "duration_seconds": 10.0,
    "audio_url": "s3://tizzy-audio/user_a1b2c3d4/snippet_3n4o5p6q.enc"
  },

  "user_annotation": {
    "added_later": true,
    "note": "I think I missed a joke here",
    "annotation_timestamp": "2026-02-13T15:35:00.000Z"
  },

  "ml_analysis": {
    "analyzed": true,
    "detected_patterns": ["SARCASM_DETECTED", "FLAT_PROSODY_RESPONSE"],
    "coaching_insight": "Your friend was joking (laughing tone), but you responded seriously. Listen for changes in their tone to catch humor."
  }
}
```

### Field Definitions

**type:** Enum values:
- `BUTTON_PRESS`: User tapped device button
- `APP_MARKER`: User marked moment in app during replay
- `AUTO_FLAGGED`: System auto-saved due to high-interest pattern

**label:** Enum values:
- `INTERESTING_MOMENT`, `CONFUSING_MOMENT`, `WENT_WELL`, `WENT_POORLY`, `OVERLOAD`, `MISSED_CUE`

**audio_retention.audio_url:**
- Pre-signed S3 URL for encrypted audio snippet
- Expires after 7 days unless user extends
- Only exists if user opted into audio retention

---

## 6. Coaching Summary Schema

**Purpose:** Post-conversation insights generated by coaching engine

```json
{
  "summary_id": "coach_7v8w9x0y",
  "session_id": "sess_550e8400",
  "generated_at": "2026-02-13T14:16:00.000Z",
  "model_version": "coaching_engine_v1.3",

  "insights": {
    "what_went_well": [
      {
        "insight": "You asked two follow-up questions during the lunch conversation, which kept the dialogue balanced.",
        "supporting_moments": ["moment_5f6g7h8i", "moment_8i9j0k1l"],
        "confidence": 0.91
      },
      {
        "insight": "When your friend seemed confused, you paused and clarified your point—great repair skill!",
        "supporting_moments": ["moment_2m3n4o5p"],
        "confidence": 0.87
      }
    ],

    "what_to_improve": [
      {
        "insight": "There were three moments where you spoke for over a minute without checking if the listener was following. Try shorter turns tomorrow.",
        "supporting_moments": ["moment_6q7r8s9t", "moment_9t0u1v2w", "moment_2w3x4y5z"],
        "skill_area": "TURN_TAKING",
        "priority": "HIGH",
        "confidence": 0.85
      },
      {
        "insight": "You missed a chance to ask about your friend's weekend when they mentioned it. Practice asking return questions.",
        "supporting_moments": ["moment_5z6a7b8c"],
        "skill_area": "RECIPROCITY",
        "priority": "MEDIUM",
        "confidence": 0.72
      }
    ],

    "micro_goal": {
      "goal": "Tomorrow, after speaking for 20-30 seconds, pause and ask: 'Does that make sense?' or 'What do you think?'",
      "skill_area": "REPAIR_AND_CLARIFICATION",
      "measurable": true,
      "expected_frequency": "3-5 times per conversation",
      "success_criteria": "Listener responds with confirmation or clarifying question"
    }
  },

  "metrics": {
    "conversation_quality_score": 0.72,
    "reciprocity_score": 0.68,
    "pacing_score": 0.65,
    "repair_skill_score": 0.80,
    "topic_maintenance_score": 0.75,

    "comparison_to_baseline": {
      "reciprocity": "15% below your typical baseline",
      "pacing": "20% faster than your comfortable pace",
      "repair": "10% better than last week"
    },

    "goal_progress": [
      {
        "goal_id": "goal_user123_1",
        "goal_name": "Ask more return questions",
        "progress_this_session": 0.6,
        "weekly_trend": "IMPROVING",
        "on_track": true
      }
    ]
  },

  "recommended_actions": [
    {
      "action": "PRACTICE_DRILL",
      "title": "Checking Understanding Practice",
      "description": "Practice pausing after explanations and asking: 'Does that make sense?', 'Should I explain differently?', or 'What do you think?'",
      "estimated_time_minutes": 5,
      "priority": "HIGH"
    },
    {
      "action": "REVIEW_MOMENT",
      "title": "Review the 'missed joke' moment",
      "moment_id": "moment_5f6g7h8i",
      "reason": "You marked this as confusing. Let's break down what happened.",
      "priority": "MEDIUM"
    }
  ],

  "therapist_notes": {
    "shareable": true,
    "summary_for_clinician": "Patient showed good repair skills but struggled with turn-taking balance. Recommend continuing focus on pause-and-check strategy.",
    "clinical_observations": [
      "Reciprocity below baseline—may indicate fatigue or high-stress environment",
      "Repair skill improvement observed—coaching is effective"
    ]
  }
}
```

### Field Definitions

**insights.what_went_well / what_to_improve:**
- Limited to 2 items each (avoid overwhelming user)
- Ordered by priority (most important first)
- Each linked to supporting moments (auditability)

**insights.micro_goal:**
- Single actionable goal for tomorrow
- Must be specific, measurable, achievable
- Aligned with user's focus areas

**metrics.comparison_to_baseline:**
- All comparisons relative to user's personal baseline, not population
- Prevents coaching toward neurotypical "norm" (anti-masking principle)

**skill_area:** Enum values (maps to coaching taxonomy):
- `TURN_TAKING`, `RECIPROCITY`, `TOPIC_MAINTENANCE`, `REPAIR_AND_CLARIFICATION`
- `PACING_AND_PROSODY`, `EMOTIONAL_CALIBRATION`, `BOUNDARY_AWARENESS`
- `THEORY_OF_MIND`, `NONVERBAL_CUE_DETECTION`, `STRESS_MANAGEMENT`

**recommended_actions.action:** Enum values:
- `PRACTICE_DRILL`: Interactive roleplay or exercise
- `REVIEW_MOMENT`: Watch/listen to a specific moment
- `READ_TIP`: Educational content about a skill
- `THERAPIST_CONSULT`: Suggest discussing with clinician

---

## 7. User Profile Schema

**Purpose:** Long-term user data for personalization

```json
{
  "user_id": "user_a1b2c3d4",
  "created_at": "2026-01-15T10:00:00.000Z",
  "updated_at": "2026-02-13T14:20:00.000Z",

  "demographics": {
    "age_range": "18_25",
    "diagnosis": "AUTISM_SELF_REPORTED",
    "support_needs": "LEVEL_1",
    "co_occurring": ["ADHD", "ANXIETY"]
  },

  "baseline": {
    "established": true,
    "baseline_period_start": "2026-01-15T00:00:00.000Z",
    "baseline_period_end": "2026-01-22T00:00:00.000Z",
    "total_conversations_analyzed": 47,

    "conversational_norms": {
      "mean_speech_rate_sps": 4.2,
      "mean_pitch_hz": 175,
      "mean_turn_duration_sec": 12.5,
      "mean_reciprocity_ratio": 0.65,
      "typical_pause_duration_sec": 0.35,
      "weekly_conversation_hours": 8.3
    },

    "variability": {
      "speech_rate_std": 0.8,
      "turn_duration_std": 5.2,
      "context_dependent_variance": {
        "school": 1.2,
        "home": 0.6,
        "therapy": 0.3
      }
    }
  },

  "goals": [
    {
      "goal_id": "goal_user123_1",
      "skill_area": "RECIPROCITY",
      "goal_text": "Ask more return questions to balance conversations",
      "priority": 1,
      "set_by": "USER",
      "set_at": "2026-01-15T11:00:00.000Z",
      "target_metric": "reciprocity_score > 0.75",
      "current_progress": 0.42,
      "weekly_trend": "IMPROVING",
      "milestones": [
        {
          "milestone": "7-day streak of asking 3+ return questions",
          "achieved": true,
          "achieved_at": "2026-02-10T00:00:00.000Z"
        }
      ]
    },
    {
      "goal_id": "goal_user123_2",
      "skill_area": "REPAIR_AND_CLARIFICATION",
      "goal_text": "Notice when others are confused and clarify",
      "priority": 2,
      "set_by": "THERAPIST",
      "set_at": "2026-01-20T14:30:00.000Z",
      "target_metric": "repair_skill_score > 0.70",
      "current_progress": 0.18,
      "weekly_trend": "STABLE"
    }
  ],

  "preferences": {
    "haptic_enabled": true,
    "haptic_sensitivity": 0.8,
    "haptic_patterns_enabled": ["SINGLE_PULSE", "DOUBLE_PULSE", "LONG_PULSE"],
    "audio_retention_default": false,
    "quiet_hours": {
      "enabled": true,
      "start_time": "22:00",
      "end_time": "07:00",
      "timezone": "America/New_York"
    },
    "notification_preferences": {
      "post_conversation_insights": "IMMEDIATE",
      "daily_summary": "18:00",
      "weekly_report": "SUNDAY_10:00"
    }
  },

  "therapist_access": {
    "enabled": true,
    "therapist_id": "therapist_x9y8z7",
    "access_level": "INSIGHTS_ONLY",
    "granted_at": "2026-01-16T09:00:00.000Z",
    "expires_at": "2026-07-16T09:00:00.000Z",
    "permissions": [
      "VIEW_INSIGHTS",
      "VIEW_TRENDS",
      "SET_GOALS",
      "LEAVE_NOTES"
    ]
  },

  "data_contribution": {
    "opted_in": true,
    "contribution_level": "FEATURES_ONLY",
    "consent_version": "v1.0",
    "consent_date": "2026-01-15T10:05:00.000Z"
  }
}
```

### Field Definitions

**demographics.support_needs:** Enum values (DSM-5 severity levels):
- `LEVEL_1`: Requiring support
- `LEVEL_2`: Requiring substantial support
- `LEVEL_3`: Requiring very substantial support
- `NOT_SPECIFIED`

**baseline.established:**
- `true` after 7 days and 20+ conversations
- Until true, coaching is less personalized

**goals.set_by:** Enum values:
- `USER`: Self-set goal
- `PARENT`: Parent/guardian set goal
- `THERAPIST`: Clinician recommended goal
- `SYSTEM`: Auto-suggested by Tizzy

**preferences.haptic_sensitivity:**
- Float 0.0 to 1.0
- Multiplier for haptic trigger thresholds
- 1.0 = default, <1.0 = less sensitive, >1.0 = more sensitive

**therapist_access.access_level:** Enum values:
- `INSIGHTS_ONLY`: Summary data, no raw audio
- `INSIGHTS_AND_CLIPS`: Summary + user-approved audio snippets
- `FULL_ACCESS`: All data including retained audio (rare, requires explicit consent)

**data_contribution.contribution_level:** Enum values:
- `NONE`: Do not use my data for research
- `FEATURES_ONLY`: Anonymized acoustic features for model training
- `FEATURES_AND_AUDIO`: Anonymized features + audio (requires extra consent)

---

## 8. Therapist View Schema

**Purpose:** Aggregate data for clinician dashboard

```json
{
  "therapist_id": "therapist_x9y8z7",
  "client_id": "user_a1b2c3d4",
  "report_period_start": "2026-02-06T00:00:00.000Z",
  "report_period_end": "2026-02-13T00:00:00.000Z",

  "summary": {
    "total_conversations": 23,
    "total_conversation_hours": 6.8,
    "average_conversation_duration_min": 17.7,
    "environments": {
      "school": 15,
      "home": 5,
      "therapy": 2,
      "public": 1
    }
  },

  "skill_progress": [
    {
      "skill_area": "RECIPROCITY",
      "goal_id": "goal_user123_1",
      "baseline_score": 0.58,
      "current_score": 0.72,
      "change_percent": 24.1,
      "trend": "IMPROVING",
      "confidence": 0.89,
      "observations": "Client consistently asks follow-up questions now. Improvement most notable in casual social settings."
    },
    {
      "skill_area": "REPAIR_AND_CLARIFICATION",
      "goal_id": "goal_user123_2",
      "baseline_score": 0.62,
      "current_score": 0.68,
      "change_percent": 9.7,
      "trend": "STABLE",
      "confidence": 0.76,
      "observations": "Client attempts repair when prompted by haptic, but still misses spontaneous confusion cues."
    }
  ],

  "notable_patterns": [
    {
      "pattern": "CONTEXT_DEPENDENT_PERFORMANCE",
      "description": "Client's reciprocity score is 30% higher in home environment vs. school cafeteria",
      "hypothesis": "Noise and social complexity of cafeteria may be overwhelming",
      "recommendation": "Consider sensory accommodations or quieter lunch location"
    },
    {
      "pattern": "TIME_OF_DAY_EFFECT",
      "description": "Conversations after 3pm show increased escalation moments",
      "hypothesis": "Possible fatigue or sensory overload accumulation",
      "recommendation": "Build in afternoon break time or quiet hour"
    }
  ],

  "flagged_sessions": [
    {
      "session_id": "sess_550e8400",
      "date": "2026-02-13T14:00:00.000Z",
      "flag_reason": "HIGH_STRESS_INDICATORS",
      "details": "Multiple escalation moments, elevated voice tension markers, abrupt topic shifts",
      "therapist_action_needed": true
    }
  ],

  "haptic_effectiveness": {
    "total_haptics_delivered": 87,
    "user_rated_helpful": 58,
    "user_rated_annoying": 12,
    "user_rated_neutral": 17,
    "behavior_change_rate": 0.67,
    "recommendation": "Haptics are mostly effective. Consider reducing sensitivity for 'SINGLE_PULSE' pattern based on user feedback."
  },

  "recommended_focus_areas": [
    {
      "skill_area": "TOPIC_MAINTENANCE",
      "rationale": "Client shows drift in 35% of multi-topic conversations. This is an emerging area for coaching.",
      "suggested_goal": "Practice staying on topic for 3-5 conversational turns before shifting"
    }
  ],

  "therapist_notes": [
    {
      "note_id": "note_abc123",
      "timestamp": "2026-02-10T10:30:00.000Z",
      "author": "therapist_x9y8z7",
      "content": "Discussed confusion moment from 2/9 session. Client now understands that long pauses can signal confusion. Reinforced 'check for understanding' strategy.",
      "visibility": "THERAPIST_ONLY"
    }
  ]
}
```

### Field Definitions

**skill_progress.confidence:**
- Model's confidence in the measured progress
- Accounts for session count and data quality

**notable_patterns.pattern:** Enum values:
- `CONTEXT_DEPENDENT_PERFORMANCE`, `TIME_OF_DAY_EFFECT`, `FATIGUE_PATTERN`
- `SENSORY_OVERLOAD_CORRELATION`, `SKILL_GENERALIZATION_ISSUE`, `RAPID_IMPROVEMENT`

**flagged_sessions.flag_reason:** Enum values:
- `HIGH_STRESS_INDICATORS`, `UNUSUAL_PATTERN`, `POTENTIAL_OVERLOAD`, `REGRESSION_DETECTED`, `SAFETY_CONCERN`

**haptic_effectiveness.behavior_change_rate:**
- Ratio of haptics that led to observable behavior change
- Used to tune haptic sensitivity

---

## 9. Audit Log Schema

**Purpose:** Immutable log of all data access and actions

```json
{
  "log_id": "audit_9d8e7f6g",
  "timestamp": "2026-02-13T14:16:05.000Z",
  "event_type": "DATA_ACCESS",

  "actor": {
    "actor_id": "therapist_x9y8z7",
    "actor_type": "THERAPIST",
    "actor_name": "Dr. Jane Smith"
  },

  "subject": {
    "subject_id": "user_a1b2c3d4",
    "subject_type": "USER",
    "data_accessed": "WEEKLY_PROGRESS_REPORT"
  },

  "action": {
    "action_type": "VIEW",
    "resource": "/api/v1/therapist/clients/user_a1b2c3d4/progress",
    "consent_verified": true,
    "consent_id": "consent_abc123"
  },

  "metadata": {
    "ip_address": "192.168.1.100",
    "user_agent": "Mozilla/5.0...",
    "session_id": "session_xyz789"
  }
}
```

### Field Definitions

**event_type:** Enum values:
- `DATA_ACCESS`, `DATA_DELETION`, `DATA_EXPORT`, `CONSENT_GRANTED`, `CONSENT_REVOKED`
- `GOAL_SET`, `GOAL_MODIFIED`, `HAPTIC_CONFIG_CHANGED`, `AUDIO_RETENTION_ENABLED`

**actor.actor_type:** Enum values:
- `USER`, `PARENT`, `THERAPIST`, `ADMIN`, `SYSTEM`

**action.action_type:** Enum values:
- `VIEW`, `CREATE`, `UPDATE`, `DELETE`, `EXPORT`, `SHARE`

---

## 10. Data Privacy Annotations

Every schema object includes privacy metadata:

```json
{
  "privacy": {
    "pii_level": "MEDIUM",
    "retention_policy": "90_DAYS",
    "encryption_required": true,
    "shareable_with": ["USER", "THERAPIST_WITH_CONSENT"],
    "anonymization_method": "REMOVE_PII_FIELDS",
    "gdpr_category": "SPECIAL_CATEGORY_DATA"
  }
}
```

### Field Definitions

**pii_level:** Enum values:
- `NONE`: No personally identifiable information
- `LOW`: Indirect identifiers (approximate location, age range)
- `MEDIUM`: Direct identifiers (user_id, device_id) but no names or audio
- `HIGH`: Contains voice recordings, names, or linkable identity

**retention_policy:** Enum values:
- `7_DAYS`, `30_DAYS`, `90_DAYS`, `1_YEAR`, `INDEFINITE`, `USER_CONTROLLED`

**gdpr_category:** Enum values:
- `SPECIAL_CATEGORY_DATA`: Health data (autism diagnosis, therapy notes)
- `PERSONAL_DATA`: General personal information
- `ANONYMIZED`: Cannot be linked to an individual

---

## Schema Versioning

All schemas include versioning:

```json
{
  "schema_version": "1.0.0",
  "schema_compatibility": "BACKWARD_COMPATIBLE"
}
```

**Versioning Strategy:**
- Major version (1.x.x): Breaking changes, not backward compatible
- Minor version (x.1.x): New fields added, backward compatible
- Patch version (x.x.1): Bug fixes, clarifications

**Migration Path:**
- V1 data can coexist with V2 data
- API clients specify schema version in Accept header
- Older clients receive V1 format; newer clients receive V2

---

## Example: Complete Session Data Flow

**User has 15-minute school cafeteria conversation:**

1. **Device captures audio** → VAD detects 30 turns → Diarization labels 18 as WEARER, 12 as OTHER
2. **Acoustic features extracted** → 30 Turn objects created with prosody, timing, voice quality
3. **On-device ML runs** → Detects "one-sided wearer" at minute 8 → Triggers DOUBLE_PULSE haptic
4. **User marks moment** at minute 12 with button press → UserMarker object created
5. **Session ends** → ConversationSession object created with all turns, moments, haptics
6. **Device syncs to app** → Data encrypted and uploaded to cloud
7. **Cloud Understanding Service analyzes:**
   - Modulate ELM detects emotion and intent for each turn
   - Tizzy confusion detector flags 2 likely confusion moments
   - Topic maintenance classifier identifies one abrupt topic shift
8. **Coaching Engine generates insights:**
   - "What went well": Asked a follow-up question at minute 5
   - "To improve": Monologued for 90 seconds without checking understanding
   - "Micro-goal": Pause every 30 seconds tomorrow and ask "What do you think?"
9. **User opens app** → Sees timeline, insights, marked moment analysis
10. **User rates insight** as "HELPFUL" → Feedback logged for model improvement
11. **Therapist views weekly report** → Sees this session in context of 23 total conversations
12. **Audit log records** therapist access with consent verification

---

## Schema Usage Guidelines

### For ML Engineers:
- Use `confidence` scores to filter low-quality predictions
- Log `signals` array to debug model decisions
- Track `user_feedback` to measure model helpfulness, not just accuracy

### For Backend Developers:
- Validate all incoming data against schema (JSON Schema validation)
- Always include `privacy` metadata for compliance
- Audit log every data access and modification

### For Frontend Developers:
- Display `confidence` when showing coaching insights ("We're 82% confident...")
- Link insights to `supporting_moments` for transparency
- Respect `retention_policy` (delete local cache accordingly)

### For Therapists:
- Focus on `skill_progress` trends over time, not single-session scores
- Review `notable_patterns` for context-specific interventions
- Use `flagged_sessions` to prioritize clinical attention

---

## Open Schema Questions

1. **Should we store raw audio embeddings for future retraining?**
   - Pro: Enables model improvement without retaining raw audio
   - Con: Embeddings can still be sensitive (voice biometrics)

2. **How granular should therapist access logs be?**
   - Every field viewed vs. every page viewed?

3. **Should we version user baselines?**
   - As user improves, baseline shifts—should we keep historical baselines for comparison?

4. **Transcript storage policy?**
   - Currently opt-in only—should transcripts auto-delete after 7 days?

5. **Bystander voice handling?**
   - Should OTHER_SPEAKER turns be stored separately with different retention policies?

---

## Conclusion

This schema is designed to capture everything Tizzy needs to deliver autism-specific conversational coaching while maintaining privacy, auditability, and extensibility. It balances ML engineering needs (features, confidence scores, feedback loops) with clinical requirements (interpretability, goal tracking, therapist collaboration) and regulatory requirements (audit logs, consent tracking, retention policies).

The schema is deliberately ambitious yet realistic for V1 without video, focusing on acoustic and temporal signals that are achievable with always-wearable audio devices. Future versions can extend with video-based nonverbal cues, physiological sensors, or multi-modal inputs without breaking existing data structures.

**Next Steps:**
1. Implement JSON Schema validators for each object type
2. Build data pipeline to populate schema from device audio
3. Create API documentation with example requests/responses
4. Develop database schema (PostgreSQL tables) matching this logical schema
5. Build anonymization and export tools for research dataset
