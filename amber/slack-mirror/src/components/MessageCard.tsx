"use client";

import {
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  ImageIcon,
  MessageSquare,
} from "lucide-react";
import type { SlackFile, SlackMessage } from "@/lib/slack";
import { CopyButton } from "@/components/CopyButton";
import {
  avatarColor,
  initials,
  messageToText,
  threadToText,
} from "@/lib/format";

function formatBytes(bytes: number): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function Attachment({ file }: { file: SlackFile }) {
  if (file.isImage) {
    return (
      <div className="group/img relative rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950 max-w-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={file.url}
          alt={file.title || file.name}
          className="w-full h-auto object-cover"
          loading="lazy"
        />
        <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover/img:opacity-100 transition-opacity duration-200">
          <a
            href={file.url}
            download={file.name}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-950/80 backdrop-blur text-zinc-200 hover:text-white hover:bg-zinc-900 transition-all duration-200"
            aria-label="Download image"
          >
            <Download className="w-4 h-4" />
          </a>
        </div>
        <div className="px-3 py-2 text-xs text-zinc-500 truncate flex items-center gap-1.5">
          <ImageIcon className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{file.name}</span>
          {file.size ? (
            <span className="text-zinc-600">· {formatBytes(file.size)}</span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <a
      href={file.url}
      download={file.name}
      className="inline-flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-zinc-700 transition-all duration-200 max-w-sm group/file"
    >
      <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400 shrink-0">
        <FileText className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-sm text-zinc-200 truncate font-medium">
          {file.name}
        </div>
        <div className="text-xs text-zinc-500">
          {file.filetype?.toUpperCase()}{" "}
          {file.size ? `· ${formatBytes(file.size)}` : ""}
        </div>
      </div>
      <Download className="w-4 h-4 text-zinc-600 group-hover/file:text-zinc-300 transition-colors ml-auto shrink-0" />
    </a>
  );
}

function MessageBody({
  msg,
  dimmed = false,
}: {
  msg: SlackMessage;
  dimmed?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div
        className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold ${avatarColor(
          msg.userName,
        )}`}
      >
        {initials(msg.userName)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className={`font-semibold text-sm ${dimmed ? "text-zinc-300" : "text-white"}`}
          >
            {msg.userName}
          </span>
          <span className="text-xs text-zinc-500">{msg.tsLabel}</span>
        </div>
        {msg.text ? (
          <p className="slack-text text-[15px] text-zinc-300 leading-relaxed mt-1">
            {msg.text}
          </p>
        ) : null}
        {msg.files.length > 0 && (
          <div className="flex flex-wrap gap-3 mt-3">
            {msg.files.map((f) => (
              <Attachment key={f.id} file={f} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function MessageCard({
  msg,
  open,
  onToggle,
}: {
  msg: SlackMessage;
  open: boolean;
  onToggle: () => void;
}) {
  const hasThread = msg.replies.length > 0;

  return (
    <div className="group bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 hover:border-zinc-700 transition-all duration-200 relative">
      {/* Per-message copy, top-right, appears on hover. */}
      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <CopyButton
          text={hasThread ? threadToText(msg) : messageToText(msg)}
          compact
        />
      </div>

      <MessageBody msg={msg} />

      {hasThread && (
        <div className="mt-4 pl-12">
          <button
            onClick={onToggle}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 transition-all duration-200 cursor-pointer"
          >
            {open ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <MessageSquare className="w-3.5 h-3.5" />
            {msg.replies.length}{" "}
            {msg.replies.length === 1 ? "reply" : "replies"}
          </button>

          {open && (
            <div className="mt-3 space-y-4 border-l-2 border-zinc-800 pl-4">
              {msg.replies.map((r) => (
                <div key={r.ts} className="group/reply relative">
                  <div className="absolute -top-1 right-0 opacity-0 group-hover/reply:opacity-100 transition-opacity duration-200">
                    <CopyButton text={messageToText(r)} compact />
                  </div>
                  <MessageBody msg={r} dimmed />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
