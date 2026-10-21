// ─── Database Types ────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string | null;
}

export interface CulturePost {
  id: string;
  user_id: string;
  content: string;
  media_url: string | null;
  styles: string[] | null;
  likes_count: number;
  comments_count: number;
  circle_id: string | null;
  created_at: string;
  // joined
  profiles?: Profile | null;
}

export interface CultureCircle {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  member_count: number;
  created_by: string | null;
  created_at: string;
}

export interface CultureChallenge {
  id: string;
  title: string;
  description: string | null;
  prize: string | null;
  end_date: string | null;
  entry_count: number;
  created_at: string;
}

export interface PostLike {
  post_id: string;
  user_id: string;
}

// ─── API Response Types ────────────────────────────────────────────────────────

export interface PostsResponse {
  posts: CulturePost[];
  error?: string;
}

export interface CirclesResponse {
  circles: CultureCircle[];
  error?: string;
}

export interface ChallengesResponse {
  challenges: CultureChallenge[];
  error?: string;
}
