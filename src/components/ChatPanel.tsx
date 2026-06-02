// components/ChatPanel.tsx
// A simple side panel that slides in from the right. Receives the chat
// list and a `send` callback. The parent (App) decides whether it's open
// via a tab button on the right edge.

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';

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
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`fixed right-0 top-0 z-40 flex h-full w-80 max-w-[90vw] flex-col border-l border-slate-800 bg-slate-900 shadow-2xl transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold">Chat</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Close chat"
          >
            ✕
          </button>
        </header>

        <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {loading && (
            <p className="text-center text-[10px] uppercase tracking-wider text-slate-500">
              Loading history…
            </p>
          )}
          {!loading && messages.length === 0 && (
            <p className="mt-8 text-center text-xs text-slate-500">
              No messages yet. Say hi 👋
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${isMe(m) ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  isMe(m)
                    ? 'rounded-br-sm bg-brand-500 text-white'
                    : 'rounded-bl-sm bg-slate-800 text-slate-100'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                <p
                  className={`mt-1 text-[10px] ${
                    isMe(m) ? 'text-blue-100/80' : 'text-slate-400'
                  }`}
                >
                  {formatTime(m.at)}
                </p>
              </div>
            </div>
          ))}
        </div>

        <form
          onSubmit={submit}
          className="flex gap-2 border-t border-slate-800 p-3"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a message…"
            className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </aside>
    </>
  );
}
