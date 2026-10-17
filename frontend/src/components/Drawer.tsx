import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Drawer({ open, title, onClose, children, side = "right" }:
  { open: boolean; title: string; onClose: () => void; children: ReactNode; side?: "right" | "left" }) {
  const ref = useRef<HTMLDivElement>(null);
  // Parents pass inline lambdas; keep the latest in a ref so the effect below runs only on open/close.
  // (Depending on `onClose` re-ran the effect on every parent render and stole focus from inputs.)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCloseRef.current(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const els = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (els.length === 0) { e.preventDefault(); return; }
      const first = els[0], last = els[els.length - 1], cur = document.activeElement;
      if (e.shiftKey && (cur === first || cur === ref.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/60" onClick={() => onCloseRef.current()} aria-hidden />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className={`absolute top-0 flex h-full w-full max-w-md flex-col border-ink-700 bg-ink-850 shadow-card outline-none ${side === "right" ? "right-0 border-l" : "left-0 border-r"}`}>
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <button onClick={() => onCloseRef.current()} aria-label="Close panel" className="rounded-md p-1.5 text-slate-400 hover:bg-ink-700 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
