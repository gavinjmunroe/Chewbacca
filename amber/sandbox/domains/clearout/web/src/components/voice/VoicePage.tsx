"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/Button"
import type { TriageQueueItem } from "@/types/database"
import type { DailyBriefing } from "@/types/messages"
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  ChevronRight,
  ChevronLeft,
  Archive,
  CheckCheck,
  Clock,
  MessageSquarePlus,
  Sparkles,
  Play,
} from "lucide-react"
import { formatRelativeTime, getInitials } from "@/lib/utils"

interface VoicePageProps {
  initialQueue: TriageQueueItem[]
  briefing: DailyBriefing | null
  userMemory: unknown | null
  userName: string
  userId: string
}

type SessionState = "idle" | "briefing" | "clearing" | "listening" | "processing" | "speaking"

export function VoicePage({
  initialQueue,
  briefing,
  userName,
}: VoicePageProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [sessionState, setSessionState] = useState<SessionState>("idle")
  const [transcript, setTranscript] = useState("")
  const [speakingText, setSpeakingText] = useState("")
  const [isMuted, setIsMuted] = useState(false)
  const [log, setLog] = useState<Array<{ id: number; type: "user" | "ai" | "action"; text: string }>>([])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null)
  const logIdRef = useRef(0)

  const currentThread = initialQueue[currentIndex]

  const speak = useCallback(
    (text: string) => {
      if (isMuted || !("speechSynthesis" in window)) return

      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 1.1
      utterance.pitch = 1.0
      utterance.volume = 1.0
      utterance.onstart = () => setSessionState("speaking")
      utterance.onend = () => setSessionState("clearing")
      synthRef.current = utterance
      setSpeakingText(text)
      window.speechSynthesis.speak(utterance)
      addLog("ai", text)
    },
    [isMuted]
  )

  function addLog(type: "user" | "ai" | "action", text: string) {
    logIdRef.current++
    const id = logIdRef.current
    setLog(prev => [...prev.slice(-20), { id, type, text }])
  }

  function startListening() {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      addLog("ai", "Voice recognition is not supported in this browser. Please use Chrome or Edge.")
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition

    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = "en-US"

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript
      setTranscript(text)
      addLog("user", text)
      handleVoiceCommand(text)
    }

    recognition.onerror = () => {
      setSessionState("clearing")
    }

    recognition.onend = () => {
      if (sessionState === "listening") {
        setSessionState("clearing")
      }
    }

    recognitionRef.current = recognition
    recognition.start()
    setSessionState("listening")
    setTranscript("")
  }

  async function handleVoiceCommand(text: string) {
    setSessionState("processing")
    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text }),
      })

      if (!res.ok) return

      const { command } = await res.json()
      addLog("action", `Intent: ${command.intent}`)

      switch (command.intent) {
        case "next":
          if (currentIndex < initialQueue.length - 1) {
            setCurrentIndex(i => i + 1)
            speak("Moving to next message.")
          } else {
            speak("You've reached the end of your queue. Great work.")
          }
          break
        case "skip":
          setCurrentIndex(i => Math.min(i + 1, initialQueue.length - 1))
          speak("Skipped.")
          break
        case "archive":
          if (currentThread) {
            await fetch("/api/actions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ thread_id: currentThread.id, action: "archive", approved_by: "voice" }),
            })
            setCurrentIndex(i => Math.min(i + 1, initialQueue.length - 1))
            speak("Archived. Moving on.")
          }
          break
        case "done":
          if (currentThread) {
            await fetch("/api/actions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ thread_id: currentThread.id, action: "done", approved_by: "voice" }),
            })
            setCurrentIndex(i => Math.min(i + 1, initialQueue.length - 1))
            speak("Marked done. Next.")
          }
          break
        case "draft_reply": {
          if (currentThread) {
            speak("Generating a reply draft. One moment.")
            const draftRes = await fetch("/api/drafts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                thread_id: currentThread.id,
                voice_instruction: command.parameters?.instruction,
              }),
            })
            if (draftRes.ok) {
              const { content } = await draftRes.json()
              speak(`Here's a draft reply: ${content.slice(0, 200)}${content.length > 200 ? "..." : ""}`)
            }
          }
          break
        }
        case "read_summary":
          if (currentThread?.summary) {
            speak(currentThread.summary)
          }
          break
        case "stop":
          setSessionState("idle")
          speak("Stopping voice session. You can review your inbox on screen.")
          break
        case "briefing": {
          const briefRes = await fetch("/api/voice?action=briefing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          })
          if (briefRes.ok) {
            const { text } = await briefRes.json()
            speak(text)
          }
          break
        }
        default:
          speak("I didn't quite catch that. Try saying next, archive, done, or generate a reply.")
      }
    } catch {
      speak("Something went wrong. Please try again.")
      setSessionState("clearing")
    }
  }

  async function startBriefing() {
    setSessionState("briefing")
    const res = await fetch("/api/voice?action=briefing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    if (res.ok) {
      const { text } = await res.json()
      speak(text)
    }
  }

  async function startClearing() {
    setSessionState("clearing")
    if (currentThread) {
      const res = await fetch("/api/voice?action=readout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: currentThread.id, mode: "brief" }),
      })
      if (res.ok) {
        const { text } = await res.json()
        speak(text)
      }
    }
  }

  const isActive = sessionState !== "idle"

  return (
    <div className="flex flex-col h-full bg-co-dark">
      {/* Center area */}
      <div className="flex-1 flex flex-col items-center justify-center gap-8 px-4">
        {/* Voice orb */}
        <div className="relative">
          <div
            className={`w-32 h-32 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300 ${
              sessionState === "listening"
                ? "bg-red-500/20 border-2 border-red-500 voice-ring"
                : sessionState === "speaking"
                ? "bg-co-blue/20 border-2 border-co-blue"
                : sessionState === "processing"
                ? "bg-yellow-500/20 border-2 border-yellow-500 animate-pulse"
                : "bg-co-panel border-2 border-co-border hover:border-co-blue/50"
            }`}
            role="button"
            tabIndex={0}
            onClick={sessionState === "listening" ? () => {
              recognitionRef.current?.stop()
              setSessionState("clearing")
            } : isActive ? startListening : startClearing}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                if (sessionState === "listening") {
                  recognitionRef.current?.stop()
                  setSessionState("clearing")
                } else if (isActive) {
                  startListening()
                } else {
                  startClearing()
                }
              }
            }}
          >
            {sessionState === "listening" ? (
              <MicOff className="w-10 h-10 text-red-400" />
            ) : sessionState === "speaking" ? (
              <Volume2 className="w-10 h-10 text-co-blue animate-pulse" />
            ) : (
              <Mic className="w-10 h-10 text-foreground/60" />
            )}
          </div>
        </div>

        {/* State label */}
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-foreground">
            {sessionState === "idle" && "Voice Mode"}
            {sessionState === "briefing" && "Reading briefing..."}
            {sessionState === "clearing" && "Ready to listen"}
            {sessionState === "listening" && "Listening..."}
            {sessionState === "processing" && "Processing..."}
            {sessionState === "speaking" && "Speaking..."}
          </p>
          {transcript && sessionState !== "idle" && (
            <p className="text-xs text-muted-foreground italic">&ldquo;{transcript}&rdquo;</p>
          )}
        </div>

        {/* Current thread card */}
        {currentThread && isActive && (
          <div className="w-full max-w-sm bg-co-panel border border-co-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{currentIndex + 1} of {initialQueue.length}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
                  disabled={currentIndex === 0}
                  className="p-1 rounded hover:bg-co-border disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setCurrentIndex(i => Math.min(initialQueue.length - 1, i + 1))}
                  disabled={currentIndex === initialQueue.length - 1}
                  className="p-1 rounded hover:bg-co-border disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-co-border flex items-center justify-center text-sm font-medium shrink-0">
                {getInitials(currentThread.latest_from)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">
                  {currentThread.latest_from ?? "Unknown"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {currentThread.subject ?? "(no subject)"}
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {formatRelativeTime(currentThread.last_message_at)}
              </span>
            </div>

            {currentThread.summary && (
              <p className="text-xs text-foreground/70 leading-relaxed">
                {currentThread.summary}
              </p>
            )}

            {/* Quick action buttons */}
            <div className="flex items-center gap-1.5">
              {[
                { icon: Archive, label: "Archive", action: "archive" },
                { icon: CheckCheck, label: "Done", action: "done" },
                { icon: Clock, label: "Snooze", action: "snooze" },
                { icon: MessageSquarePlus, label: "Draft", action: "draft_reply" },
              ].map(({ icon: Icon, label, action }) => (
                <button
                  key={action}
                  onClick={() => handleVoiceCommand(label.toLowerCase())}
                  className="flex-1 flex flex-col items-center gap-0.5 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-co-border transition-colors"
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-[9px]">{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Idle start options */}
        {!isActive && (
          <div className="flex flex-col items-center gap-3 w-full max-w-xs">
            <Button
              size="lg"
              className="w-full"
              onClick={startClearing}
              disabled={initialQueue.length === 0}
            >
              <Play className="w-4 h-4" />
              Start Clearing ({initialQueue.length} messages)
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={startBriefing}
            >
              <Sparkles className="w-4 h-4" />
              Morning Briefing
            </Button>
          </div>
        )}

        {/* Mute toggle */}
        {isActive && (
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            {isMuted ? "Unmute voice" : "Mute voice"}
          </button>
        )}
      </div>

      {/* Voice log */}
      {log.length > 0 && (
        <div className="border-t border-co-border px-4 py-3 max-h-32 overflow-y-auto">
          <div className="space-y-1">
            {log.slice(-5).map((entry) => (
              <div key={entry.id} className="flex items-start gap-2">
                <span className={`text-[10px] font-medium shrink-0 ${
                  entry.type === "user" ? "text-co-blue" :
                  entry.type === "ai" ? "text-foreground/60" : "text-yellow-400"
                }`}>
                  {entry.type === "user" ? "You" : entry.type === "ai" ? "AI" : "→"}
                </span>
                <span className="text-[10px] text-muted-foreground line-clamp-2">{entry.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
