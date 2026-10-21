/**
 * Tool-keyword selector — picks which native tools to arm for a given turn.
 *
 * Extracted from agent.js to honor the <800-line AGENTS.md rule.
 *
 * Design: always arm a small "core" (Beads task_* + github_*). Then match
 * keywords in the user's message to additional native tool names. Total
 * surface per turn stays small (~8 tools) so the Agent API payload doesn't
 * balloon, and Claude doesn't get confused by dozens of options.
 *
 * All names are NATIVE tool names (lowercase snake_case). Composio action
 * names are no longer in this map.
 */

export const TOOL_KEYWORDS = {
  calendar: [
    "schedule_event",
    "get_availability",
    "list_events",
    "reschedule_event",
    "cancel_event",
    // Tab 25 — block scheduling + focus time.
    "find_free_block",
    "schedule_focus_block",
    "propose_reschedule",
  ],
  email: [
    "gmail_list_inbox",
    "gmail_send_email",
    "gmail_send_message",
    "gmail_read_email",
    "gmail_search",
    "gmail_draft_email",
    "gmail_draft_reply",
  ],
  gmail: [
    "gmail_list_inbox",
    "gmail_send_email",
    "gmail_send_message",
    "gmail_search",
    "gmail_draft_reply",
  ],
  outlook: [
    "outlook_list_inbox",
    "outlook_send_email",
    "outlook_search_messages",
  ],
  mscal: [
    "mscal_list_events",
    "mscal_get_availability",
    "mscal_create_event",
    "mscal_cancel_event",
  ],
  onedrive: [
    "onedrive_list_files",
    "onedrive_search_files",
    "onedrive_get_file_metadata",
  ],
  teams: [
    "teams_list_chats",
    "teams_list_recent_messages",
    "teams_send_chat_message",
    "teams_get_presence",
  ],
  microsoft: [
    "outlook_list_inbox",
    "outlook_send_email",
    "mscal_list_events",
    "mscal_create_event",
    "onedrive_search_files",
    "teams_list_chats",
    "teams_send_chat_message",
  ],
  office: ["outlook_list_inbox", "mscal_list_events", "onedrive_list_files"],
  o365: ["outlook_list_inbox", "mscal_list_events", "onedrive_list_files"],
  week: ["summarize_week"],
  weekly: ["summarize_week"],
  recap: ["summarize_week"],
  digest: ["summarize_week"],
  slack: [
    "slack_send_message",
    "slack_list_channels",
    "slack_read_channel",
    "slack_search_messages",
    "slack_reply_thread",
    "slack_set_status",
    "slack_edit_message",
    "slack_delete_message",
    "slack_schedule_message",
    "slack_post_ephemeral",
    "slack_add_reaction",
    "slack_remove_reaction",
    "slack_pin_message",
    "slack_unpin_message",
    "slack_list_pins",
    "slack_create_channel",
    "slack_invite_to_channel",
    "slack_join_channel",
    "slack_leave_channel",
    "slack_set_channel_topic",
    "slack_get_channel_info",
    "slack_list_channel_members",
    "slack_lookup_user_by_email",
    "slack_list_users",
    "slack_get_user_info",
    "slack_open_dm",
    "slack_search_files",
    "slack_add_reminder",
    "slack_list_reminders",
    // Tab 30 - long-form doc surface; armed on any Slack-context message
    // so the model can promote a 2000-char reply to a canvas without
    // needing the user to say "canvas" explicitly.
    "slack_create_canvas",
  ],
  // Tab 30 - explicit canvas keywords for cross-transport prompts (e.g.
  // iMessage asking Medha to draft a doc the user will paste into Slack).
  canvas: ["slack_create_canvas"],
  "slack canvas": ["slack_create_canvas"],
  "long doc": ["slack_create_canvas"],
  "long-form": ["slack_create_canvas"],
  "newsletter draft": ["slack_create_canvas"],
  "meeting recap": ["slack_create_canvas"],
  "write-up": ["slack_create_canvas"],
  // Tab 28 - carousel keywords. Always-armed via GEN_FILE_TOOL_NAMES, but
  // keyword coverage helps the selector promote it confidently when the
  // user phrases the ask without naming the tool.
  carousel: ["generate_carousel"],
  "linkedin carousel": ["generate_carousel"],
  "slide deck": ["generate_carousel"],
  slides: ["generate_carousel"],
  infographic: ["generate_carousel"],
  "carousel post": ["generate_carousel"],
  notion: [
    "notion_search",
    "notion_get_page",
    "notion_page_to_markdown",
    "notion_get_page_property",
    "notion_create_page",
    "notion_update_page",
    "notion_archive_page",
    "notion_restore_page",
    "notion_get_block",
    "notion_get_block_children",
    "notion_append_block",
    "notion_update_block",
    "notion_delete_block",
    "notion_list_databases",
    "notion_get_database",
    "notion_query_database",
    "notion_create_database",
    "notion_update_database",
    "notion_list_comments",
    "notion_add_comment",
    "notion_me",
    "notion_list_users",
    "notion_get_user",
  ],
  drive: ["drive_list_files", "drive_search", "drive_get_file"],
  // Tab 9 — content ingest + personal repurposing loop
  ingest: ["ingest_to_drive_folder"],
  upload: ["ingest_to_drive_folder", "drive_create_file"],
  onboard: ["ingest_to_drive_folder"],
  repurpose: ["suggest_personal_repurposing"],
  repurposing: ["suggest_personal_repurposing"],
  "raw content": [
    "ingest_to_drive_folder",
    "suggest_personal_repurposing",
    "drive_list_files",
  ],
  vipassana: ["ingest_to_drive_folder", "suggest_personal_repurposing"],
  "lightning in a bottle": [
    "ingest_to_drive_folder",
    "suggest_personal_repurposing",
  ],
  "everything night": [
    "ingest_to_drive_folder",
    "suggest_personal_repurposing",
  ],
  "feedback loop": ["suggest_personal_repurposing"],
  docs: ["docs_get_document", "docs_create_document", "docs_append_text"],
  sheets: ["sheets_get_values", "sheets_append_row", "sheets_update_values"],
  // Tab 24 — analyze_tabular (code interpreter for inbound XLSX/CSV).
  // Focused multi-word keys so we don't over-trigger on every "sheet"
  // or "data" mention; the tool is also always-armed for owners.
  "analyze the spreadsheet": ["analyze_tabular"],
  "analyze this spreadsheet": ["analyze_tabular"],
  "analyze the csv": ["analyze_tabular"],
  "analyze the xlsx": ["analyze_tabular"],
  "analyze the data": ["analyze_tabular"],
  "group by": ["analyze_tabular"],
  "grouped by": ["analyze_tabular"],
  "sum of": ["analyze_tabular"],
  "average of": ["analyze_tabular"],
  "top row": ["analyze_tabular"],
  "top post": ["analyze_tabular"],
  pivot: ["analyze_tabular"],
  linkedin: ["linkedin_me", "linkedin_share_post", "linkedin_org_analytics"],
  "linkedin analytics": ["linkedin_org_analytics"],
  "posting cadence": ["linkedin_org_analytics"],
  engagement: ["linkedin_org_analytics"],
  "recurring likers": ["linkedin_org_analytics"],
  twitter: [
    "twitter_get_my_profile",
    "twitter_get_my_timeline",
    "twitter_post_tweet",
    "twitter_search_recent",
    "twitter_get_my_mentions",
    "twitter_like_tweet",
    "twitter_retweet",
    "twitter_bookmark_tweet",
  ],
  tweet: [
    "twitter_post_tweet",
    "twitter_get_tweet",
    "twitter_get_my_timeline",
    "twitter_search_recent",
    "twitter_like_tweet",
  ],
  tweets: [
    "twitter_get_my_timeline",
    "twitter_get_user_timeline",
    "twitter_search_recent",
    "twitter_post_tweet",
  ],
  x: [
    "twitter_get_my_profile",
    "twitter_get_my_timeline",
    "twitter_post_tweet",
    "twitter_search_recent",
    "twitter_get_my_mentions",
  ],
  retweet: ["twitter_retweet", "twitter_undo_retweet"],
  dm: ["twitter_send_dm", "twitter_list_dm_conversations"],
  bookmark: [
    "twitter_bookmark_tweet",
    "twitter_unbookmark_tweet",
    "twitter_list_my_bookmarks",
  ],
  follow: ["twitter_follow_user", "twitter_unfollow_user"],
  mention: ["twitter_get_my_mentions"],
  mentions: ["twitter_get_my_mentions"],
  thread: ["twitter_get_conversation_thread"],
  conversation: ["twitter_get_conversation_thread"],
  replies: ["twitter_get_conversation_thread"],
  followers: ["twitter_list_user_followers"],
  block: ["twitter_block_user", "twitter_unblock_user"],
  mute: ["twitter_mute_user", "twitter_unmute_user"],
  poll: ["twitter_post_tweet"],
  quote: ["twitter_post_tweet"],
  metrics: ["twitter_get_tweet_metrics"],
  impressions: ["twitter_get_tweet_metrics"],
  youtube: [
    "youtube_search",
    "youtube_video_details",
    "youtube_channel_videos",
  ],
  vercel: ["vercel_list_projects", "vercel_list_deployments"],
  linear: [
    "linear_list_issues",
    "linear_create_issue",
    "linear_update_issue",
    "linear_search",
  ],
  // Search: Perplexity web_search + deep_research are the primary tools
  // (Exa is a secondary, narrower supplement). Keep Perplexity first so
  // Claude picks it when a question asks for anything online / web-based.
  search: [
    "web_search",
    "deep_research",
    "exa_search",
    "exa_find_similar",
    "exa_get_contents",
  ],
  research: [
    "deep_research",
    "web_search",
    "exa_search",
    "exa_get_contents",
    "togari_search_contacts",
    "togari_enrich_person",
    "crust_enrich_person",
  ],
  // High-value single-word triggers so Camber always sees the web tools
  // when Caleb asks an "anything you can find online" style question.
  find: ["web_search", "deep_research", "exa_search"],
  lookup: ["web_search", "deep_research", "exa_search"],
  "look up": ["web_search", "deep_research", "exa_search"],
  "look them up": ["web_search", "deep_research", "exa_search"],
  google: ["web_search", "deep_research"],
  online: ["web_search", "deep_research"],
  internet: ["web_search", "deep_research"],
  web: ["web_search", "deep_research"],
  perplexity: [
    "web_search",
    "deep_research",
    "recall_partnership",
    "track_partnership",
  ],
  pplx: ["web_search", "deep_research"],
  sonar: ["web_search"],
  news: ["web_search", "deep_research"],
  article: ["web_search"],
  publication: ["web_search"],
  // Question-word / inquiry triggers
  "who is": ["web_search", "deep_research", "exa_search"],
  "what is": ["web_search", "deep_research"],
  "tell me about": ["web_search", "deep_research"],
  "info on": ["web_search", "deep_research"],
  latest: ["web_search"],
  recent: ["web_search"],
  current: ["web_search"],
  // Togari (our CRM) is preferred; Crust (Clay) is fallback enrichment.
  person: [
    "togari_search_contacts",
    "togari_enrich_person",
    "togari_get_person",
    "crust_enrich_person",
  ],
  company: [
    "togari_enrich_company",
    "togari_list_companies",
    "crust_enrich_company",
  ],
  lead: [
    "togari_submit_lead",
    "togari_create_person",
    "togari_list_people",
    "togari_search_contacts",
  ],
  contact: [
    "togari_search_contacts",
    "togari_list_people",
    "togari_get_person",
  ],
  crm: [
    "togari_list_people",
    "togari_list_companies",
    "togari_list_campaigns",
    "togari_search_contacts",
  ],
  enrich: [
    "togari_enrich_person",
    "togari_enrich_company",
    "crust_enrich_person",
    "crust_enrich_company",
  ],
  prospect: [
    "togari_search_contacts",
    "togari_list_people",
    "togari_enrich_person",
  ],
  campaign: ["togari_list_campaigns"],
  pipeline: [
    "togari_list_people",
    "togari_list_campaigns",
    "list_investors",
    "find_relationship",
  ],
  // Tab 3 — investor / event / multi-thread relationship pipelines
  investor: ["track_investor", "list_investors", "find_relationship"],
  investors: ["track_investor", "list_investors", "find_relationship"],
  funding: ["track_investor", "list_investors"],
  "term sheet": ["track_investor", "list_investors"],
  fundraise: ["track_investor", "list_investors"],
  "raise round": ["track_investor", "list_investors"],
  vipassana: ["track_event", "plan_event", "plan_event_list"],
  "lightning in a bottle": ["track_event", "plan_event", "plan_event_list"],
  "everything night": ["track_event", "plan_event", "plan_event_list"],
  rytual: [
    "track_event",
    "track_relationship",
    "plan_event",
    "plan_event_list",
  ],
  retreat: [
    "track_event",
    "plan_event",
    "plan_event_add_tasks",
    "plan_event_list",
    "plan_event_get",
    "plan_event_list_tasks",
    "plan_task_complete",
  ],
  relationship: ["track_relationship", "find_relationship"],
  relationships: ["track_relationship", "find_relationship"],
  partnership: [
    "track_partnership",
    "recall_partnership",
    "list_partnerships",
    "append_partnership_note",
    "track_relationship",
    "track_investor",
  ],
  partnerships: [
    "track_partnership",
    "recall_partnership",
    "list_partnerships",
    "append_partnership_note",
    "track_relationship",
    "track_investor",
  ],
  // Partnership phrasings Sagar actually uses. Without these, "please track
  // that we are building an enterprise partnership with X, main contact is Y"
  // never armed track_partnership — the agent would fire web_search on the
  // company name instead. CRITICAL audit gap from workflow wzhjv19sw.
  "please track": [
    "track_partnership",
    "recall_partnership",
    "list_partnerships",
    "append_partnership_note",
    "track_relationship",
    "track_investor",
  ],
  "main contact": [
    "track_partnership",
    "recall_partnership",
    "list_partnerships",
    "append_partnership_note",
    "track_relationship",
    "track_investor",
  ],
  "track that": [
    "track_partnership",
    "recall_partnership",
    "list_partnerships",
    "append_partnership_note",
    "track_relationship",
    "track_investor",
  ],
  "building a partnership": [
    "track_partnership",
    "recall_partnership",
    "list_partnerships",
    "append_partnership_note",
    "track_relationship",
    "track_investor",
  ],
  "enterprise partnership": [
    "track_partnership",
    "recall_partnership",
    "list_partnerships",
    "append_partnership_note",
    "track_relationship",
    "track_investor",
  ],
  "federal tax credit": [
    "track_partnership",
    "recall_partnership",
    "list_partnerships",
    "append_partnership_note",
    "track_relationship",
    "track_investor",
  ],
  "tax credits": [
    "track_partnership",
    "recall_partnership",
    "list_partnerships",
    "append_partnership_note",
    "track_relationship",
    "track_investor",
  ],
  // Lookup key is lowercased before .includes() in selectToolsByKeyword,
  // so "ira" matches "IRA" / "Ira" alike. Narrow enough that pure-noise
  // false positives are rare (and a recall_partnership arm in a noisy
  // turn is harmless).
  ira: [
    "track_partnership",
    "recall_partnership",
    "list_partnerships",
    "append_partnership_note",
    "track_relationship",
    "track_investor",
  ],
  "better buildings": [
    "track_partnership",
    "recall_partnership",
    "list_partnerships",
    "append_partnership_note",
    "track_relationship",
    "track_investor",
  ],
  bbb: [
    "track_partnership",
    "recall_partnership",
    "list_partnerships",
    "append_partnership_note",
    "track_relationship",
    "track_investor",
  ],
  advisor: [
    "track_partnership",
    "recall_partnership",
    "list_partnerships",
    "append_partnership_note",
    "track_relationship",
    "track_investor",
  ],
  vendor: [
    "track_partnership",
    "recall_partnership",
    "list_partnerships",
    "append_partnership_note",
    "track_relationship",
    "track_investor",
  ],
  // Named-entity arms — when Sagar names a real contact, prefer recall first
  // (in case we already know them) then track to capture new info.
  "alex tsai": ["recall_partnership", "track_partnership"],
  carlo: ["recall_partnership", "track_partnership"],
  "cory reeder": ["recall_partnership", "track_partnership"],
  karthik: ["recall_partnership", "update_contact_context"],
  // Recall verbs — questions about what we know about someone/something.
  "what do you know about": ["recall_partnership", "list_partnerships"],
  "tell me what": ["recall_partnership", "list_partnerships"],
  "tell me about my": [
    "recall_partnership",
    "list_partnerships",
    "list_content_seeds",
  ],
  "where are we with": ["recall_partnership", "list_partnerships"],
  // Context-update verbs — status changes on a known relationship.
  shipped: ["update_contact_context"],
  "moved to": ["update_contact_context"],
  // Training-data keywords — Caleb's voice + asset capture pipeline.
  "training data": ["tag_asset", "track_author_voice"],
  "extract from my head": ["track_author_voice", "tag_asset"],
  // GitHub keywords trigger no additional tools because `github_*` is
  // prefix-matched into coreTools in agent.js (always armed). The full
  // surface (repos / files / issues / PRs / branches / gists / workflows
  // / search / notifications) ships in tools/github/tools.js — adding a
  // schema there auto-arms it on every turn.
  repo: [],
  github: [],
  issue: [],
  pr: [],
  "pull request": [],
  gist: [],
  workflow: [],
  "github actions": [],
  // Railway: NOT prefix-armed (unlike github_*), so keyword aliases are
  // the only way railway_* tools get into the model's tool list. Keep
  // the surface compact -- arm the most useful tools for each verb so
  // the agent has enough to act on a single user request without
  // ballooning the per-turn payload.
  railway: [
    "railway_get_user",
    "railway_list_projects",
    "railway_list_services",
    "railway_list_deployments",
    "railway_get_deploy_status",
  ],
  deploy: [
    "railway_list_services",
    "railway_list_deployments",
    "railway_get_deploy_status",
    "railway_trigger_deploy",
  ],
  redeploy: [
    "railway_list_services",
    "railway_get_deploy_status",
    "railway_trigger_deploy",
  ],
  rollback: ["railway_list_deployments", "railway_rollback_deploy"],
  "roll back": ["railway_list_deployments", "railway_rollback_deploy"],
  "deploy status": ["railway_get_deploy_status", "railway_get_deploy_logs"],
  "deploy logs": ["railway_get_deploy_logs"],
  "build logs": ["railway_get_deploy_logs"],
  // Module-name keywords: if the user mentions a tool/system BY NAME
  // ("what is togari", "can you use beads"), arm a representative slice
  // of that module so the agent sees it's real and can demonstrate.
  togari: [
    "togari_search_contacts",
    "togari_list_people",
    "togari_enrich_person",
    "togari_submit_lead",
  ],
  beads: ["task_list", "task_create", "task_search"],
  // Tab 2 — cross-person reminders. Keywords intentionally narrow:
  // "remind" is already in CALENDAR_ALIASES so the calendar surface
  // also arms; these keywords push schedule_reminder onto that surface
  // when the user is clearly asking for a reminder (not a meeting).
  // Tab 16 — list / cancel arms when the user is asking about the
  // queue, not creating new ones. "my reminders" / "list reminders" /
  // "cancel" route to list_my_reminders + cancel_reminder so the model
  // has the full CRUD surface available.
  remind: ["schedule_reminder", "list_my_reminders", "cancel_reminder"],
  reminder: ["schedule_reminder", "list_my_reminders", "cancel_reminder"],
  reminders: ["list_my_reminders", "cancel_reminder"],
  "my reminders": ["list_my_reminders"],
  "list reminders": ["list_my_reminders"],
  "cancel reminder": ["cancel_reminder", "list_my_reminders"],
  "drop the reminder": ["cancel_reminder", "list_my_reminders"],
  "make a note": ["schedule_reminder"],
  "note to self": ["schedule_reminder"],
  "ping me": ["schedule_reminder"],
  "nudge me": ["schedule_reminder"],
  // T15 — personal event + task planning. Keywords that signal the user
  // is setting up or referencing an event-with-tasks. Distinct from the
  // group-chat `event_create` (events-tool.js / BigQuery) — these tools
  // hit medha-id /v1/me/events for personal planning with checklists.
  "plan an event": [
    "plan_event",
    "plan_event_add_tasks",
    "plan_event_list",
    "plan_event_get",
  ],
  "plan my": [
    "plan_event",
    "plan_event_add_tasks",
    "plan_event_list",
    "plan_event_get",
  ],
  wedding: [
    "plan_event",
    "plan_event_add_tasks",
    "plan_event_list",
    "plan_event_get",
    "plan_event_list_tasks",
  ],
  gathering: [
    "plan_event",
    "plan_event_add_tasks",
    "plan_event_list",
    "plan_event_list_tasks",
  ],
  festival: [
    "plan_event",
    "plan_event_add_tasks",
    "plan_event_list",
    "plan_event_list_tasks",
  ],
  birthday: [
    "plan_event",
    "plan_event_add_tasks",
    "plan_event_list",
    "plan_event_list_tasks",
  ],
  "tasks for": [
    "plan_event_list",
    "plan_event_get",
    "plan_event_list_tasks",
    "plan_task_complete",
  ],
  "what's left": ["plan_event_list", "plan_event_get", "plan_event_list_tasks"],
  "still need to do": [
    "plan_event_list",
    "plan_event_get",
    "plan_event_list_tasks",
  ],
  "mark.*done": ["plan_event_list_tasks", "plan_task_complete"],
  "mark complete": ["plan_event_list_tasks", "plan_task_complete"],
  trip: ["list_trips", "create_trip", "get_trip"],
  travel: ["list_trips", "create_trip", "get_trip"],
  itinerary: ["list_trips", "get_trip", "add_to_itinerary"],
  packing: ["get_packing_list", "add_packing_item"],
  budget: ["get_budget_summary", "add_expense"],
  reservation: ["add_reservation", "get_trip"],
  crust: ["crust_enrich_person", "crust_enrich_company"],
  clay: ["crust_enrich_person", "crust_enrich_company"],
  exa: ["exa_search", "exa_find_similar", "exa_get_contents"],
  peoplerank: ["peoplerank_query", "peoplerank_top"],
  bma: [
    "togari_search_contacts",
    "togari_list_people",
    "togari_enrich_person",
    "togari_submit_lead",
  ],
  coordination: ["send_cross_agent_message"],
  // Gap-skill modules
  pdf: [
    "generate_pdf",
    "pdf_merge",
    "pdf_split",
    "pdf_to_text",
    "pdf_add_watermark",
    "ocr_extract_text",
    "claude_vision_extract",
  ],
  ocr: ["ocr_extract_text", "claude_vision_extract"],
  scan: ["ocr_extract_text", "claude_vision_extract"],
  transcribe: ["transcribe_audio"],
  transcript: ["transcribe_audio"],
  audio: ["transcribe_audio", "tts_generate"],
  voice: ["tts_generate"],
  speak: ["tts_generate"],
  image: ["generate_image"],
  picture: ["generate_image"],
  illustration: ["generate_image"],
  // PR-G / PR-F file generators (no API keys, native libs)
  docx: ["generate_docx"],
  "word doc": ["generate_docx"],
  "word document": ["generate_docx"],
  xlsx: ["generate_xlsx"],
  spreadsheet: ["generate_xlsx", "generate_csv"],
  excel: ["generate_xlsx"],
  csv: ["generate_csv", "generate_xlsx"],
  markdown: ["generate_markdown"],
  ".md": ["generate_markdown"],
  "text file": ["generate_text"],
  ".txt": ["generate_text"],
  json: ["generate_json"],
  ".json": ["generate_json"],
  "code file": ["generate_code_file"],
  ".py": ["generate_code_file"],
  ".js": ["generate_code_file"],
  ".ts": ["generate_code_file"],
  ".html": ["generate_code_file"],
  // Generate-verb combos so "make me a pdf" / "send me a docx" fire correctly
  "generate a pdf": ["generate_pdf"],
  "generate a docx": ["generate_docx"],
  "generate a spreadsheet": ["generate_xlsx", "generate_csv"],
  "generate a csv": ["generate_csv"],
  "make me a pdf": ["generate_pdf"],
  "make me a docx": ["generate_docx"],
  "make me a spreadsheet": ["generate_xlsx", "generate_csv"],
  "make me a csv": ["generate_csv"],
  "send me a pdf": ["generate_pdf"],
  "send me a docx": ["generate_docx"],
  "send me a csv": ["generate_csv"],
  // Wave 1 Tab 18: dimension-filtered semantic recall
  spiritual: ["recall_by_dimension"],
  emotional: ["recall_by_dimension"],
  physical: ["recall_by_dimension"],
  financial: ["recall_by_dimension"],
  intellectual: ["recall_by_dimension"],
  social: ["recall_by_dimension"],
  dimension: ["recall_by_dimension"],
  "by dimension": ["recall_by_dimension"],
  // Wave 1 Tab 20: forget + snapshot
  forget: ["forget_memory"],
  "forget that": ["forget_memory"],
  "forget the": ["forget_memory"],
  "forget what": ["forget_memory"],
  "don't remember": ["forget_memory"],
  "wipe my": ["forget_memory"],
  "delete the": ["forget_memory"],
  snapshot: ["memory_snapshot"],
  "as of": ["memory_snapshot"],
  "what did you know": ["memory_snapshot"],
  "point in time": ["memory_snapshot"],
  screenshot: ["web_screenshot"],
  website: ["web_fetch_markdown", "web_screenshot"],
  webpage: ["web_fetch_markdown"],
  browse: ["web_fetch_markdown"],
  home: ["home_list_entities", "home_get_state", "home_call_service"],
  light: ["home_list_entities", "home_call_service"],
  thermostat: ["home_call_service"],
  lock: ["home_list_entities", "home_call_service"],
  // Tab 4 — team content visibility surface
  team: ["show_team_content"],
  teammate: ["show_team_content"],
  teammates: ["show_team_content"],
  content: ["show_team_content"],
  shipping: ["show_team_content"],
  output: ["show_team_content"],
  "what is shirley doing": ["show_team_content"],
  "what is alinna doing": ["show_team_content"],
  "what is emily doing": ["show_team_content"],
  "what has the team": ["show_team_content"],
  "team output": ["show_team_content"],
  "team activity": ["show_team_content"],
  "what are they working on": ["show_team_content"],
  // T20 — journal mode. Capture + recall pair. The capture tool already
  // existed (add_journal_entry from the personal-life surface); recall_journal
  // is the new sibling that lets Medha pull prior entries on demand.
  // These keywords intentionally lean reflective / narrative — Sagar's
  // "yapping" mode — so a one-word "journal" or a "today I learned"
  // arms both, but a purely transactional message doesn't.
  journal: ["add_journal_entry", "recall_journal"],
  journaling: ["add_journal_entry", "recall_journal"],
  yap: ["add_journal_entry"],
  yapping: ["add_journal_entry"],
  "yap about": ["add_journal_entry"],
  "today i learned": ["add_journal_entry"],
  "today i realized": ["add_journal_entry"],
  "been thinking about": ["add_journal_entry", "recall_journal"],
  "thinking about": ["add_journal_entry", "recall_journal"],
  "had a conversation": ["add_journal_entry"],
  "creative conversation": ["add_journal_entry"],
  "creative conversations": ["add_journal_entry", "recall_journal"],
  "tell me what i said": ["recall_journal"],
  "what have i been thinking": ["recall_journal"],
  "what was i musing": ["recall_journal"],
  "what was i yapping": ["recall_journal"],
  "remind me what i said": ["recall_journal"],
};

