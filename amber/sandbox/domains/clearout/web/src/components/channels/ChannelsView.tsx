"use client"

import { useState, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import type { Channel } from "@/types/messages"
import { Button } from "@/components/ui/Button"
import { Badge } from "@/components/ui/Badge"
import { formatRelativeTime } from "@/lib/utils"
import { Plus, RefreshCw, CheckCircle, AlertCircle, Loader2, Trash2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

interface ChannelsViewProps {
  channels: Channel[]
  userId: string
}

const AVAILABLE_CHANNELS = [
  {
    type: "gmail",
    name: "Gmail",
    description: "Connect your Gmail inbox for email triage and AI replies",
    icon: "GM",
    status: "available",
  },
  {
    type: "slack",
    name: "Slack",
    description: "Connect your Slack workspace to clear channel noise and DMs",
    icon: "SL",
    status: "available",
  },
  {
    type: "imessage",
    name: "iMessage",
    description: "Connect iMessage for AI-powered text management",
    icon: "IM",
    status: "coming_soon",
  },
  {
    type: "outlook",
    name: "Outlook",
    description: "Connect Microsoft Outlook for enterprise email management",
    icon: "OL",
    status: "coming_soon",
  },
  {
    type: "whatsapp",
    name: "WhatsApp",
    description: "Manage WhatsApp messages with AI intelligence",
    icon: "WA",
    status: "coming_soon",
  },
]

export function ChannelsView({ channels, userId }: ChannelsViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [connectingType, setConnectingType] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null)

  useEffect(() => {
    const connected = searchParams.get("connected")
    const error = searchParams.get("error")
    const doSync = searchParams.get("sync")

    if (connected) {
      setNotification({ type: "success", message: `${connected.charAt(0).toUpperCase() + connected.slice(1)} connected successfully!` })
      if (doSync === "true") {
        // Trigger sync for the newly connected channel
        const ch = channels.find(c => c.type === connected)
        if (ch) handleSync(ch.id)
      }
    } else if (error) {
      setNotification({ type: "error", message: `Connection failed: ${error.replace(/_/g, " ")}` })
    }
  }, [])

  async function handleConnect(type: string) {
    setConnectingType(type)
    try {
      const res = await fetch(`/api/channels/${type}`)
      if (res.ok) {
        const { url } = await res.json()
        window.location.href = url
      }
    } catch {
      setConnectingType(null)
    }
  }

  async function handleSync(channelId: string) {
    setSyncingId(channelId)
    try {
      await fetch("/api/messages/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channelId }),
      })
      router.refresh()
    } finally {
      setSyncingId(null)
    }
  }

  async function handleDisconnect(channelId: string) {
    if (!confirm("Disconnect this channel? Your synced messages will remain.")) return

    await (supabase as any)
      .from("channels")
      .update({ is_active: false } as any)
      .eq("id", channelId)
      .eq("user_id", userId)

    router.refresh()
  }

  const connectedTypes = new Set(channels.filter(c => c.is_active).map(c => c.type))

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-8">
      {/* Notification */}
      {notification && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm ${
          notification.type === "success"
            ? "bg-green-500/10 border border-green-500/20 text-green-400"
            : "bg-red-500/10 border border-red-500/20 text-red-400"
        }`}>
          {notification.type === "success" ? (
            <CheckCircle className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          {notification.message}
        </div>
      )}

      {/* Connected channels */}
      {channels.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">Connected Channels</h2>
          <div className="space-y-2">
            {channels.map(channel => (
              <div
                key={channel.id}
                className="flex items-center gap-3 p-4 bg-co-panel border border-co-border rounded-xl"
              >
                <div className="w-9 h-9 rounded-lg bg-co-border flex items-center justify-center text-lg shrink-0">
                  {AVAILABLE_CHANNELS.find(a => a.type === channel.type)?.icon ?? "CH"}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {channel.display_name ?? channel.account_email ?? channel.workspace_name}
                    </span>
                    <Badge
                      variant={channel.is_active ? "success" : "ghost"}
                      className="text-[10px]"
                    >
                      {channel.is_active ? "Active" : "Paused"}
                    </Badge>
                    {channel.sync_status === "syncing" && (
                      <Loader2 className="w-3 h-3 animate-spin text-co-blue" />
                    )}
                    {channel.sync_status === "error" && (
                      <span title={channel.error_message ?? ""}><AlertCircle className="w-3 h-3 text-red-400" /></span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {channel.account_email ?? channel.workspace_name ?? channel.type}
                    {channel.last_synced_at && (
                      <span> · Last synced {formatRelativeTime(channel.last_synced_at)}</span>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleSync(channel.id)}
                    loading={syncingId === channel.id}
                    title="Sync now"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDisconnect(channel.id)}
                    title="Disconnect"
                    className="text-muted-foreground hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Add channels */}
      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">
          {channels.length > 0 ? "Add More Channels" : "Connect Your First Channel"}
        </h2>
        <div className="space-y-2">
          {AVAILABLE_CHANNELS.map(ch => {
            const isConnected = connectedTypes.has(ch.type as Channel["type"])
            const isConnecting = connectingType === ch.type

            return (
              <div
                key={ch.type}
                className="flex items-center gap-3 p-4 bg-co-panel border border-co-border rounded-xl"
              >
                <div className="w-9 h-9 rounded-lg bg-co-border flex items-center justify-center text-lg shrink-0">
                  {ch.icon}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{ch.name}</span>
                    {isConnected && <Badge variant="success" className="text-[10px]">Connected</Badge>}
                    {ch.status === "coming_soon" && <Badge variant="ghost" className="text-[10px]">Coming soon</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{ch.description}</p>
                </div>

                {ch.status === "available" && !isConnected && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleConnect(ch.type)}
                    loading={isConnecting}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Connect
                  </Button>
                )}
                {isConnected && (
                  <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
