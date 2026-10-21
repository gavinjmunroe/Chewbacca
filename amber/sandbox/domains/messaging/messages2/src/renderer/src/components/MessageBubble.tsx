import { Check, CheckCheck, AlertCircle, RotateCw, X } from "lucide-react";
import type { MessageDTO } from "@shared/types";
import { AttachmentView } from "./AttachmentView";
import { Avatar } from "./Avatar";
import { cn, prettyHandle, reactionGlyph } from "@/lib/utils";

interface MessageBubbleProps {
  message: MessageDTO;
  showSender: boolean; // First in a group from this sender
  isLast: boolean; // Last in a group from this sender → bubble tail
  isGroupChat: boolean;
  onRetry?: (optimisticId: string) => void;
  onDismiss?: (optimisticId: string) => void;
}

export function MessageBubble({
  message,
  showSender,
  isLast,
  isGroupChat,
  onRetry,
  onDismiss,
}: MessageBubbleProps): JSX.Element {
  const isFromMe = message.isFromMe;
  // SMS shows green; RCS uses blue (Apple matches RCS to iMessage visually).
  const isSMS = message.service === "SMS";
  const hasText = !!message.text && message.text.trim().length > 0;
  const hasAttachments = message.attachments.length > 0;

  // Outgoing color: blue for iMessage, green for SMS — matches Apple convention.
  const outBg = isSMS ? "bg-imessage-green" : "bg-imessage-blue";

  const senderLabel =
    isGroupChat && !isFromMe && showSender
      ? (message.senderDisplayName ?? prettyHandle(message.participant))
      : null;

  // Membership / system events render as centered chrome rather than bubbles.
  if (
    message.kind === "memberAdded" ||
    message.kind === "memberRemoved" ||
    message.kind === "nameChanged" ||
    message.kind === "groupAction"
  ) {
    return <SystemMessage message={message} />;
  }

  if (message.retractedAt) {
    return (
      <div
        className={cn(
          "flex w-full px-3",
          isFromMe ? "justify-end" : "justify-start",
        )}
      >
        <div className="rounded-bubble bg-zinc-800/40 px-3 py-1.5 text-xs italic text-zinc-500">
          Message unsent
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex w-full px-3",
        isFromMe ? "flex-col items-end" : "flex-col items-start",
      )}
    >
      {senderLabel && (
        <div className="mb-0.5 ml-12 text-[11px] font-medium text-zinc-500">
          {senderLabel}
        </div>
      )}
      <div
        className={cn(
          "flex max-w-[68%] gap-2",
          isFromMe ? "flex-row-reverse" : "flex-row",
        )}
      >
        {/* Avatar slot in group chats: render only on the LAST bubble of
            the sender's group so consecutive messages don't repeat the
            same face. Matches Messages.app. */}
        {!isFromMe && isGroupChat && (
          <div className="flex w-7 shrink-0 items-end">
            {isLast && (
              <Avatar
                name={message.senderDisplayName ?? null}
                identifier={message.participant}
                photoUrl={message.senderPhotoUrl}
                size="sm"
                className="!h-7 !w-7 !text-[10px]"
              />
            )}
          </div>
        )}

        <div className="flex flex-col gap-1">
          {/* Attachments first, then text — matches Apple Messages stacking. */}
          {hasAttachments && (
            <div
              className={cn(
                "flex flex-col gap-1.5",
                isFromMe ? "items-end" : "items-start",
              )}
            >
              {message.attachments.map((att) => (
                <AttachmentView
                  key={att.id}
                  attachment={att}
                  isFromMe={isFromMe}
                />
              ))}
            </div>
          )}

          {hasText && (
            <div
              className={cn(
                "relative max-w-full rounded-bubble px-3 py-1.5 text-[15px] leading-snug text-white",
                isFromMe
                  ? cn(outBg, isLast && "bubble-tail-out")
                  : cn(
                      "bg-imessage-bubble-incoming",
                      isLast && "bubble-tail-in",
                    ),
                message.hasError && "opacity-70",
              )}
              style={{ wordBreak: "break-word" }}
            >
              {message.text}
              {message.editedAt && (
                <span className="ml-1.5 text-[10px] text-white/60">Edited</span>
              )}
              {/* Reactions float as a chip overlapping the bubble corner */}
              {message.reactions.length > 0 && (
                <ReactionStack
                  reactions={message.reactions}
                  isFromMe={isFromMe}
                />
              )}
            </div>
          )}

          {/* If only attachments, hang reactions off the last attachment area */}
          {!hasText && hasAttachments && message.reactions.length > 0 && (
            <div
              className={cn("relative h-0 w-full", isFromMe ? "pr-2" : "pl-2")}
            >
              <div
                className={cn(
                  "absolute -top-2",
                  isFromMe ? "right-2" : "left-2",
                )}
              >
                <ReactionStackInline
                  reactions={message.reactions}
                  isFromMe={isFromMe}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status row (only on the last message of an outgoing group) */}
      {isFromMe && isLast && (
        <div className="mt-1 mr-1 flex items-center gap-1 text-[11px] text-zinc-500">
          {message.hasError ? (
            <>
              <span className="flex items-center gap-1 text-red-400">
                <AlertCircle className="h-3 w-3" />
                Not Delivered
              </span>
              {onRetry && (
                <button
                  onClick={() => onRetry(message.id)}
                  className="ml-2 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-red-300 transition-colors hover:bg-red-500/10"
                  title="Retry send"
                >
                  <RotateCw className="h-3 w-3" />
                  Retry
                </button>
              )}
              {onDismiss && (
                <button
                  onClick={() => onDismiss(message.id)}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
                  title="Discard"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </>
          ) : message.readAt ? (
            <span className="flex items-center gap-1">
              <CheckCheck className="h-3 w-3" />
              Read
            </span>
          ) : message.isDelivered ? (
            <span className="flex items-center gap-1">
              <Check className="h-3 w-3" />
              Delivered
            </span>
          ) : message.isSent ? (
            <span>Sent</span>
          ) : (
            <span>Sending…</span>
          )}
        </div>
      )}
    </div>
  );
}

function ReactionStack({
  reactions,
  isFromMe,
}: {
  reactions: MessageDTO["reactions"];
  isFromMe: boolean;
}): JSX.Element {
  return (
    <div
      className={cn(
        "absolute -top-3 flex items-center gap-0.5",
        isFromMe ? "-left-2" : "-right-2",
      )}
    >
      <ReactionStackInline reactions={reactions} isFromMe={isFromMe} />
    </div>
  );
}

function ReactionStackInline({
  reactions,
  isFromMe,
}: {
  reactions: MessageDTO["reactions"];
  isFromMe: boolean;
}): JSX.Element {
  // Group by glyph; show count if multiple participants reacted with same kind.
  const grouped = new Map<
    string,
    { glyph: string; count: number; mine: boolean }
  >();
  for (const r of reactions) {
    const glyph = reactionGlyph(r.kind, r.emoji);
    const ex = grouped.get(glyph);
    if (ex) {
      ex.count++;
      if (r.isFromMe) ex.mine = true;
    } else {
      grouped.set(glyph, { glyph, count: 1, mine: r.isFromMe });
    }
  }
  return (
    <>
      {[...grouped.values()].map((g) => (
        <div
          key={g.glyph}
          className={cn(
            "flex items-center gap-0.5 rounded-full border border-black/30 px-1.5 py-0.5 text-xs shadow-md backdrop-blur-md",
            g.mine
              ? "bg-imessage-blue text-white"
              : "bg-zinc-700/95 text-white",
            isFromMe ? "order-1" : "order-2",
          )}
        >
          <span className="leading-none">{g.glyph}</span>
          {g.count > 1 && (
            <span className="text-[10px] font-semibold">{g.count}</span>
          )}
        </div>
      ))}
    </>
  );
}

function SystemMessage({ message }: { message: MessageDTO }): JSX.Element {
  let label = "System message";
  if (message.kind === "memberAdded" && message.affectedParticipant) {
    label = `${prettyHandle(message.affectedParticipant)} was added to the conversation`;
  } else if (message.kind === "memberRemoved" && message.affectedParticipant) {
    label = `${prettyHandle(message.affectedParticipant)} left the conversation`;
  } else if (message.kind === "nameChanged" && message.newGroupName) {
    label = `Conversation renamed to "${message.newGroupName}"`;
  } else if (message.kind === "groupAction") {
    label = "Group settings changed";
  }
  return (
    <div className="flex w-full justify-center px-3">
      <div className="rounded-full bg-white/[0.04] px-3 py-1 text-[11px] text-zinc-500">
        {label}
      </div>
    </div>
  );
}
