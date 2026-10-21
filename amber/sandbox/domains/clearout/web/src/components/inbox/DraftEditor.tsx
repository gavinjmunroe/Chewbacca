"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/Button"
import type { Draft, DraftTone } from "@/types/messages"
import { Sparkles, Send, Trash2, Edit3, Check, X, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

const TONES: { value: DraftTone; label: string }[] = [
  { value: "balanced", label: "Balanced" },
  { value: "formal", label: "Formal" },
  { value: "casual", label: "Casual" },
  { value: "warm", label: "Warm" },
  { value: "brief", label: "Brief" },
  { value: "empathetic", label: "Empathetic" },
  { value: "assertive", label: "Assertive" },
]

interface DraftEditorProps {
  threadId: string
  activeDraft?: Draft | null
  onGenerate: (instruction?: string) => Promise<void>
  isGenerating: boolean
  channelType?: string
  onDraftUpdate: (draft: Draft) => void
}

export function DraftEditor({
  threadId,
  activeDraft,
  onGenerate,
  isGenerating,
  channelType = "email",
  onDraftUpdate,
}: DraftEditorProps) {
  const [instruction, setInstruction] = useState("")
  const [showInstruction, setShowInstruction] = useState(false)
  const [selectedTone, setSelectedTone] = useState<DraftTone>("balanced")
  const [editMode, setEditMode] = useState(false)
  const [editContent, setEditContent] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [showToneMenu, setShowToneMenu] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editMode) textareaRef.current?.focus()
  }, [editMode])

  function handleStartEdit() {
    setEditContent(activeDraft?.content ?? "")
    setEditMode(true)
  }

  async function handleSaveEdit() {
    if (!activeDraft) return
    const res = await fetch("/api/drafts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draft_id: activeDraft.id,
        edited_content: editContent,
      }),
    })
    if (res.ok) {
      const { draft } = await res.json()
      onDraftUpdate(draft)
    }
    setEditMode(false)
  }

  async function handleDiscard() {
    if (!activeDraft) return
    const res = await fetch("/api/drafts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft_id: activeDraft.id, status: "discarded" }),
    })
    if (res.ok) {
      const { draft } = await res.json()
      onDraftUpdate(draft)
    }
  }

  async function handleApprove() {
    if (!activeDraft) return
    setIsSending(true)
    try {
      const res = await fetch("/api/drafts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_id: activeDraft.id, status: "approved" }),
      })
      if (res.ok) {
        const { draft } = await res.json()
        onDraftUpdate(draft)
      }
    } finally {
      setIsSending(false)
    }
  }

  const displayContent = editMode
    ? editContent
    : activeDraft?.edited_content ?? activeDraft?.content

  return (
    <div className="border-t border-co-border bg-co-surface/50 rounded-b-none">
      {activeDraft ? (
        <div className="p-3 space-y-3">
          {/* Draft label */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-co-blue" />
              <span className="text-xs font-medium text-co-blue">AI Draft</span>
              <span className="text-xs text-muted-foreground">
                · {activeDraft.tone}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {!editMode && (
                <>
                  {/* Tone selector */}
                  <div className="relative">
                    <button
                      onClick={() => setShowToneMenu(!showToneMenu)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-co-panel rounded-lg transition-colors"
                    >
                      Tone
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {showToneMenu && (
                      <div className="absolute right-0 bottom-full mb-1 w-32 bg-co-panel border border-co-border rounded-xl shadow-xl z-10 overflow-hidden">
                        {TONES.map(t => (
                          <button
                            key={t.value}
                            onClick={() => {
                              setSelectedTone(t.value)
                              setShowToneMenu(false)
                              onGenerate()
                            }}
                            className={cn(
                              "w-full text-left px-3 py-1.5 text-xs transition-colors",
                              t.value === activeDraft.tone
                                ? "text-co-blue bg-co-blue/10"
                                : "text-muted-foreground hover:text-foreground hover:bg-co-border"
                            )}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="icon-sm" onClick={handleStartEdit} title="Edit">
                    <Edit3 className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={handleDiscard} title="Discard">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
              {editMode && (
                <>
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditMode(false)}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon-sm" onClick={handleSaveEdit}>
                    <Check className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Draft content */}
          {editMode ? (
            <textarea
              ref={textareaRef}
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              className="w-full bg-co-panel border border-co-blue/30 rounded-xl px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-co-blue min-h-[120px]"
            />
          ) : (
            <div className="bg-co-panel border border-co-border rounded-xl px-3 py-2 text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
              {displayContent}
            </div>
          )}

          {/* Send button */}
          {!editMode && (
            <div className="flex items-center justify-between">
              <button
                onClick={() => onGenerate()}
                className="text-xs text-muted-foreground hover:text-co-blue transition-colors"
                disabled={isGenerating}
              >
                Regenerate
              </button>
              <Button
                size="sm"
                onClick={handleApprove}
                loading={isSending}
              >
                <Send className="w-3.5 h-3.5" />
                {channelType === "slack" ? "Send to Slack" : "Approve & Send"}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="p-3 space-y-2">
          {showInstruction && (
            <input
              type="text"
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              placeholder="e.g. &quot;Keep it brief&quot; or &quot;Sound more formal&quot;"
              className="w-full bg-co-panel border border-co-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-co-blue"
              onKeyDown={e => {
                if (e.key === "Enter") {
                  onGenerate(instruction)
                  setInstruction("")
                  setShowInstruction(false)
                }
              }}
            />
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => onGenerate(instruction || undefined)}
              loading={isGenerating}
              className="flex-1"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Generate Reply
            </Button>
            <button
              onClick={() => setShowInstruction(!showInstruction)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5"
            >
              + Instruction
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
