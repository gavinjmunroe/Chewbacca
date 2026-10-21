import type { Database, TriageQueueItem } from "./database"

export type Thread = Database["public"]["Tables"]["threads"]["Row"]
export type Message = Database["public"]["Tables"]["messages"]["Row"]
export type Draft = Database["public"]["Tables"]["drafts"]["Row"]
export type Channel = Database["public"]["Tables"]["channels"]["Row"]
export type Contact = Database["public"]["Tables"]["contacts"]["Row"]
export type Profile = Database["public"]["Tables"]["profiles"]["Row"]
export type UserMemory = Database["public"]["Tables"]["user_memory"]["Row"]

export type ChannelType = Channel["type"]
export type ThreadStatus = Thread["status"]
export type DraftStatus = Draft["status"]
export type DraftTone = Draft["tone"]
export type Sentiment = Thread["sentiment"]
export type ActionType = NonNullable<Thread["action_type"]>

export interface Participant {
  name?: string
  email?: string
  phone?: string
  slack_user_id?: string
  role?: string
}

export interface Attachment {
  id: string
  name: string
  size: number
  mime_type: string
  url?: string
}

export interface ThreadWithMessages extends Thread {
  messages: Message[]
  channel: Channel
  drafts: Draft[]
}

export interface TriageItem extends TriageQueueItem {
  isSelected?: boolean
  isExpanded?: boolean
}

export interface DailyBriefing {
  urgent_count: number
  action_required_count: number
  unread_count: number
  total_active: number
  channels: Array<{
    type: ChannelType
    name: string
    unread: number
  }>
  top_urgent: Array<{
    id: string
    subject: string | null
    urgency: number
    from: string | null
  }>
}

export interface ChannelSyncResult {
  channel_id: string
  threads_synced: number
  messages_synced: number
  new_threads: number
  errors: string[]
  synced_at: string
}

export interface GenerateDraftRequest {
  thread_id: string
  tone?: DraftTone
  instruction?: string // e.g. "Keep it brief" or "Sound more formal"
  voice_instruction?: string // from voice mode
}

export interface GenerateDraftResponse {
  draft_id: string
  content: string
  tone: DraftTone
  reasoning: string
}

export interface TriageRequest {
  thread_id: string
  force?: boolean // re-triage even if already done
}

export interface TriageResponse {
  thread_id: string
  urgency_score: number
  importance_score: number
  sentiment: Sentiment
  action_required: boolean
  action_type: ActionType | null
  summary: string
  triage_reason: string
  triage_tags: string[]
}

export interface VoiceSession {
  session_id: string
  mode: "clearing" | "briefing" | "dictation"
  current_thread_id?: string
  queue: TriageQueueItem[]
  current_index: number
  is_active: boolean
}

export type QuickAction =
  | "archive"
  | "snooze"
  | "mark_read"
  | "draft_reply"
  | "create_task"
  | "done"

export interface BulkActionRequest {
  thread_ids: string[]
  action: QuickAction
  action_data?: Record<string, unknown>
}
