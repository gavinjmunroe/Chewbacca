export type UserRole = "dancer" | "creative" | "recruiter" | "verifier" | "admin";
export type CreativeType =
  | "dancer"
  | "musician"
  | "actor"
  | "model"
  | "photographer"
  | "videographer"
  | "director"
  | "stylist"
  | "makeup_artist"
  | "comedian"
  | "host"
  | "visual_artist"
  | "producer"
  | "other";
export type VerificationTier = "0" | "1" | "2";
export type ApplicationStatus =
  | "pending"
  | "shortlisted"
  | "audition_requested"
  | "booked"
  | "rejected"
  | "withdrawn";
export type BookingStatus = "confirmed" | "in_progress" | "completed" | "cancelled";
export type JobStatus = "draft" | "open" | "filled" | "closed";
export type TravelWillingness = "local_only" | "regional" | "national" | "international";
export type AvailabilityStatus = "available" | "limited" | "unavailable";
export type RecruiterType =
  | "agency"
  | "production"
  | "brand"
  | "label"
  | "independent"
  | "casting"
  | "other";

export interface Profile {
  id: string;
  role: UserRole;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  location: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  youtube_url: string | null;
  website_url: string | null;
  phone: string | null;
  is_verified_identity: boolean;
  username: string | null;
  referral_code: string | null;
  referred_by: string | null;
  notification_email_bookings: boolean;
  notification_email_applications: boolean;
  notification_email_messages: boolean;
  notification_push_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreativeProfile {
  id: string;
  user_id: string;
  creative_type: CreativeType;
  stage_name: string | null;
  styles: string[];
  height_cm: number | null;
  experience_years: number;
  verification_tier: VerificationTier;
  travel_willingness: TravelWillingness;
  availability_status: AvailabilityStatus;
  union_member: boolean;
  represented: boolean;
  total_bookings: number;
  avg_rating: number | null;
  profile_complete: boolean;
  featured: boolean;
  created_at: string;
  updated_at: string;
  // joined
  profile?: Profile;
  clips?: PortfolioClip[];
}

// Backward-compat alias — table is still dancer_profiles in the DB
export type DancerProfile = CreativeProfile;

export interface PortfolioClip {
  id: string;
  dancer_id: string;
  title: string;
  description: string | null;
  clip_url: string;
  thumbnail_url: string | null;
  styles: string[];
  duration_seconds: number | null;
  is_featured: boolean;
  display_order: number;
  view_count: number;
  camp_generated: boolean;
  verification_clip: boolean;
  created_at: string;
}

export interface RecruiterProfile {
  id: string;
  user_id: string;
  company_name: string;
  company_type: RecruiterType;
  website: string | null;
  is_verified: boolean;
  verified_at: string | null;
  total_bookings: number;
  avg_rating: number | null;
  created_at: string;
  updated_at: string;
  // joined
  profile?: Profile;
}

export interface Camp {
  id: string;
  name: string;
  slug: string;
  city: string;
  state: string | null;
  country: string;
  venue_name: string | null;
  address: string | null;
  start_date: string;
  end_date: string;
  registration_deadline: string;
  max_capacity: number;
  current_registered: number;
  registration_fee_cents: number;
  travel_reimbursement_cap_cents: number;
  scholarship_spots: number;
  description: string | null;
  agenda: CampAgendaItem[] | null;
  is_published: boolean;
  is_sold_out: boolean;
  created_at: string;
}

export interface CampAgendaItem {
  time: string;
  title: string;
  description: string;
  duration_minutes: number;
}

export interface CampRegistration {
  id: string;
  camp_id: string;
  dancer_id: string;
  user_id: string;
  status: "registered" | "attended" | "no_show" | "cancelled";
  registration_fee_paid: boolean;
  travel_origin: string | null;
  travel_distance_miles: number | null;
  reimbursement_cap_cents: number | null;
  reimbursement_requested_cents: number | null;
  reimbursement_status:
    | "not_requested"
    | "pending"
    | "approved"
    | "paid"
    | "denied";
  scholarship_awarded: boolean;
  notes: string | null;
  created_at: string;
}

export interface VerificationRecord {
  id: string;
  dancer_id: string;
  camp_id: string | null;
  verifier_id: string | null;
  tier_awarded: VerificationTier;
  score_technique: number | null;
  score_learning_speed: number | null;
  score_professionalism: number | null;
  score_collaboration: number | null;
  score_on_camera: number | null;
  score_communication: number | null;
  overall_score: number | null;
  styles_evaluated: string[] | null;
  notes: string | null;
  evidence_clip_urls: string[] | null;
  verified_at: string;
  expires_at: string | null;
  revoked: boolean;
}

export interface Job {
  id: string;
  recruiter_id: string;
  title: string;
  description: string;
  styles_needed: string[];
  role_type: string;
  city: string | null;
  state: string | null;
  country: string;
  remote_possible: boolean;
  start_date: string | null;
  end_date: string | null;
  rehearsal_dates: string | null;
  pay_range_min_cents: number | null;
  pay_range_max_cents: number | null;
  pay_type: string;
  min_verification_tier: VerificationTier;
  head_count: number;
  requirements: string[] | null;
  application_deadline: string | null;
  status: JobStatus;
  total_applications: number;
  shortlisted_count: number;
  view_count: number;
  created_at: string;
  updated_at: string;
  // joined
  recruiter?: RecruiterProfile;
}

export interface Application {
  id: string;
  job_id: string;
  dancer_id: string;
  user_id: string;
  status: ApplicationStatus;
  cover_note: string | null;
  submitted_clips: string[] | null;
  ai_match_score: number | null;
  ai_match_reasons: string[] | null;
  shortlisted_at: string | null;
  recruiter_notes: string | null;
  created_at: string;
  updated_at: string;
  // joined
  job?: Job;
  dancer?: CreativeProfile;
}

export interface Shortlist {
  id: string;
  recruiter_id: string;
  job_id: string | null;
  name: string;
  dancer_ids: string[];
  notes: string | null;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
}

export interface Booking {
  id: string;
  job_id: string | null;
  application_id: string | null;
  dancer_id: string;
  recruiter_id: string;
  status: BookingStatus;
  role_title: string;
  start_date: string;
  end_date: string | null;
  total_pay_cents: number | null;
  platform_fee_cents: number | null;
  notes: string | null;
  contract_url: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  // joined
  dancer?: CreativeProfile;
  recruiter?: RecruiterProfile;
}

export interface Review {
  id: string;
  booking_id: string;
  reviewer_id: string;
  reviewee_id: string;
  reviewer_role: UserRole;
  rating: number;
  dimension_scores: Record<string, number> | null;
  content: string | null;
  is_public: boolean;
  created_at: string;
  // joined
  reviewer?: Profile;
}

export interface CulturePost {
  id: string;
  user_id: string;
  performance_clip_url: string;
  explanation_clip_url: string;
  thumbnail_url: string | null;
  caption: string | null;
  credits: string[] | null;
  influences: string[] | null;
  styles: string[];
  challenge_id: string | null;
  circle_id: string | null;
  likes_count: number;
  comments_count: number;
  views_count: number;
  saves_count: number;
  is_published: boolean;
  created_at: string;
  // joined
  author?: Profile;
}

// ─── Creative disciplines (flat list used for filters & profile tags) ──────────
export const CREATIVE_DISCIPLINES = [
  // Dance
  "Hip-Hop",
  "Breaking",
  "Popping",
  "Locking",
  "House",
  "Waacking",
  "Voguing",
  "Krump",
  "Ballet",
  "Contemporary",
  "Jazz",
  "Tap",
  "Latin / Ballroom",
  "Afrobeats",
  "Dancehall",
  "Freestyle",
  "Heels",
  "Commercial Dance",
  "Street Jazz",
  "Lyrical",
  // Music
  "Vocals / Singing",
  "Rap / MC",
  "Guitar",
  "Piano / Keys",
  "Drums",
  "Bass",
  "Violin / Strings",
  "Music Production",
  "DJ / Turntablism",
  "Songwriting",
  // Acting
  "Film Acting",
  "TV Acting",
  "Theater",
  "Voice Acting",
  "Comedy / Improv",
  "Stand-Up Comedy",
  // Modeling
  "Fashion Modeling",
  "Commercial Modeling",
  "Fitness Modeling",
  "Runway",
  "Editorial Modeling",
  // Visual / Production
  "Photography",
  "Videography",
  "Film Directing",
  "Video Editing",
  "Cinematography",
  // Styling
  "Fashion Styling",
  "Hair Styling",
  "Makeup / Beauty",
  "Costume Design",
  // Other
  "Content Creation",
  "Hosting / MC",
  "Spoken Word / Poetry",
  "Circus / Acrobatics",
  "Stunt Performance",
] as const;

// Backward-compat alias
export const DANCE_STYLES = CREATIVE_DISCIPLINES;

// ─── Creative types (for profile categorization) ───────────────────────────
export const CREATIVE_TYPES = [
  { value: "dancer",        label: "Dancer" },
  { value: "musician",      label: "Musician" },
  { value: "actor",         label: "Actor / Performer" },
  { value: "model",         label: "Model" },
  { value: "photographer",  label: "Photographer" },
  { value: "videographer",  label: "Videographer" },
  { value: "director",      label: "Director / Producer" },
  { value: "stylist",       label: "Stylist" },
  { value: "makeup_artist", label: "Makeup Artist" },
  { value: "comedian",      label: "Comedian" },
  { value: "host",          label: "Host / MC" },
  { value: "visual_artist", label: "Visual Artist" },
  { value: "other",         label: "Other Creative" },
] as const;

export function getCreativeTypeLabel(type: CreativeType | string | null | undefined): string {
  if (!type) return "Creative";
  const found = CREATIVE_TYPES.find((t) => t.value === type);
  return found ? found.label : "Creative";
}

export const ROLE_TYPES = [
  // Performance / Dance
  "Tour",
  "Music Video",
  "Commercial",
  "Live Event",
  "Award Show",
  "TV / Film",
  "Teaching / Workshop",
  "Corporate Event",
  "Theme Park",
  "Cruise Ship",
  "Social Media Content",
  // Acting
  "Film Role",
  "TV Role",
  "Theater Run",
  "Voice Role",
  "Extra / Background",
  // Modeling
  "Runway Show",
  "Print Campaign",
  "Catalog / Lookbook",
  "Brand Ambassador",
  // Music
  "Session Recording",
  "Live Performance",
  "Residency",
  "DJ Set",
  // Production
  "Photo Shoot",
  "Video Production",
  "Hosting Gig",
  "Other",
] as const;

export const TIER_LABELS: Record<VerificationTier, string> = {
  "0": "Camp Attendee",
  "1": "Verified Human",
  "2": "EGATS Verified Talent",
};

export const TIER_COLORS: Record<VerificationTier, string> = {
  "0": "#6B7280",
  "1": "#3B82F6",
  "2": "#F59E0B",
};
