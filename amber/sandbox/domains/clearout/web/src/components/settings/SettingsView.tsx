"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"
import type { Profile, UserMemory, Channel } from "@/types/messages"
import { createClient } from "@/lib/supabase/client"
import { User, Bell, Shield, Brain, Save } from "lucide-react"

interface SettingsViewProps {
  profile: Profile | null
  memory: UserMemory | null
  channels: Partial<Channel>[]
  userId: string
}

export function SettingsView({ profile, memory }: SettingsViewProps) {
  const router = useRouter()
  const supabase = createClient()
  const [isSaving, setIsSaving] = useState(false)
  const [name, setName] = useState(profile?.full_name ?? "")
  const [timezone, setTimezone] = useState(profile?.timezone ?? "UTC")
  const [dailyBriefing, setDailyBriefing] = useState(
    (memory?.communication_preferences as Record<string, unknown>)?.daily_briefing !== false
  )
  const [checkBeforeSend, setCheckBeforeSend] = useState(
    (memory?.communication_preferences as Record<string, unknown>)?.check_before_send !== false
  )
  const [autoArchiveNewsletters, setAutoArchiveNewsletters] = useState(
    (memory?.communication_preferences as Record<string, unknown>)?.auto_archive_newsletters !== false
  )
  const [voiceEnabled, setVoiceEnabled] = useState(
    (memory?.communication_preferences as Record<string, unknown>)?.voice_enabled === true
  )

  async function handleSave() {
    setIsSaving(true)
    try {
      // Update profile
      await (supabase as any)
        .from("profiles")
        .update({ full_name: name, timezone })
        .eq("id", userId ?? "")

      // Update memory preferences
      await (supabase as any)
        .from("user_memory")
        .upsert({
          user_id: userId ?? "",
          communication_preferences: {
            daily_briefing: dailyBriefing,
            check_before_send: checkBeforeSend,
            auto_archive_newsletters: autoArchiveNewsletters,
            voice_enabled: voiceEnabled,
          },
        }, { onConflict: "user_id" })

      router.refresh()
    } finally {
      setIsSaving(false)
    }
  }

  const userId = profile?.id ?? ""

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-8">
      <h1 className="text-lg font-semibold text-foreground">Settings</h1>

      {/* Profile */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-co-blue" />
          <h2 className="text-sm font-semibold text-foreground">Profile</h2>
        </div>
        <div className="bg-co-panel border border-co-border rounded-xl p-4 space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="settings-name" className="text-xs text-muted-foreground">Display name</label>
            <input
              id="settings-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-co-surface border border-co-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-co-blue"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="settings-email" className="text-xs text-muted-foreground">Email</label>
            <input
              id="settings-email"
              type="email"
              value={profile?.email ?? ""}
              disabled
              className="w-full bg-co-surface border border-co-border rounded-xl px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="settings-timezone" className="text-xs text-muted-foreground">Timezone</label>
            <select
              id="settings-timezone"
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              className="w-full bg-co-surface border border-co-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-co-blue"
            >
              <option value="UTC">UTC</option>
              <option value="America/New_York">Eastern Time</option>
              <option value="America/Chicago">Central Time</option>
              <option value="America/Denver">Mountain Time</option>
              <option value="America/Los_Angeles">Pacific Time</option>
              <option value="Europe/London">London</option>
              <option value="Europe/Paris">Paris</option>
              <option value="Asia/Tokyo">Tokyo</option>
            </select>
          </div>
        </div>
      </section>

      {/* Notifications */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-co-blue" />
          <h2 className="text-sm font-semibold text-foreground">Notifications & Briefings</h2>
        </div>
        <div className="bg-co-panel border border-co-border rounded-xl p-4 space-y-3">
          {[
            {
              label: "Daily morning briefing",
              description: "Get a voice or text summary of your communications each morning",
              value: dailyBriefing,
              onChange: setDailyBriefing,
            },
            {
              label: "Voice mode enabled",
              description: "Allow ClearOut to read messages and listen for voice commands",
              value: voiceEnabled,
              onChange: setVoiceEnabled,
            },
          ].map(item => (
            <div key={item.label} className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
              <button
                onClick={() => item.onChange(!item.value)}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
                  item.value ? "bg-co-blue" : "bg-co-border"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    item.value ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* AI Behavior */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-co-blue" />
          <h2 className="text-sm font-semibold text-foreground">AI Behavior</h2>
        </div>
        <div className="bg-co-panel border border-co-border rounded-xl p-4 space-y-3">
          {[
            {
              label: "Review before sending",
              description: "Always require your approval before ClearOut sends any message",
              value: checkBeforeSend,
              onChange: setCheckBeforeSend,
            },
            {
              label: "Auto-archive newsletters",
              description: "Automatically archive promotional emails and newsletters",
              value: autoArchiveNewsletters,
              onChange: setAutoArchiveNewsletters,
            },
          ].map(item => (
            <div key={item.label} className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
              <button
                onClick={() => item.onChange(!item.value)}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
                  item.value ? "bg-co-blue" : "bg-co-border"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    item.value ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Privacy */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-co-blue" />
          <h2 className="text-sm font-semibold text-foreground">Privacy</h2>
        </div>
        <div className="bg-co-panel border border-co-border rounded-xl p-4 text-sm text-muted-foreground space-y-2">
          <p>Your messages are processed securely using end-to-end encryption.</p>
          <p>AI triage and drafting are performed without storing your raw message content beyond your active session.</p>
          <p>You can delete all your data at any time from this page.</p>
          <button className="text-red-400 hover:text-red-300 transition-colors text-xs mt-2">
            Request data deletion
          </button>
        </div>
      </section>

      {/* Save */}
      <div className="pt-2">
        <Button onClick={handleSave} loading={isSaving} className="w-full">
          <Save className="w-4 h-4" />
          Save changes
        </Button>
      </div>
    </div>
  )
}
