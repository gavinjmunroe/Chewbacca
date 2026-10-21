export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string | null
          full_name: string | null
          avatar_url: string | null
          timezone: string
          onboarding_complete: boolean
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
      }
      channels: {
        Row: {
          id: string
          user_id: string
          type: 'gmail' | 'slack' | 'imessage' | 'sms' | 'outlook' | 'whatsapp'
          display_name: string | null
          account_email: string | null
          account_id: string | null
          access_token: string | null
          refresh_token: string | null
          token_expiry: string | null
          workspace_id: string | null
          workspace_name: string | null
          scopes: string[]
          last_synced_at: string | null
          sync_cursor: string | null
          is_active: boolean
          sync_status: 'idle' | 'syncing' | 'error' | 'paused'
          error_message: string | null
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['channels']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['channels']['Insert']>
      }
      contacts: {
        Row: {
          id: string
          user_id: string
          name: string | null
          email: string | null
          phone: string | null
          slack_user_id: string | null
          relationship_type: 'family' | 'close_friend' | 'friend' | 'coworker' | 'manager' | 'direct_report' | 'client' | 'investor' | 'recruiter' | 'vendor' | 'unknown'
          importance_score: number
          tone_profile: Json
          custom_rules: Json
          always_surface: boolean
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['contacts']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['contacts']['Insert']>
      }
      threads: {
        Row: {
          id: string
          user_id: string
          channel_id: string
          external_thread_id: string
          subject: string | null
          participants: Json
          urgency_score: number
          importance_score: number
          sentiment: 'positive' | 'neutral' | 'negative' | 'urgent' | 'emotional'
          action_required: boolean
          action_type: 'reply' | 'decide' | 'schedule' | 'file' | 'escalate' | 'ignore' | null
          triage_reason: string | null
          triage_tags: string[]
          status: 'unread' | 'read' | 'in_progress' | 'done' | 'snoozed' | 'archived' | 'delegated'
          snoozed_until: string | null
          labels: string[]
          summary: string | null
          key_context: string | null
          last_message_at: string | null
          message_count: number
          unread_count: number
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          channel_id: string
          external_thread_id: string
          subject?: string | null
          participants?: Json
          urgency_score?: number
          importance_score?: number
          sentiment?: 'positive' | 'neutral' | 'negative' | 'urgent' | 'emotional'
          action_required?: boolean
          action_type?: 'reply' | 'decide' | 'schedule' | 'file' | 'escalate' | 'ignore' | null
          triage_reason?: string | null
          triage_tags?: string[]
          status?: 'unread' | 'read' | 'in_progress' | 'done' | 'snoozed' | 'archived' | 'delegated'
          snoozed_until?: string | null
          labels?: string[]
          summary?: string | null
          key_context?: string | null
          last_message_at?: string | null
          message_count?: number
          unread_count?: number
          metadata?: Json
        }
        Update: {
          user_id?: string
          channel_id?: string
          external_thread_id?: string
          subject?: string | null
          participants?: Json
          urgency_score?: number
          importance_score?: number
          sentiment?: 'positive' | 'neutral' | 'negative' | 'urgent' | 'emotional'
          action_required?: boolean
          action_type?: 'reply' | 'decide' | 'schedule' | 'file' | 'escalate' | 'ignore' | null
          triage_reason?: string | null
          triage_tags?: string[]
          status?: 'unread' | 'read' | 'in_progress' | 'done' | 'snoozed' | 'archived' | 'delegated'
          snoozed_until?: string | null
          labels?: string[]
          summary?: string | null
          key_context?: string | null
          last_message_at?: string | null
          message_count?: number
          unread_count?: number
          metadata?: Json
        }
      }
      messages: {
        Row: {
          id: string
          thread_id: string
          user_id: string
          channel_id: string
          external_id: string
          from_name: string | null
          from_email: string | null
          from_phone: string | null
          from_slack_user_id: string | null
          to_addresses: Json
          cc_addresses: Json
          bcc_addresses: Json
          subject: string | null
          body_text: string | null
          body_html: string | null
          snippet: string | null
          attachments: Json
          is_outbound: boolean
          is_read: boolean
          received_at: string | null
          metadata: Json
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['messages']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['messages']['Insert']>
      }
      drafts: {
        Row: {
          id: string
          thread_id: string
          user_id: string
          content: string
          subject: string | null
          tone: 'formal' | 'casual' | 'warm' | 'brief' | 'detailed' | 'empathetic' | 'assertive' | 'balanced'
          context_used: Json
          model: string
          prompt_version: string
          generation_time_ms: number | null
          status: 'pending' | 'approved' | 'edited' | 'sent' | 'discarded'
          edited_content: string | null
          sent_at: string | null
          send_via_channel_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['drafts']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['drafts']['Insert']>
      }
      action_log: {
        Row: {
          id: string
          user_id: string
          thread_id: string | null
          draft_id: string | null
          action_type: 'archive' | 'reply' | 'snooze' | 'label' | 'create_task' | 'forward' | 'delete' | 'mark_read' | 'triage' | 'draft_generated' | 'draft_sent' | 'channel_sync'
          action_data: Json
          approved_by: 'user' | 'auto_policy' | 'voice'
          result: 'success' | 'failed' | 'pending'
          error: string | null
          executed_at: string
        }
        Insert: Omit<Database['public']['Tables']['action_log']['Row'], 'id' | 'executed_at'>
        Update: never
      }
      user_memory: {
        Row: {
          id: string
          user_id: string
          tone_profile: Json
          communication_preferences: Json
          important_senders: string[]
          ignore_patterns: string[]
          auto_approve_rules: Json
          memory_notes: string | null
          total_approvals: number
          total_edits: number
          total_discards: number
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['user_memory']['Row'], 'id' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['user_memory']['Insert']>
      }
      waitlist: {
        Row: {
          id: string
          email: string
          name: string | null
          use_case: string | null
          referral_source: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['waitlist']['Row'], 'id' | 'created_at'>
        Update: never
      }
    }
    Views: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
    Functions: {
      get_triage_queue: {
        Args: {
          p_user_id: string
          p_limit?: number
          p_offset?: number
          p_status?: string
        }
        Returns: TriageQueueItem[]
      }
      get_daily_briefing: {
        Args: { p_user_id: string }
        Returns: Json
      }
      update_thread_with_action: {
        Args: {
          p_user_id: string
          p_thread_id: string
          p_new_status: string
          p_action_type: string
          p_action_data?: Json
        }
        Returns: boolean
      }
    }
  }
}

export interface TriageQueueItem {
  id: string
  channel_type: string
  channel_name: string
  subject: string | null
  participants: Json
  urgency_score: number
  importance_score: number
  sentiment: string
  action_required: boolean
  action_type: string | null
  triage_reason: string | null
  triage_tags: string[]
  status: string
  summary: string | null
  last_message_at: string | null
  message_count: number
  unread_count: number
  latest_snippet: string | null
  latest_from: string | null
}
