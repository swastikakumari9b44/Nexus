import { AlertCircle, Bot, Check, Copy, FileText, User } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { stripSourceMarkers } from "../lib/format";
import type { Citation, UiMessage } from "../lib/types";

export function MessageBubble({ m, onCite }: { m: UiMessage; onCite: (c: Citation) => void }) {
  const [copied, setCopied] = useState(false);
  const isUser = m.role === "user";
  const text = isUser ? m.content : stripSourceMarkers(m.content);
  const copy = async () => {
    const pages = m.citations.map((c) => `${c.source} p.${c.page}`).join(", ");
    try { await navigator.clipboard.writeText(pages ? `${text}\n\nSources: ${pages}` : text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isUser ? "bg-ink-700 text-slate-300" : "bg-brand-500/15 text-brand-400"}`}>
        {isUser ? <User className="h-4 w-4" aria-hidden /> : <Bot className="h-4 w-4" aria-hidden />}
      </div>
      <div className={`group min-w-0 max-w-[85%] ${isUser ? "items-end" : ""}`}>
        <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${isUser ? "rounded-tr-sm bg-brand-600 text-white" : "rounded-tl-sm border border-ink-700 bg-ink-800 text-slate-200 shadow-card"} ${m.failed ? "ring-1 ring-red-500/60" : ""}`}>
          {/* react-markdown escapes raw HTML by default (no rehype-raw): untrusted text can't inject markup. */}
          <div className="md break-words [overflow-wrap:anywhere]"><ReactMarkdown>{text}</ReactMarkdown></div>
        </div>
        {m.failed && <p className="mt-1 flex items-center gap-1 text-xs text-red-400"><AlertCircle className="h-3 w-3" aria-hidden /> Delivery unconfirmed</p>}
        {!isUser && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {m.citations.map((c) => (
              <button key={c.chunk_id} onClick={() => onCite(c)}
                className="inline-flex items-center gap-1 rounded-full border border-ink-600 bg-ink-800 px-2.5 py-1 text-xs text-slate-300 transition hover:border-brand-500/60 hover:text-white"
                aria-label={`Open source: ${c.source}, page ${c.page}`}>
                <FileText className="h-3 w-3 text-brand-400" aria-hidden /> {c.source} · p.{c.page}
              </button>
            ))}
            <button onClick={copy} aria-label="Copy response" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-slate-400 opacity-0 transition hover:text-slate-200 focus:opacity-100 group-hover:opacity-100">
              {copied ? <><Check className="h-3 w-3" aria-hidden /> Copied</> : <><Copy className="h-3 w-3" aria-hidden /> Copy</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
