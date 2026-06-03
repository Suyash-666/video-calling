// components/ChatPanel.tsx
//
// A side panel that slides in from the right. Re-styled to match
// the new design system: no shadow, hairline border, the "you"
// message is rendered with a hairline border and white text
// (no blue background), and the input is borderless with the
// amber-underline focus treatment.

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';
import { CloseIcon } from './Icons';

interface Props {
  open: boolean;
  messages: ChatMessage[];
  loading: boolean;
  onSend: (text: string) => void;
  onClose: () => void;
}

function formatTime(at: number) {
  const d = new Date(at);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatPanel({ open, messages, loading, onSend, onClose }: Props) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the newest message whenever the list grows.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    onSend(draft);
    setDraft('');
  };

  const isMe = (m: ChatMessage) => m.from === 'me';

  return (
    <>
      {/* Backdrop on small screens so taps outside close the panel. */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`fixed right-0 top-0 z-40 flex h-full w-96 max-w-[90vw]
                    flex-col border-l border-white/[0.06] bg-field
                    transition-transform duration-240 ease-out
                    ${open ? 'translate-x-0' : 'translate-x-full'}`}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between
                          border-b border-white/[0.06] px-6 py-4">
          <p className="micro-label">CHAT</p>
          <button
            onClick={onClose}
            className="text-ink-500 outline-none
                       transition-colors duration-180 ease-out
                       hover:text-ink-200"
            aria-label="Close chat"
          >
            <CloseIcon size={16} />
          </button>
        </header>

        <div
          ref={listRef}
          className="flex-1 space-y-3 overflow-y-auto px-6 py-4"
        >
          {loading && (
            <p className="text-center text-micro uppercase
                        tracking-[0.12em] text-ink-500">
              Loading history…
            </p>
          )}
          {!loading && messages.length === 0 && (
            <p className="mt-8 text-center text-small text-ink-500">
              No messages yet. Say hi.
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${isMe(m) ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-md px-3 py-2
                            ${isMe(m)
                              ? 'border border-accent/30 bg-accent/5 text-ink-50'
                              : 'border border-white/[0.06] bg-surface text-ink-200'}`}
              >
                <p className="whitespace-pre-wrap break-words text-small">
                  {m.text}
                </p>
                <p
                  className={`mt-1 font-mono text-[10px]
                              ${isMe(m) ? 'text-accent/70' : 'text-ink-500'}`}
                >
                  {formatTime(m.at)}
                </p>
              </div>
            </div>
          ))}
        </div>

        <form
          onSubmit={submit}
          className="flex items-center gap-4 border-t
                     border-white/[0.06] px-6 py-4"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a message…"
            className="input-bare-sm flex-1"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-disabled={!draft.trim()}
            className="action-primary"
          >
            Send
          </button>
        </form>
      </aside>
    </>
  );
}
