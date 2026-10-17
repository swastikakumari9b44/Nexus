import { CalendarCheck, Check, CheckCircle2, Clock, Copy, Loader2, Mail, User, XCircle } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { EMAIL_RE, NAME_RE } from "../lib/format";
import type { BookingView } from "../lib/types";

const STEPS = ["Details", "Slot", "Confirm", "Done"] as const;
const stepIndex = (s: BookingView["status"]) =>
  ({ idle: -1, cancelled: -1, collecting: 0, awaiting_slot: 1, awaiting_confirmation: 2, confirmed: 3 })[s];

interface Props { booking: BookingView; busy: boolean; onSend: (text: string, slotId?: string) => void }

export function BookingPanel({ booking, busy, onSend }: Props) {
  const idx = stepIndex(booking.status);
  const uid = useId();           // two panels can be mounted at once (desktop aside + mobile drawer)
  const [name, setName] = useState(booking.name ?? "");
  const [email, setEmail] = useState(booking.email ?? "");
  const [touched, setTouched] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setName(booking.name ?? ""); setEmail(booking.email ?? ""); setTouched(false); }, [booking.name, booking.email, booking.status]);

  const nameOk = NAME_RE.test(name.trim()); const emailOk = EMAIL_RE.test(email.trim());
  const submitDetails = (e: React.FormEvent) => {
    e.preventDefault(); setTouched(true);
    if (nameOk && emailOk && !busy) onSend(`My name is ${name.trim()} and my email is ${email.trim()}`);
  };
  const copyRef = async () => {
    if (!booking.reference) return;
    try { await navigator.clipboard.writeText(booking.reference); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ }
  };
  const input = "w-full rounded-lg border bg-ink-900 py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-brand-500";

  return (
    <section aria-label="Booking" className="rounded-2xl border border-ink-700 bg-ink-800 p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><CalendarCheck className="h-4 w-4 text-brand-400" aria-hidden /> {booking.appointment_type}</h2>
        {idx >= 0 && idx < 3 && <span className="whitespace-nowrap rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">In progress</span>}
        {idx === 3 && <span className="whitespace-nowrap rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">Booked</span>}
      </div>

      {idx >= 0 && (
        <ol className="mb-4 flex items-center gap-1" aria-label="Booking progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-1" aria-current={i === idx ? "step" : undefined}>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${i < idx || idx === 3 ? "bg-emerald-500 text-ink-950" : i === idx ? "bg-brand-500 text-white" : "bg-ink-700 text-slate-400"}`}>
                {i < idx || idx === 3 ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
              </span>
              <span className={`hidden text-[11px] sm:inline ${i === idx ? "text-white" : "text-slate-400"}`}>{s}</span>
              {i < STEPS.length - 1 && <span className={`h-px flex-1 ${i < idx ? "bg-emerald-500/60" : "bg-ink-700"}`} />}
            </li>
          ))}
        </ol>
      )}

      {(booking.status === "idle" || booking.status === "cancelled") && (
        <div>
          <p className="mb-3 text-sm text-slate-400">{booking.status === "cancelled" ? "Your last request was cancelled. Nothing was booked." : "Schedule a 1-on-1 review. You can ask handbook questions at any point and your progress is kept."}</p>
          <button disabled={busy} onClick={() => onSend("Hi, I need to book a 1-on-1 Performance Review session.")}
            className="w-full rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">Start booking</button>
        </div>
      )}

      {booking.status === "collecting" && (
        <form onSubmit={submitDetails} noValidate className="space-y-3">
          <div>
            <label htmlFor={`${uid}-name`} className="mb-1 block text-xs font-medium text-slate-400">Full name</label>
            <div className="relative"><User className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
              <input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Alex Chen" maxLength={80}
                aria-invalid={touched && !nameOk} className={`${input} ${touched && !nameOk ? "border-red-500/70" : "border-ink-600"}`} /></div>
            {touched && !nameOk && <p className="mt-1 text-xs text-red-400">Enter your first and last name.</p>}
          </div>
          <div>
            <label htmlFor={`${uid}-email`} className="mb-1 block text-xs font-medium text-slate-400">Work email</label>
            <div className="relative"><Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
              <input id={`${uid}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="alex.chen@company.com" maxLength={254}
                aria-invalid={touched && !emailOk} className={`${input} ${touched && !emailOk ? "border-red-500/70" : "border-ink-600"}`} /></div>
            {touched && !emailOk && <p className="mt-1 text-xs text-red-400">Enter a valid email address.</p>}
          </div>
          <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Continue
          </button>
        </form>
      )}

      {booking.status === "awaiting_slot" && (
        <div>
          <p className="mb-2 text-xs text-slate-400">{booking.name} · {booking.email}</p>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Available slots (IST)</p>
          <div className="grid gap-2">
            {booking.offered_slots.map((s) => (
              <button key={s.id} disabled={busy} onClick={() => onSend(s.label, s.id)}
                className="flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-left text-sm text-slate-200 transition hover:border-brand-500 hover:text-white disabled:opacity-50">
                <Clock className="h-4 w-4 text-brand-400" aria-hidden /> {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {booking.status === "awaiting_confirmation" && booking.selected_slot && (
        <div>
          <dl className="mb-3 space-y-1.5 rounded-lg border border-ink-600 bg-ink-900 p-3 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-slate-400">When</dt><dd className="text-right text-white">{booking.selected_slot.label}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Name</dt><dd className="text-white">{booking.name}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Email</dt><dd className="truncate text-white">{booking.email}</dd></div>
          </dl>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => onSend("yes")} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-ink-950 hover:bg-emerald-400 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />} Confirm
            </button>
            <button disabled={busy} onClick={() => onSend("no")} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-slate-300 hover:text-white disabled:opacity-50">Change slot</button>
          </div>
        </div>
      )}

      {booking.status === "confirmed" && booking.reference && (
        <div>
          <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
            <p className="text-xs text-emerald-300">Reference ID</p>
            <div className="mt-1 flex items-center justify-between">
              <span className="font-mono text-lg font-semibold tracking-wide text-white">#{booking.reference}</span>
              <button onClick={copyRef} aria-label="Copy reference ID" className="rounded-md p-1.5 text-emerald-300 hover:bg-emerald-500/10">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button>
            </div>
            <p className="mt-2 text-sm text-slate-200">{booking.selected_slot?.label}</p>
            <p className="text-xs text-slate-400">{booking.name} · {booking.email}</p>
          </div>
          <button disabled={busy} onClick={() => onSend("I'd like to book another Performance Review session.")} className="w-full rounded-lg border border-ink-600 px-3 py-2 text-sm text-slate-300 hover:text-white disabled:opacity-50">Book another</button>
        </div>
      )}

      {idx >= 0 && idx < 3 && (
        <button disabled={busy} onClick={() => onSend("cancel")} className="mt-3 flex items-center gap-1 text-xs text-slate-400 hover:text-red-400 disabled:opacity-50">
          <XCircle className="h-3.5 w-3.5" aria-hidden /> Cancel booking
        </button>
      )}
    </section>
  );
}
