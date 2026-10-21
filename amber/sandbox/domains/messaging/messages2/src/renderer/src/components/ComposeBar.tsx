import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Smile,
  ArrowUp,
  X,
  FileText,
  Image as ImageIcon,
  File,
} from "lucide-react";
import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";
import type { ChatDTO } from "@shared/types";
import { basename } from "@/lib/path-shim";
import { cn } from "@/lib/utils";

interface ComposeBarProps {
  chat: ChatDTO;
  onSend: (text: string, attachments?: string[]) => Promise<boolean>;
  onPickAttachments: () => Promise<string[]>;
}

export function ComposeBar({
  chat,
  onSend,
  onPickAttachments,
}: ComposeBarProps): JSX.Element {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composedRef = useRef(false); // IME composition guard
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);

  // Focus when chat changes
  useEffect(() => {
    setText("");
    setAttachments([]);
    setShowEmoji(false);
    setShowPlusMenu(false);
    inputRef.current?.focus();
  }, [chat.chatId]);

  // Outside-click closes the + menu
  useEffect(() => {
    if (!showPlusMenu) return;
    function onClick(e: MouseEvent): void {
      const target = e.target as Node;
      if (plusBtnRef.current?.contains(target)) return;
      const menu = document.querySelector(".plus-menu-popover");
      if (menu?.contains(target)) return;
      setShowPlusMenu(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [showPlusMenu]);

  // Auto-resize the textarea up to a cap. Messages.app shows up to ~6 lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 144) + "px";
  }, [text]);

  // Close emoji picker on outside click
  useEffect(() => {
    if (!showEmoji) return;
    function onClick(e: MouseEvent): void {
      const target = e.target as Node;
      if (emojiBtnRef.current?.contains(target)) return;
      const picker = document.querySelector(".emoji-picker-popover");
      if (picker?.contains(target)) return;
      setShowEmoji(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [showEmoji]);

  // Paste-from-clipboard handler: image → save → attach as file path.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    async function onPaste(e: ClipboardEvent): Promise<void> {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items);
      const imageItem = items.find((i) => i.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      e.preventDefault();
      const arr = await file.arrayBuffer();
      const path = await window.messages.savePastedImage(arr, file.type);
      setAttachments((prev) => [...prev, path]);
    }
    el.addEventListener("paste", onPaste);
    return () => el.removeEventListener("paste", onPaste);
  }, []);

  const trimmed = text.trim();
  const canSend = !sending && (trimmed.length > 0 || attachments.length > 0);

  async function doSend(): Promise<void> {
    if (!canSend) return;
    setSending(true);
    const payload = trimmed;
    const atts = attachments;
    setText("");
    setAttachments([]);
    setShowEmoji(false);
    const ok = await onSend(payload, atts.length ? atts : undefined);
    setSending(false);
    if (!ok) {
      // Restore for retry via the bubble itself; clear local input.
    } else {
      inputRef.current?.focus();
    }
  }

  async function pickAttachments(): Promise<void> {
    const paths = await onPickAttachments();
    if (paths.length) setAttachments((prev) => [...prev, ...paths]);
  }

  async function pickPhotos(): Promise<void> {
    setShowPlusMenu(false);
    const result = await window.messages.pickPhotos();
    if (result.paths.length)
      setAttachments((prev) => [...prev, ...result.paths]);
  }

  async function pickFiles(): Promise<void> {
    setShowPlusMenu(false);
    const result = await window.messages.pickFiles();
    if (result.paths.length)
      setAttachments((prev) => [...prev, ...result.paths]);
  }

  // Drag-and-drop: capture file paths from the OS drop.
  function onDragOver(e: React.DragEvent): void {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setIsDragOver(true);
    }
  }
  function onDragLeave(): void {
    setIsDragOver(false);
  }
  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const paths: string[] = [];
    for (const file of files) {
      // Electron exposes file.path on dropped files (non-standard).
      const path = (file as File & { path?: string }).path;
      if (path) paths.push(path);
    }
    if (paths.length) setAttachments((prev) => [...prev, ...paths]);
  }

  const placeholder =
    chat.service === "SMS" ? "Text Message · SMS" : "iMessage";

  return (
    <div
      className={cn(
        "relative px-4 pb-4 pt-2",
        isDragOver && "bg-imessage-blue/10",
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-imessage-blue/60 bg-imessage-blue/10">
          <div className="text-sm font-medium text-imessage-blue">
            Drop files to attach
          </div>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((path, i) => (
            <AttachmentChip
              key={path + i}
              path={path}
              onRemove={() =>
                setAttachments((prev) => prev.filter((_, idx) => idx !== i))
              }
            />
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="relative">
          <button
            ref={plusBtnRef}
            onClick={() => setShowPlusMenu((v) => !v)}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
              showPlusMenu
                ? "bg-imessage-blue text-white"
                : "bg-white/[0.06] text-zinc-300 hover:bg-white/[0.12] hover:text-white",
            )}
            title="Attach"
          >
            <Plus className="h-5 w-5" />
          </button>
          {showPlusMenu && (
            <div className="plus-menu-popover absolute bottom-12 left-0 z-20 w-44 overflow-hidden rounded-xl border border-white/10 bg-zinc-900/95 py-1 shadow-2xl backdrop-blur-xl">
              <button
                onClick={pickPhotos}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-zinc-100 transition-colors hover:bg-white/[0.08]"
              >
                <ImageIcon className="h-4 w-4 text-zinc-400" />
                Photos
              </button>
              <button
                onClick={pickFiles}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-zinc-100 transition-colors hover:bg-white/[0.08]"
              >
                <File className="h-4 w-4 text-zinc-400" />
                Files
              </button>
              <div className="my-1 border-t border-white/[0.06]" />
              <button
                onClick={() => {
                  setShowPlusMenu(false);
                  void pickAttachments();
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-zinc-400 transition-colors hover:bg-white/[0.08]"
              >
                <Plus className="h-4 w-4" />
                Browse…
              </button>
            </div>
          )}
        </div>
        <div className="relative flex flex-1 items-end rounded-2xl border border-white/[0.08] bg-zinc-900/80 pl-4 pr-12 transition-colors focus-within:border-white/20">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onCompositionStart={() => {
              composedRef.current = true;
            }}
            onCompositionEnd={() => {
              composedRef.current = false;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !composedRef.current) {
                e.preventDefault();
                void doSend();
              }
            }}
            placeholder={placeholder}
            rows={1}
            className="block w-full resize-none bg-transparent py-2 text-[15px] leading-snug text-white placeholder-zinc-500 outline-none"
            style={{ maxHeight: 144 }}
          />
          <button
            onClick={() => void doSend()}
            disabled={!canSend}
            title="Send"
            className={cn(
              "absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full transition-all",
              canSend
                ? "scale-100 bg-imessage-blue text-white shadow-md shadow-blue-500/30 hover:bg-imessage-blue-dark"
                : "scale-90 bg-zinc-700/60 text-zinc-500",
            )}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
        <button
          ref={emojiBtnRef}
          onClick={() => setShowEmoji((v) => !v)}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
            showEmoji
              ? "bg-imessage-blue text-white"
              : "bg-white/[0.06] text-zinc-300 hover:bg-white/[0.12] hover:text-white",
          )}
          title="Emoji"
        >
          <Smile className="h-5 w-5" />
        </button>
      </div>

      {showEmoji && (
        <div className="emoji-picker-popover absolute bottom-20 right-4 z-20 overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
          <EmojiPicker
            theme={Theme.DARK}
            emojiStyle={EmojiStyle.NATIVE}
            width={340}
            height={400}
            previewConfig={{ showPreview: false }}
            onEmojiClick={(data) => {
              setText((t) => t + data.emoji);
              inputRef.current?.focus();
            }}
          />
        </div>
      )}
    </div>
  );
}

function AttachmentChip({
  path,
  onRemove,
}: {
  path: string;
  onRemove: () => void;
}): JSX.Element {
  const name = basename(path);
  const isImage = /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(name);
  return (
    <div className="group relative flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-800/80 py-1.5 pl-2 pr-7 text-xs text-zinc-200">
      {isImage ? (
        <div className="h-8 w-8 overflow-hidden rounded-md bg-zinc-700">
          <img
            src={`file://${path}`}
            alt={name}
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <FileText className="h-3.5 w-3.5 text-zinc-400" />
      )}
      <span className="max-w-[180px] truncate" title={name}>
        {name}
      </span>
      <button
        onClick={onRemove}
        className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-700 text-zinc-200 opacity-0 transition-opacity hover:bg-zinc-600 group-hover:opacity-100"
        title="Remove"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
