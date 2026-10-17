import { SendHorizonal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const MAX = 2000;
export function Composer({ onSend, disabled, offline }: { onSend: (t: string) => void; disabled: boolean; offline: boolean }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);
  const submit = () => { if (!text.trim() || disabled) return; onSend(text); setText(""); };
  return (
    <div className="border-t border-ink-700 bg-ink-900/80 p-3 backdrop-blur sm:p-4">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-end gap-2 rounded-2xl border border-ink-600 bg-ink-800 p-2 focus-within:border-brand-500/70">
          <label htmlFor="composer" className="sr-only">Message NEXUS</label>
          <textarea id="composer" ref={ref} rows={1} value={text} maxLength={MAX} disabled={offline}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            placeholder={offline ? "Backend unreachable…" : "Ask about the handbook or book a Performance Review"}
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-white placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed" />
          <button onClick={submit} disabled={disabled || offline || !text.trim()} aria-label="Send message"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40">
            <SendHorizonal className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="mt-1.5 flex justify-between px-1 text-[11px] text-slate-400">
          <span>Enter to send · Shift+Enter for a new line</span>
          {text.length > MAX * 0.8 && <span className={text.length >= MAX ? "text-red-400" : ""}>{text.length}/{MAX}</span>}
        </div>
      </div>
    </div>
  );
}
