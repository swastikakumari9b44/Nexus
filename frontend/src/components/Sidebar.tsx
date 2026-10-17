import { Check, Copy, Hexagon, Plus } from "lucide-react";
import { useState } from "react";
import type { Health } from "../lib/types";

function Dot({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="flex items-start justify-between gap-2 text-xs">
      <span className="flex items-center gap-2 text-slate-400"><span className={`mt-1 h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} aria-hidden />{label}</span>
      <span className="text-right text-slate-300">{detail ?? (ok ? "OK" : "Down")}</span>
    </li>
  );
}

export function Sidebar({ threadId, health, online, disabled, onNew }:
  { threadId: string; health: Health | null; online: boolean; disabled: boolean; onNew: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(threadId); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ } };
  const dev = health?.llm_mode === "dev";
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-blue-500"><Hexagon className="h-5 w-5 text-white" aria-hidden /></div>
        <div><p className="text-sm font-bold tracking-wider text-white">NEXUS</p><p className="text-[11px] text-slate-400">Stateful AI Service Assistant</p></div>
      </div>
      <button onClick={onNew} disabled={disabled} className="flex items-center justify-center gap-2 rounded-xl border border-ink-600 bg-ink-800 px-3 py-2 text-sm font-medium text-white transition hover:border-brand-500/60 disabled:opacity-50">
        <Plus className="h-4 w-4" aria-hidden /> New conversation
      </button>
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">Thread</p>
        <button onClick={copy} title="Copy thread ID" className="flex w-full items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-left font-mono text-[11px] text-slate-300 hover:border-ink-600">
          <span className="truncate">{threadId}</span>{copied ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-label="Copied" /> : <Copy className="h-3.5 w-3.5 shrink-0" aria-label="Copy thread ID" />}
        </button>
        <p className="mt-1.5 text-[11px] text-slate-400">Persisted by the LangGraph SQLite checkpointer; survives refresh and restarts.</p>
      </div>
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">System status</p>
        <ul className="space-y-2 rounded-xl border border-ink-700 bg-ink-900 p-3" aria-label="System status">
          <Dot ok={online} label="API" detail={online ? "Connected" : "Unreachable"} />
          {health && <>
            <Dot ok={health.index_ready} label="Knowledge index" detail={health.index_ready ? "Ready" : "Not ingested"} />
            <Dot ok={!dev} label="LLM" detail={dev ? "Dev mode (no LLM)" : health.llm_mode} />
            <Dot ok label="Timezone" detail={health.timezone} />
          </>}
        </ul>
        {dev && <p className="mt-2 text-[11px] leading-snug text-amber-300/80">Dev mode returns extractive answers from the handbook. Set LLM_PROVIDER in .env for real LLM answers.</p>}
      </div>
    </div>
  );
}
