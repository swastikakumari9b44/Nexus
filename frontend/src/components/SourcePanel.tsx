import { FileText } from "lucide-react";
import type { Citation } from "../lib/types";

export function SourcePanel({ citation }: { citation: Citation }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-800 p-3">
        <div className="rounded-lg bg-brand-500/15 p-2 text-brand-400"><FileText className="h-5 w-5" aria-hidden /></div>
        <div>
          <p className="text-sm font-medium text-white">{citation.source}</p>
          <p className="text-xs text-slate-400">Page {citation.page} · similarity {citation.score.toFixed(2)}</p>
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Retrieved passage</p>
        {/* Plain text node: untrusted document text is never interpreted as HTML or Markdown. */}
        <p className="whitespace-pre-wrap rounded-xl border border-ink-700 bg-ink-900 p-3 text-sm leading-relaxed text-slate-300">{citation.snippet}</p>
      </div>
      <p className="text-xs text-slate-400">This is the exact text the answer was grounded in, with its page number from the indexed PDF.</p>
    </div>
  );
}
