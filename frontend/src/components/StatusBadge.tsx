import { Loader2, Workflow } from "lucide-react";
import type { Progress } from "../hooks/useChat";

const NODE_LABEL: Record<string, string> = { router: "Router", rag: "Knowledge (RAG)", booking: "Booking", clarify: "Clarify", finalize: "Respond" };

/** Human label for what the backend is doing NEXT, derived from the real node-completion
 *  events and the graph topology (router -> rag|booking|clarify -> booking? -> finalize). */
function stage(p: Progress[]): string {
  if (p.length === 0) return "Routing request";
  const last = p[p.length - 1];
  const intent = p.find((x) => x.node === "router")?.intent;
  switch (last.node) {
    case "router":
      return intent === "faq" || intent === "faq_during_booking" ? "Retrieving handbook knowledge"
        : intent === "blocked" ? "Applying safety policy" : intent === "booking" ? "Preparing booking" : "Composing reply";
    case "rag": return intent === "faq_during_booking" ? "Resuming pending booking" : "Composing answer";
    case "booking": return "Finalizing booking step";
    default: return "Composing reply";
  }
}

export function StatusBadge({ sending, progress, lastTrace }: { sending: boolean; progress: Progress[]; lastTrace: string[] }) {
  if (sending) {
    return (
      <div className="flex items-center gap-2" role="status" aria-live="polite">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-500/40 bg-brand-500/10 px-2.5 py-1 text-xs font-medium text-brand-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {stage(progress)}
        </span>
        <span className="hidden gap-1 font-mono text-[11px] text-slate-400 sm:flex">
          {progress.map((p, i) => <span key={i} className="rounded bg-ink-700 px-1.5 py-0.5 text-slate-300">{p.node} ✓</span>)}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400" title="Graph nodes executed for the last turn (reported by the backend)">
      <Workflow className="h-3.5 w-3.5" aria-hidden />
      {lastTrace.length ? <span className="font-mono">{lastTrace.map((n) => NODE_LABEL[n] ?? n).join(" → ")}</span> : <span>Idle</span>}
    </div>
  );
}