const CALENDAR_ALIASES = [
  "schedule",
  "meeting",
  "event",
  "tomorrow",
  "today",
  "planning",
  "session",
  "appointment",
  "book",
  "set up",
  "next week",
  "this week",
  "remind",
  "calendar",
  "invite",
  "rsvp",
  "availability",
  "free time",
  "agenda",
  // Tab 25 — block scheduling + focus time phrasings.
  "block",
  "focus",
  "deep work",
  "free block",
  "protect",
  "reschedule",
];
const EMAIL_ALIASES = ["mail", "inbox", "send"];

export function selectToolsByKeyword(userText) {
  const lower = String(userText || "").toLowerCase();
  const selected = new Set();
  for (const [keyword, toolNames] of Object.entries(TOOL_KEYWORDS)) {
    if (lower.includes(keyword)) {
      for (const name of toolNames) selected.add(name);
    }
  }
  if (CALENDAR_ALIASES.some((a) => lower.includes(a))) {
    for (const name of TOOL_KEYWORDS.calendar) selected.add(name);
    // Also arm Microsoft Calendar tools so the LLM can pick mscal_* when
    // the user's Microsoft account is connected. Capability discovery in
    // connections-discovery.js tells the model which one to call.
    for (const name of TOOL_KEYWORDS.mscal) selected.add(name);
  }
  if (EMAIL_ALIASES.some((a) => lower.includes(a))) {
    for (const name of TOOL_KEYWORDS.email) selected.add(name);
    // Same reasoning for Outlook: arm both gmail_* and outlook_* on bare
    // "send an email" / "inbox" mentions.
    for (const name of TOOL_KEYWORDS.outlook) selected.add(name);
  }
  return [...selected];
}
