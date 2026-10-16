import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

export function Drawer({ open, title, onClose, children, side = "right" }:
  { open: boolean; title: string; onClose: () => void; children: ReactNode; side?: "right" | "left" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className={`absolute top-0 flex h-full w-full max-w-md flex-col border-ink-700 bg-ink-850 shadow-card outline-none ${side === "right" ? "right-0 border-l" : "left-0 border-r"}`}>
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <button onClick={onClose} aria-label="Close panel" className="rounded-md p-1.5 text-slate-400 hover:bg-ink-700 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
