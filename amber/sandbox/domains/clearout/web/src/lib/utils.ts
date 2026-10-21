import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatRelativeTime(date: string | Date | null): string {
  if (!date) return ""

  const now = new Date()
  const then = new Date(date)
  const diff = now.getTime() - then.getTime()

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`

  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + "..."
}

export function getUrgencyColor(score: number): string {
  if (score >= 75) return "text-red-400"
  if (score >= 50) return "text-orange-400"
  if (score >= 25) return "text-yellow-400"
  return "text-muted-foreground"
}

export function getUrgencyBorderClass(score: number): string {
  if (score >= 75) return "priority-urgent"
  if (score >= 50) return "priority-high"
  if (score >= 25) return "priority-medium"
  return "priority-low"
}

export function getChannelIcon(type: string): string {
  const icons: Record<string, string> = {
    gmail: "GM",
    slack: "SL",
    imessage: "IM",
    sms: "SM",
    outlook: "OL",
    whatsapp: "WA",
  }
  return icons[type] ?? "CH"
}

export function getInitials(name?: string | null): string {
  if (!name) return "?"
  return name
    .split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export function getSentimentColor(sentiment: string): string {
  const map: Record<string, string> = {
    positive: "text-green-400",
    neutral: "text-muted-foreground",
    negative: "text-orange-400",
    urgent: "text-red-400",
    emotional: "text-purple-400",
  }
  return map[sentiment] ?? "text-muted-foreground"
}
