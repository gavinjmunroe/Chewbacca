"use client";

import { useReducer, useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { demoData } from '../shared/demoData';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isError?: boolean;
}

// Compute real avg Conversational Flow from last 5 sessions
const _last5 = demoData.sessions.slice(0, 5);
const _avgFlow = Math.round(_last5.reduce((s, sess) => s + sess.metrics.turnTaking, 0) / _last5.length);

const STABLE_INITIAL_CONTENT = `Hi ${demoData.user.name.split(' ')[0]}. I've been analyzing your captures from the past week. Your Conversational Flow is at ${_avgFlow}%, your main growth lever right now. What would you like to work on?`;

const QUICK_REPLIES = [
  "Improve my flow",
  "Speaking pace tips",
  "Review this week",
  "Vocal range",
];

// ─── Status Bar ───────────────────────────────────────────────────────────────

function StatusBar() {
  const [clockTime, setClockTime] = useState('');

  useEffect(() => {
    function tick() {
      const now = new Date();
      const h = now.getHours() % 12 || 12;
      const m = now.getMinutes().toString().padStart(2, '0');
      setClockTime(`${h}:${m}`);
    }
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      height: 56,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: 20,
      paddingRight: 20,
      flexShrink: 0,
      // ISSUE 9: outer bg now matches StatusBar bg (#F8F9FB)
      background: '#F8F9FB',
    }}>
      <span style={{ fontSize: 15, fontWeight: 600, color: '#0F1117', letterSpacing: '-0.2px' }}>
        {clockTime}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
          <rect x="0"    y="8" width="3" height="4"  rx="1" fill="#0F1117" />
          <rect x="4.5"  y="5" width="3" height="7"  rx="1" fill="#0F1117" />
          <rect x="9"    y="2" width="3" height="10" rx="1" fill="#0F1117" />
          <rect x="13.5" y="0" width="3" height="12" rx="1" fill="#0F1117" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
          <path d="M8 9.5 L8 9.5" stroke="#0F1117" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M5.5 7.2 Q8 5.2 10.5 7.2" stroke="#0F1117" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          <path d="M3 4.8 Q8 1 13 4.8" stroke="#0F1117" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="#0F1117" strokeWidth="1" />
          <rect x="2"   y="2"   width="16" height="8"  rx="2"   fill="#0F1117" />
          <path d="M22.5 4 L22.5 8" stroke="#0F1117" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

// ─── Header Bar ───────────────────────────────────────────────────────────────

// ISSUE 12: Added isError optional prop for AI Offline indicator
function HeaderBar({ onClearChat, isError }: { onClearChat: () => void; isError?: boolean }) {
  return (
    <div style={{
      height: 52,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      paddingLeft: 20,
      paddingRight: 20,
      flexShrink: 0,
      background: '#FFFFFF',
      borderBottom: '1px solid #E9EAEC',
      position: 'relative',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        paddingLeft: 44,
        paddingRight: 44,
      }}>
        <TizzyAvatar size={32} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0F1117', lineHeight: 1.2 }}>
            Tizzy Coach
          </div>
          {/* ISSUE 12: show connection issue status when isError is true */}
          {isError ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#DC2626', flexShrink: 0 }} />
              <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 500 }}>
                Connection issue
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 500 }}>
              Powered by your pendant data
            </div>
          )}
        </div>
      </div>

      {/* ISSUE 7: trash button hit area increased to 44x44, padding removed */}
      <button
        onClick={onClearChat}
        title="Clear chat"
        style={{
          position: 'absolute',
          right: 16,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 16,
          color: 'rgba(0,0,0,0.25)',
          width: 44,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <path d="M19 6L18 20H6L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M8 6V4H16V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

// ─── Tizzy Avatar ─────────────────────────────────────────────────────────────

function TizzyAvatar({ size = 32 }: { size?: number }) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '50%',
      overflow: 'hidden',
      flexShrink: 0,
      background: '#0E1929',
      boxShadow: '0 2px 8px rgba(37,99,235,0.4)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <Image src="/tizzycropped.png" alt="Tizzy" width={size} height={size} style={{ width: '85%', height: '85%', objectFit: 'contain', filter: "brightness(0) saturate(100%) invert(65%) sepia(100%) saturate(324%) hue-rotate(182deg) brightness(102%)" }} />
    </div>
  );
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 12, paddingLeft: 18, paddingRight: 18 }}>
      <TizzyAvatar size={28} />
      <div style={{
        background: '#FFFFFF',
        border: '1px solid #E9EAEC',
        borderRadius: '18px 18px 18px 4px',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 5,
      }}>
        <style>{`
          @keyframes dotPulse {
            0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
            40%            { opacity: 1;    transform: scale(1); }
          }
        `}</style>
        {(['dot-a', 'dot-b', 'dot-c'] as const).map((dotId, dotIdx) => (
          <div
            key={dotId}
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#9CA3AF',
              animation: `dotPulse 1.4s ease-in-out ${dotIdx * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

// ISSUE 10: onRetry changed from (text: string) => void to () => void
function MessageBubble({ message, onRetry }: { message: Message; onRetry: () => void }) {
  const isUser = message.role === 'user';

  const timeStr = new Date(message.timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8, paddingLeft: 18, paddingRight: 18 }}>
        <div style={{
          maxWidth: '75%',
          background: '#2563EB',
          borderRadius: '18px 18px 4px 18px',
          padding: '10px 14px',
        }}>
          <p style={{ fontSize: 14, color: '#FFFFFF', margin: 0, lineHeight: 1.5 }}>
            {message.content}
          </p>
          <div style={{
            fontSize: 10,
            color: 'rgba(255,255,255,0.55)',
            marginTop: 4,
            textAlign: 'right',
          }}>
            {timeStr}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 8, paddingLeft: 18, paddingRight: 18 }}>
      <TizzyAvatar size={28} />
      <div style={{
        maxWidth: '75%',
        background: message.isError ? '#FEF2F2' : '#FFFFFF',
        border: `1px solid ${message.isError ? '#FECACA' : '#E9EAEC'}`,
        borderRadius: '18px 18px 18px 4px',
        padding: '10px 14px',
      }}>
        <p style={{ fontSize: 14, color: message.isError ? '#DC2626' : '#0F1117', margin: 0, lineHeight: 1.5 }}>
          {message.content}
        </p>
        <div style={{
          fontSize: 10,
          color: '#9CA3AF',
          marginTop: 4,
          textAlign: 'left',
        }}>
          {timeStr}
        </div>
        {/* ISSUE 10: onClick calls onRetry directly (no string arg) */}
        {message.isError && (
          <button
            onClick={onRetry}
            style={{
              marginTop: 8,
              height: 28,
              paddingLeft: 12,
              paddingRight: 12,
              background: '#DC2626',
              border: 'none',
              borderRadius: 14,
              color: '#FFFFFF',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Quick Reply Chip ─────────────────────────────────────────────────────────

function QuickReplyChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0,
        height: 34,
        paddingLeft: 14,
        paddingRight: 14,
        background: '#FFFFFF',
        border: '1.5px solid #2563EB',
        borderRadius: 20,
        color: '#2563EB',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

// ─── Clear Confirm Modal ──────────────────────────────────────────────────────

function ClearConfirmOverlay({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(15,17,23,0.35)',
    }}>
      <div style={{
        background: '#FFFFFF',
        borderRadius: 16,
        padding: '24px 24px 20px',
        width: 280,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0F1117', marginBottom: 6 }}>
          Clear chat history?
        </div>
        <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 20, lineHeight: 1.5 }}>
          This will remove all messages and cannot be undone.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              height: 40,
              background: '#F3F4F6',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              color: '#374151',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1,
              height: 40,
              background: '#DC2626',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              color: '#FFFFFF',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Date Separator (ISSUE 5) ─────────────────────────────────────────────────

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function DateSeparator({ date }: { date: Date }) {
  const label = (() => {
    const today = new Date();
    const diff = Math.floor((today.getTime() - date.getTime()) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  })();
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '8px 18px', gap: 10 }}>
      <div style={{ flex: 1, height: 1, background: '#E9EAEC' }} />
      <span style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 500 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: '#E9EAEC' }} />
    </div>
  );
}

// ─── Chat Screen reducer ───────────────────────────────────────────────────────

interface ChatState {
  messages: Message[];
  input: string;
  typing: boolean;
  isLoading: boolean;
  showScrollBtn: boolean;
  showClearConfirm: boolean;
  sendPressed: boolean;
}

type ChatAction =
  | { type: 'SET_MESSAGES'; messages: Message[] }
  | { type: 'APPEND_MESSAGE'; message: Message }
  | { type: 'SET_INPUT'; value: string }
  | { type: 'SET_TYPING'; value: boolean }
  | { type: 'SET_LOADING'; value: boolean }
  | { type: 'SET_SHOW_SCROLL_BTN'; value: boolean }
  | { type: 'SET_SHOW_CLEAR_CONFIRM'; value: boolean }
  | { type: 'SET_SEND_PRESSED'; value: boolean }
  | { type: 'SEND_START'; userMessage: Message }
  | { type: 'SEND_SUCCESS'; assistantMessage: Message }
  | { type: 'SEND_ERROR'; errorMessage: Message }
  | { type: 'CLEAR_CHAT'; initialMessages: Message[] };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_MESSAGES':         return { ...state, messages: action.messages };
    case 'APPEND_MESSAGE':       return { ...state, messages: [...state.messages, action.message] };
    case 'SET_INPUT':            return { ...state, input: action.value };
    case 'SET_TYPING':           return { ...state, typing: action.value };
    case 'SET_LOADING':          return { ...state, isLoading: action.value };
    case 'SET_SHOW_SCROLL_BTN':  return { ...state, showScrollBtn: action.value };
    case 'SET_SHOW_CLEAR_CONFIRM': return { ...state, showClearConfirm: action.value };
    case 'SET_SEND_PRESSED':     return { ...state, sendPressed: action.value };
    case 'SEND_START':
      return { ...state, messages: [...state.messages, action.userMessage], input: '', isLoading: true, typing: true };
    case 'SEND_SUCCESS':
      return { ...state, messages: [...state.messages, action.assistantMessage], typing: false, isLoading: false };
    case 'SEND_ERROR':
      return { ...state, messages: [...state.messages, action.errorMessage], typing: false, isLoading: false };
    case 'CLEAR_CHAT':
      return { ...state, messages: action.initialMessages, showClearConfirm: false };
    default:
      return state;
  }
}

// ─── Message List ─────────────────────────────────────────────────────────────

interface MessageListProps {
  messages: Message[];
  typing: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onRetry: () => void;
}

function MessageList({ messages, typing, scrollContainerRef, bottomRef, onScroll, onRetry }: MessageListProps) {
  return (
    <div
      ref={scrollContainerRef}
      onScroll={onScroll}
      style={{
        flex: 1,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        paddingTop: 16,
        paddingBottom: 8,
        scrollbarWidth: 'none',
        position: 'relative',
      }}
    >
      {/* ISSUE 6: empty state when messages is empty */}
      {messages.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 40 }}>
          <p style={{ fontSize: 14, color: '#9CA3AF', textAlign: 'center' }}>Start a conversation with your AI coach</p>
        </div>
      )}

      {/* ISSUE 5: render DateSeparator between messages from different days */}
      {messages.map((msg, index) => {
        const prevMsg = messages[index - 1];
        const showSeparator = index === 0 || (prevMsg && !isSameDay(new Date(prevMsg.timestamp), new Date(msg.timestamp)));
        return (
          <div key={msg.id}>
            {showSeparator && <DateSeparator date={new Date(msg.timestamp)} />}
            <MessageBubble
              message={msg}
              // ISSUE 10: onRetry is () => void, calls sendMessage with last user text
              onRetry={onRetry}
            />
          </div>
        );
      })}

      {typing && <TypingIndicator />}

      <div ref={bottomRef} />
    </div>
  );
}

// ─── Chat Input Area ──────────────────────────────────────────────────────────

interface ChatInputAreaProps {
  input: string;
  isLoading: boolean;
  sendPressed: boolean;
  showQuickReplies: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSend: () => void;
  onQuickReply: (text: string) => void;
  onSendPressStart: () => void;
  onSendPressEnd: () => void;
}

function ChatInputArea({
  input,
  isLoading,
  sendPressed,
  showQuickReplies,
  inputRef,
  onInputChange,
  onKeyDown,
  onSend,
  onQuickReply,
  onSendPressStart,
  onSendPressEnd,
}: ChatInputAreaProps) {
  return (
    <div style={{
      background: '#FFFFFF',
      borderTop: '1px solid #E9EAEC',
      flexShrink: 0,
      paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 74px)',
    }}>
      {/* ISSUE 3: added WebkitOverflowScrolling: 'touch' to quick replies scroll row */}
      {showQuickReplies && (
        <div style={{
          display: 'flex',
          gap: 8,
          overflowX: 'scroll',
          padding: '10px 18px 0',
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
        }}>
          {QUICK_REPLIES.map(qr => (
            <QuickReplyChip key={qr} label={qr} onClick={() => onQuickReply(qr)} />
          ))}
        </div>
      )}

      {/* Text input row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 16px 12px',
      }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{
            background: '#F3F4F6',
            borderRadius: 24,
            border: '1px solid #E9EAEC',
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 16,
            paddingRight: 8,
            height: 44,
          }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message Tizzy Coach..."
              maxLength={280}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: 14,
                color: '#0F1117',
                fontFamily: 'inherit',
              }}
            />
          </div>
          {/* Character counter — only visible above 200 chars */}
          {input.length > 200 && (
            <div style={{
              fontSize: 10,
              color: input.length > 260 ? '#EF4444' : 'rgba(0,0,0,0.3)',
              textAlign: 'right',
              paddingRight: 4,
            }}>
              {input.length}/280
            </div>
          )}
        </div>

        {/* ISSUE 4: send button with press state and active scale transform */}
        <button
          onClick={onSend}
          disabled={!input.trim() || isLoading}
          onMouseDown={onSendPressStart}
          onMouseUp={onSendPressEnd}
          onMouseLeave={onSendPressEnd}
          onTouchStart={onSendPressStart}
          onTouchEnd={onSendPressEnd}
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: input.trim() && !isLoading ? '#2563EB' : '#E9EAEC',
            border: 'none',
            cursor: input.trim() && !isLoading ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            alignSelf: 'flex-start',
            transition: 'transform 0.1s ease, background 0.1s ease',
            transform: sendPressed && input.trim() && !isLoading ? 'scale(0.92)' : 'scale(1)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M2 9H16M16 9L10 3M16 9L10 15"
              stroke={input.trim() && !isLoading ? '#FFFFFF' : '#9CA3AF'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {/* ISSUE 8: removed separate <div style={{ height: 8 }} /> — paddingBottom on parent handles safe area */}
    </div>
  );
}

// ─── Chat Screen ──────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const initialMessages = useRef<Message[]>([{
    id: '1',
    role: 'assistant' as const,
    content: STABLE_INITIAL_CONTENT,
    timestamp: new Date(Date.now() - 300000),
  }]);

  const [state, dispatch] = useReducer(chatReducer, {
    messages: initialMessages.current,
    input: '',
    typing: false,
    isLoading: false,
    showScrollBtn: false,
    showClearConfirm: false,
    sendPressed: false,
  });
  const { messages, input, typing, isLoading, showScrollBtn, showClearConfirm, sendPressed } = state;

  const lastUserText = useRef('');

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const lastMessage = messages[messages.length - 1];
  const showQuickReplies = !isLoading && !typing && lastMessage?.role === 'assistant';

  // ISSUE 2: auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fix #57: load persisted chat from sessionStorage on mount
  useEffect(() => {
    const saved = sessionStorage.getItem('tz_chat_messages');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Message[];
        const rehydrated = parsed.map(m => ({ ...m, timestamp: new Date(m.timestamp) }));
        dispatch({ type: 'SET_MESSAGES', messages: rehydrated });
      } catch {
        // corrupt storage — ignore and keep initial messages
      }
    }
  }, []);

  // Fix #57: persist messages to sessionStorage whenever they change
  useEffect(() => {
    sessionStorage.setItem('tz_chat_messages', JSON.stringify(messages));
  }, [messages]);

  // Fix #64: scroll to bottom whenever messages or typing indicator changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  // Fix #4: scroll handler to detect when user has scrolled up
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    dispatch({ type: 'SET_SHOW_SCROLL_BTN', value: distanceFromBottom > 80 });
  };

  // Fix #4: scroll to bottom and hide button
  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    dispatch({ type: 'SET_SHOW_SCROLL_BTN', value: false });
  };

  const handleClearChatRequest = () => {
    dispatch({ type: 'SET_SHOW_CLEAR_CONFIRM', value: true });
  };

  const handleClearConfirmed = () => {
    sessionStorage.removeItem('tz_chat_messages');
    dispatch({ type: 'CLEAR_CHAT', initialMessages: initialMessages.current });
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    lastUserText.current = trimmed;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };
    const nextMessages = [...messages, userMsg];

    dispatch({ type: 'SEND_START', userMessage: userMsg });
    const start = Date.now();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const data = await res.json();
      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.content,
        timestamp: new Date(),
      };
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 800 - elapsed);
      setTimeout(() => {
        dispatch({ type: 'SEND_SUCCESS', assistantMessage: assistantMsg });
      }, remaining);
    } catch {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 800 - elapsed);
      setTimeout(() => {
        dispatch({
          type: 'SEND_ERROR',
          errorMessage: {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: "Connection issue. Tap to retry.",
            timestamp: new Date(),
            isError: true,
          },
        });
      }, remaining);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // ISSUE 12: derive isError for header
  const headerIsError = !isLoading && messages.length > 0 && messages[messages.length - 1]?.isError === true;

  return (
    // ISSUE 9: outer bg changed from #F5F6FA to #F8F9FB to match StatusBar
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#F8F9FB',
      fontFamily: 'var(--font-dm-sans), var(--font-inter), system-ui, sans-serif',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <StatusBar />
      {/* ISSUE 12: pass isError to HeaderBar */}
      <HeaderBar onClearChat={handleClearChatRequest} isError={headerIsError} />

      <MessageList
        messages={messages}
        typing={typing}
        scrollContainerRef={scrollContainerRef}
        bottomRef={bottomRef}
        onScroll={handleScroll}
        onRetry={() => sendMessage(lastUserText.current)}
      />

      {/* Fix #4: floating scroll-to-bottom button */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          style={{
            position: 'absolute',
            bottom: 130,
            right: 18,
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: '#2563EB',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 12px rgba(37,99,235,0.4)',
            zIndex: 10,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2L7 12M7 12L3 8M7 12L11 8" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      <ChatInputArea
        input={input}
        isLoading={isLoading}
        sendPressed={sendPressed}
        showQuickReplies={showQuickReplies}
        inputRef={inputRef}
        onInputChange={(value) => dispatch({ type: 'SET_INPUT', value })}
        onKeyDown={handleKeyDown}
        onSend={() => sendMessage(input)}
        onQuickReply={sendMessage}
        onSendPressStart={() => dispatch({ type: 'SET_SEND_PRESSED', value: true })}
        onSendPressEnd={() => dispatch({ type: 'SET_SEND_PRESSED', value: false })}
      />

      {/* Fix #5: clear confirmation overlay */}
      {showClearConfirm && (
        <ClearConfirmOverlay
          onCancel={() => dispatch({ type: 'SET_SHOW_CLEAR_CONFIRM', value: false })}
          onConfirm={handleClearConfirmed}
        />
      )}
    </div>
  );
}
