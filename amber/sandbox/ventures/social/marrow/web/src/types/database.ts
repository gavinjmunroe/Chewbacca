export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          first_name: string | null
          last_name: string | null
          headline: string | null
          school: string | null
          graduation_year: number | null
          major: string | null
          avatar_url: string | null
          bio: string | null
          linkedin_url: string | null
          github_url: string | null
          website_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
      }
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          description: string | null
          logo_url: string | null
          cover_url: string | null
          website: string | null
          school: string | null
          category: string | null
          is_verified: boolean
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['organizations']['Row'], 'id' | 'created_at' | 'updated_at' | 'is_verified' | 'is_active'>
        Update: Partial<Database['public']['Tables']['organizations']['Insert']>
      }
      org_members: {
        Row: {
          id: string
          org_id: string
          user_id: string
          role: 'owner' | 'admin' | 'reviewer'
          invited_by: string | null
          invited_at: string
          accepted_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['org_members']['Row'], 'id' | 'invited_at'>
        Update: Partial<Database['public']['Tables']['org_members']['Insert']>
      }
      cycles: {
        Row: {
          id: string
          org_id: string
          name: string
          description: string | null
          status: 'draft' | 'active' | 'paused' | 'closed' | 'archived'
          application_open_at: string | null
          application_close_at: string | null
          max_applicants: number | null
          target_class_size: number | null
          is_public: boolean
          settings: Json
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['cycles']['Row'], 'id' | 'created_at' | 'updated_at' | 'status' | 'is_public'>
        Update: Partial<Database['public']['Tables']['cycles']['Insert']>
      }
      stages: {
        Row: {
          id: string
          cycle_id: string
          name: string
          description: string | null
          stage_order: number
          stage_type: 'application' | 'event' | 'interview' | 'decision'
          is_blind: boolean
          is_required: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['stages']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['stages']['Insert']>
      }
      stage_questions: {
        Row: {
          id: string
          stage_id: string
          question_text: string
          question_type: 'short_text' | 'long_text' | 'single_choice' | 'multi_choice' | 'file_upload' | 'url' | 'number'
          is_required: boolean
          options: Json | null
          word_limit: number | null
          char_limit: number | null
          placeholder: string | null
          helper_text: string | null
          question_order: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['stage_questions']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['stage_questions']['Insert']>
      }
      rubric_criteria: {
        Row: {
          id: string
          stage_id: string
          criterion_name: string
          description: string | null
          max_score: number
          weight: number
          criterion_order: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['rubric_criteria']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['rubric_criteria']['Insert']>
      }
      applications: {
        Row: {
          id: string
          cycle_id: string
          applicant_id: string
          current_stage_id: string | null
          status: 'draft' | 'submitted' | 'under_review' | 'advancing' | 'accepted' | 'waitlisted' | 'rejected' | 'withdrawn'
          submitted_at: string | null
          decision_at: string | null
          decision_note: string | null
          internal_tags: string[] | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['applications']['Row'], 'id' | 'created_at' | 'updated_at' | 'status'>
        Update: Partial<Database['public']['Tables']['applications']['Insert']>
      }
      application_responses: {
        Row: {
          id: string
          application_id: string
          question_id: string
          response_text: string | null
          response_files: Json
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['application_responses']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['application_responses']['Insert']>
      }
      artifacts: {
        Row: {
          id: string
          user_id: string
          artifact_type: 'resume' | 'transcript' | 'portfolio' | 'writing_sample' | 'other'
          name: string
          file_url: string
          file_size: number | null
          mime_type: string | null
          is_primary: boolean
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['artifacts']['Row'], 'id' | 'created_at' | 'updated_at' | 'is_primary'>
        Update: Partial<Database['public']['Tables']['artifacts']['Insert']>
      }
      reviews: {
        Row: {
          id: string
          application_id: string
          stage_id: string
          reviewer_id: string
          notes: string | null
          recommendation: 'advance' | 'reject' | 'hold' | 'undecided' | null
          is_submitted: boolean
          submitted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['reviews']['Row'], 'id' | 'created_at' | 'updated_at' | 'is_submitted'>
        Update: Partial<Database['public']['Tables']['reviews']['Insert']>
      }
      review_scores: {
        Row: {
          id: string
          review_id: string
          criterion_id: string
          score: number | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['review_scores']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['review_scores']['Insert']>
      }
      application_stage_history: {
        Row: {
          id: string
          application_id: string
          from_stage_id: string | null
          to_stage_id: string | null
          from_status: string | null
          to_status: string | null
          moved_by: string | null
          note: string | null
          moved_at: string
        }
        Insert: Omit<Database['public']['Tables']['application_stage_history']['Row'], 'id' | 'moved_at'>
        Update: Partial<Database['public']['Tables']['application_stage_history']['Insert']>
      }
      messages: {
        Row: {
          id: string
          cycle_id: string
          sent_by: string
          recipient_type: 'all' | 'stage' | 'status' | 'individual'
          recipient_filter: Json
          subject: string
          body: string
          sent_at: string
          recipient_count: number
        }
        Insert: Omit<Database['public']['Tables']['messages']['Row'], 'id' | 'sent_at' | 'recipient_count'>
        Update: Partial<Database['public']['Tables']['messages']['Insert']>
      }
      events: {
        Row: {
          id: string
          cycle_id: string
          stage_id: string | null
          name: string
          description: string | null
          location: string | null
          event_url: string | null
          starts_at: string
          ends_at: string | null
          max_capacity: number | null
          is_required: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['events']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['events']['Insert']>
      }
      event_rsvps: {
        Row: {
          id: string
          event_id: string
          user_id: string
          status: 'attending' | 'waitlisted' | 'cancelled'
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['event_rsvps']['Row'], 'id' | 'created_at' | 'status'>
        Update: Partial<Database['public']['Tables']['event_rsvps']['Insert']>
      }
      onboarding_tasks: {
        Row: {
          id: string
          cycle_id: string
          title: string
          description: string | null
          due_date: string | null
          task_type: string
          task_config: Json
          task_order: number
          is_required: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['onboarding_tasks']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['onboarding_tasks']['Insert']>
      }
      onboarding_completions: {
        Row: {
          id: string
          task_id: string
          user_id: string
          status: 'pending' | 'completed' | 'waived'
          response: Json | null
          completed_at: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['onboarding_completions']['Row'], 'id' | 'created_at' | 'status'>
        Update: Partial<Database['public']['Tables']['onboarding_completions']['Insert']>
      }
      audit_log: {
        Row: {
          id: string
          org_id: string | null
          cycle_id: string | null
          actor_id: string | null
          action: string
          resource_type: string | null
          resource_id: string | null
          metadata: Json
          ip_address: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['audit_log']['Row'], 'id' | 'created_at'>
        Update: never
      }
    }
  }
}

// Convenience types
export type Profile = Database['public']['Tables']['profiles']['Row']
export type Organization = Database['public']['Tables']['organizations']['Row']
export type OrgMember = Database['public']['Tables']['org_members']['Row']
export type Cycle = Database['public']['Tables']['cycles']['Row']
export type Stage = Database['public']['Tables']['stages']['Row']
export type StageQuestion = Database['public']['Tables']['stage_questions']['Row']
export type RubricCriterion = Database['public']['Tables']['rubric_criteria']['Row']
export type Application = Database['public']['Tables']['applications']['Row']
export type ApplicationResponse = Database['public']['Tables']['application_responses']['Row']
export type Artifact = Database['public']['Tables']['artifacts']['Row']
export type Review = Database['public']['Tables']['reviews']['Row']
export type ReviewScore = Database['public']['Tables']['review_scores']['Row']
export type ApplicationStageHistory = Database['public']['Tables']['application_stage_history']['Row']
export type Message = Database['public']['Tables']['messages']['Row']
export type Event = Database['public']['Tables']['events']['Row']
export type EventRsvp = Database['public']['Tables']['event_rsvps']['Row']
export type OnboardingTask = Database['public']['Tables']['onboarding_tasks']['Row']
export type OnboardingCompletion = Database['public']['Tables']['onboarding_completions']['Row']
export type AuditLog = Database['public']['Tables']['audit_log']['Row']

// Enriched types with joins
export type ApplicationWithProfile = Application & {
  profiles: Profile
}

export type ApplicationWithDetails = Application & {
  profiles: Profile
  cycles: Cycle & { organizations: Organization }
  stages: Stage | null
}

export type CycleWithOrg = Cycle & {
  organizations: Organization
}

export type StageWithQuestions = Stage & {
  stage_questions: StageQuestion[]
  rubric_criteria: RubricCriterion[]
}

export type ReviewWithScores = Review & {
  review_scores: ReviewScore[]
  profiles: Profile
}

export type OrgWithRole = Organization & {
  role: OrgMember['role']
}
