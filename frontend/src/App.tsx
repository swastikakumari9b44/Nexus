import { AlertTriangle, CalendarCheck, Menu, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { BookingPanel } from "./components/BookingPanel";
import { ChatWindow } from "./components/ChatWindow";
import { Composer } from "./components/Composer";
import { Drawer } from "./components/Drawer";
import { Sidebar } from "./components/Sidebar";
import { SourcePanel } from "./components/SourcePanel";
import { StatusBadge } from "./components/StatusBadge";
import { useChat } from "./hooks/useChat";
import type { Citation } from "./lib/types";

export default function App() {
  const c = useChat();
  const [source, setSource] = useState<Citation | null>(null);
  const [nav, setNav] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const canRetry = c.messages.some((m) => m.failed);
  const active = ["collecting", "awaiting_slot", "awaiting_confirmation"].includes(c.booking.status);
  const sidebar = <Sidebar threadId={c.threadId} health={c.health} online={c.online} disabled={c.sending} onNew={() => { c.newConversation(); setNav(false); }} />;

  return (
    <div className="flex h-full bg-ink-900">
      <aside className="hidden w-72 shrink-0 border-r border-ink-700 bg-ink-850 lg:block">{sidebar}</aside>
      <Drawer open={nav} side="left" title="Menu" onClose={() => setNav(false)}>{sidebar}</Drawer>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-ink-700 bg-ink-850/80 px-3 py-2.5 backdrop-blur sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <button className="rounded-md p-1.5 text-slate-400 hover:bg-ink-700 hover:text-white lg:hidden" onClick={() => setNav(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
            <StatusBadge sending={c.sending} progress={c.progress} lastTrace={c.lastTrace} />
          </div>
          <button onClick={() => setBookingOpen(true)} className="relative flex items-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white xl:hidden">
            <CalendarCheck className="h-4 w-4" aria-hidden /> Booking
            {active && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-400" aria-label="Booking in progress" />}
          </button>
        </header>

        {c.error && (
          <div role="alert" className="flex items-center gap-3 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> <span className="flex-1">{c.error}</span>
            {canRetry && <button onClick={c.retry} disabled={c.sending} className="flex items-center gap-1 rounded-md bg-red-500/20 px-2 py-1 text-xs font-medium hover:bg-red-500/30 disabled:opacity-50"><RefreshCw className="h-3 w-3" aria-hidden /> Retry</button>}
            <button onClick={c.dismissError} aria-label="Dismiss error" className="rounded p-1 hover:bg-red-500/20"><X className="h-4 w-4" /></button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <ChatWindow messages={c.messages} sending={c.sending} loading={c.loadingThread} onSend={(t) => c.send(t)} onCite={setSource} />
            <Composer onSend={(t) => c.send(t)} disabled={c.sending || c.loadingThread} offline={!c.online} />
          </div>
          <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-ink-700 bg-ink-850 p-4 xl:block">
            <BookingPanel booking={c.booking} busy={c.sending || c.loadingThread} onSend={c.send} />
          </aside>
        </div>
      </main>

      <Drawer open={bookingOpen} title="Booking" onClose={() => setBookingOpen(false)}>
        <BookingPanel booking={c.booking} busy={c.sending || c.loadingThread} onSend={c.send} />
      </Drawer>
      <Drawer open={!!source} title="Source details" onClose={() => setSource(null)}>{source && <SourcePanel citation={source} />}</Drawer>
    </div>
  );
}
