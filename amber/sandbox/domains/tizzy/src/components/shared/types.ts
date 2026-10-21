export type Tab = 'home' | 'sessions' | 'chat' | 'profile';

export interface Session {
  id: string;
  date: string;
  duration: number;
  environment: string;
  favorite?: boolean;
  summary: string;
  metrics: {
    speechClarity: number;
    paceConsistency: number;
    vocalVariety: number;
    turnTaking: number;
  };
  insights: {
    whatWentWell: string[];
    areasForGrowth: string[];
    microGoal: {
      text: string;
      description: string;
      difficulty: 'easy' | 'medium' | 'hard';
      progress: number;
    };
  };
}

export interface WeeklyHistoryEntry {
  week: string;
  sessions: number;
  avgScore: number;
  minutesCoached: number;
}

export interface DemoData {
  user: {
    name: string;
    initials: string;
    email: string;
    joinDate: string;
    currentStreak: number;
    longestStreak?: number;
    totalMinutesCoached?: number;
    totalSessions?: number;
    weeklyGoal?: number;
  };
  device: { connected: boolean; battery: number; status: 'ready' | 'recording' };
  sessions: Session[];
  weeklyStats: {
    conversations: number;
    totalMinutes: number;
    streak: number;
    bestSkill: string;
    focusArea: string;
    sessionsThisWeek: number;
    weeklyGoal: number;
    bestSession: string;
    minutesThisWeek?: number;
    previousWeekMetrics: {
      speechClarity: number;
      paceConsistency: number;
      vocalVariety: number;
      turnTaking: number;
    };
    weeklyHistory?: WeeklyHistoryEntry[];
  };
}
