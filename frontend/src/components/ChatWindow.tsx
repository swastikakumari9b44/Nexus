import { ArrowDown, BookOpen, CalendarCheck, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { UiMessage, Citation } from "../lib/types";
import { MessageBubble } from "./MessageBubble";

export const SUGGESTIONS = [
  "How often are performance reviews conducted?",
  "What does the workplace safety program include?",
  "Can I report a violation anonymously?",
  "How often is data security training required?",
];

interface Props {
  messages: UiMessage[]; sending: boolean; loading: boolean;
  onSend: (t: string) => void; onCite: (c: Citation) => void;
}

export function ChatWindow({ messages, sending, loading, onSend, onCite }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const stick = useRef(true);

  const onScroll = () => {
    const el = scroller.current; if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = near; setAtBottom(near);
  };
  // Auto-scroll only if the user is already at the bottom (never yank them away from history).
  useEffect(() => { if (stick.current) end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, sending]);
  useEffect(() => { stick.current = true; }, [loading]);

  if (loading) {
    return <div className="flex flex-1 items-center justify-center text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Restoring conversation…</div>;
  }
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
        <div className="w-full max-w-xl text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/15 text-brand-400"><ShieldCheck className="h-6 w-6" aria-hidden /></div>
          <h1 className="text-xl font-semibold text-white">How can NEXUS help?</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">Ask about the Employee Handbook with page citations, or schedule a Performance Review. You can switch between the two at any time without losing your booking.</p>
          <div className="mt-6 grid gap-2 text-left sm:grid-cols-2">
            <button onClick={() => onSend("Hi, I need to book a 1-on-1 Performance Review session.")}
              className="flex items-start gap-3 rounded-xl border border-brand-500/40 bg-brand-500/10 p-3 text-sm text-white transition hover:bg-brand-500/20 sm:col-span-2">
              <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" aria-hidden /> Book a Performance Review
            </button>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => onSend(s)} className="flex items-start gap-3 rounded-xl border border-ink-700 bg-ink-800 p-3 text-sm text-slate-300 transition hover:border-ink-600 hover:text-white">
                <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden /> {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto px-3 py-5 sm:px-6" role="log" aria-live="polite" aria-label="Conversation">
        <div className="mx-auto max-w-3xl space-y-5">
          {messages.map((m) => <MessageBubble key={m.key} m={m} onCite={onCite} />)}
          {sending && (
            <div className="flex items-center gap-2 pl-11 text-xs text-slate-500" aria-hidden>
              <span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-500" style={{ animationDelay: `${i * 120}ms` }} />)}</span> NEXUS is working…
            </div>
          )}
          <div ref={end} />
        </div>
      </div>
      {!atBottom && (
        <button onClick={() => end.current?.scrollIntoView({ behavior: "smooth" })} aria-label="Jump to latest message"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-ink-600 bg-ink-800 p-2 text-slate-300 shadow-card hover:text-white">
          <ArrowDown className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
