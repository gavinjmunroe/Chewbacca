import { useState, useEffect } from 'react';
import { apiService } from '../../../api/client';

export interface Session {
  id: string;
  user_id: string;
  device_id: string;
  start_time: string;
  end_time: string;
  total_duration_seconds: number;
  speaker_count_estimate: number;
  environment_tag: string;
  consent_mode: string;
  created_at: string;
  updated_at: string;
}

export interface SessionSummary {
  session_id: string;
  date: string;
  duration_minutes: number;
  summary: string;
  insights: {
    what_went_well: string[];
    areas_for_growth: string[];
    micro_goal: {
      title: string;
      description: string;
      target_date: string;
    };
  };
  metrics: {
    speech_clarity: number;
    pace_consistency: number;
    vocal_variety: number;
    pause_effectiveness: number;
  };
  progress_data: {
    week: string;
    sessions_completed: number;
    total_practice_minutes: number;
    improvement_trend: 'improving' | 'stable' | 'needs_attention';
  };
}

export interface UseSessionsResult {
  sessions: SessionSummary[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch and manage user sessions with coaching insights
 */
export function useSessions(userId: string, limit: number = 10): UseSessionsResult {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Fetch sessions list
      const sessionsData = await apiService.getSessions(userId, { limit });

      // Fetch summary for each session
      const sessionsWithSummaries = await Promise.all(
        sessionsData.map(async (session) => {
          try {
            const summary = await apiService.getSessionSummary(session.id);
            return transformSessionToSummary(session, summary);
          } catch (err) {
            console.warn(`Failed to fetch summary for session ${session.id}`, err);
            return createPlaceholderSummary(session);
          }
        })
      );

      setSessions(sessionsWithSummaries);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (userId) {
      fetchSessions();
    }
  }, [userId, limit]);

  return {
    sessions,
    isLoading,
    error,
    refetch: fetchSessions,
  };
}

/**
 * Transform API session data to SessionSummary format
 */
function transformSessionToSummary(session: any, summary: any): SessionSummary {
  return {
    session_id: session.id,
    date: session.start_time,
    duration_minutes: Math.round(session.total_duration_seconds / 60),
    summary: summary.summary || 'Practice session completed',
    insights: {
      what_went_well: summary.insights?.strengths || [
        'Maintained consistent speaking pace',
        'Good vocal clarity',
      ],
      areas_for_growth: summary.insights?.areas_for_improvement || [
        'Try adding more pauses for emphasis',
      ],
      micro_goal: summary.next_goal || {
        title: 'Practice mindful pausing',
        description: 'Try to add 2-3 intentional pauses in your next conversation',
        target_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    },
    metrics: {
      speech_clarity: summary.metrics?.clarity || 75,
      pace_consistency: summary.metrics?.pace || 70,
      vocal_variety: summary.metrics?.variety || 65,
      pause_effectiveness: summary.metrics?.pauses || 60,
    },
    progress_data: {
      week: getCurrentWeek(),
      sessions_completed: summary.week_stats?.sessions || 1,
      total_practice_minutes: summary.week_stats?.total_minutes || session.total_duration_seconds / 60,
      improvement_trend: summary.trend || 'stable',
    },
  };
}

/**
 * Create placeholder summary for sessions without API data
 */
function createPlaceholderSummary(session: any): SessionSummary {
  return {
    session_id: session.id,
    date: session.start_time,
    duration_minutes: Math.round(session.total_duration_seconds / 60),
    summary: 'Practice session completed successfully',
    insights: {
      what_went_well: [
        'Completed your practice session',
        'Building consistency in your practice',
      ],
      areas_for_growth: [
        'Keep practicing to unlock more insights',
      ],
      micro_goal: {
        title: 'Continue practicing',
        description: 'Complete another practice session to build your skills',
        target_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    },
    metrics: {
      speech_clarity: 0,
      pace_consistency: 0,
      vocal_variety: 0,
      pause_effectiveness: 0,
    },
    progress_data: {
      week: getCurrentWeek(),
      sessions_completed: 1,
      total_practice_minutes: Math.round(session.total_duration_seconds / 60),
      improvement_trend: 'stable',
    },
  };
}

/**
 * Get current week string in YYYY-WW format
 */
function getCurrentWeek(): string {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((now.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${now.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

/**
 * Hook to fetch a single session detail
 */
export function useSessionDetail(sessionId: string) {
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSession = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const summary = await apiService.getSessionSummary(sessionId);

        // For session detail, we need the full session object too
        // In a real app, you might fetch this from a local cache or API
        const mockSession = {
          id: sessionId,
          start_time: summary.date || new Date().toISOString(),
          total_duration_seconds: (summary.duration_minutes || 0) * 60,
        };

        setSession(transformSessionToSummary(mockSession, summary));
      } catch (err) {
        console.error('Failed to fetch session detail:', err);
        setError(err instanceof Error ? err.message : 'Failed to load session');
      } finally {
        setIsLoading(false);
      }
    };

    if (sessionId) {
      fetchSession();
    }
  }, [sessionId]);

  return {
    session,
    isLoading,
    error,
  };
}
