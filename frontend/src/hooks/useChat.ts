import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getHealth, getThread, sendMessage } from "../lib/api";
import { loadThreadId, newThreadId, saveThreadId } from "../lib/thread";
import { IDLE_BOOKING, type BookingView, type Health, type UiMessage } from "../lib/types";

export interface Progress { node: string; intent: string | null }
const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);

export function useChat() {
  const [threadId, setThreadId] = useState<string>(loadThreadId);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [booking, setBooking] = useState<BookingView>(IDLE_BOOKING);
  const [sending, setSending] = useState(false);
  const [loadingThread, setLoadingThread] = useState(true);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [lastTrace, setLastTrace] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [online, setOnline] = useState(true);
  const inFlight = useRef(false);
  const tid = useRef(threadId);
  tid.current = threadId;

  // Restore the conversation after refresh / thread switch.
  useEffect(() => {
    let cancelled = false;
    setLoadingThread(true); setError(null);
    getThread(threadId).then((t) => {
      if (cancelled) return;
      setMessages(t.messages.map((m, i) => ({ key: m.id ?? `h${i}`, role: m.role, content: m.content, citations: m.citations })));
      setBooking(t.booking); setLastTrace([]);
    }).catch((e: ApiError) => { if (!cancelled) { setError(e.message); setMessages([]); setBooking(IDLE_BOOKING); } })
      .finally(() => { if (!cancelled) setLoadingThread(false); });
    return () => { cancelled = true; };
  }, [threadId]);

  // Connection / system status.
  useEffect(() => {
    const poll = () => getHealth().then((h) => { setHealth(h); setOnline(true); }).catch(() => setOnline(false));
    poll(); const t = setInterval(poll, 15000); return () => clearInterval(t);
  }, []);

  const run = useCallback(async (text: string, clientMessageId: string, slotId?: string) => {
    if (inFlight.current) return;                      // no duplicate submissions
    inFlight.current = true; setSending(true); setError(null); setProgress([]);
    const thread = tid.current;
    try {
      const r = await sendMessage({ threadId: thread, message: text, clientMessageId, slotId },
        (node, intent) => setProgress((p) => [...p, { node, intent }]));
      if (tid.current !== thread) return;              // user switched threads mid-flight
      setMessages((m) => [
        ...m.map((x) => (x.clientMessageId === clientMessageId ? { ...x, failed: false } : x)),
        { key: r.message_id ? `a-${r.message_id}` : uid(), role: "assistant", content: r.reply, citations: r.citations },
      ]);
      setBooking(r.booking); setLastTrace(r.trace); setOnline(true);
      if (r.error === "llm_unavailable") setError("The language model was unreachable; handbook answers are temporarily unavailable.");
    } catch (e) {
      if (tid.current !== thread) return;
      const err = e as ApiError;
      setMessages((m) => m.map((x) => (x.clientMessageId === clientMessageId ? { ...x, failed: true } : x)));
      setError(err.message ?? "Something went wrong."); if (err.status === 0) setOnline(false);
    } finally { inFlight.current = false; setSending(false); setProgress([]); }
  }, []);

  const send = useCallback((text: string, slotId?: string) => {
    const t = text.trim(); if (!t || inFlight.current) return;
    const id = uid();
    setMessages((m) => [...m, { key: `u-${id}`, role: "user", content: t, citations: [], clientMessageId: id, slotId }]);
    void run(t, id, slotId);
  }, [run]);

  /** Retry re-uses the SAME client_message_id, so the backend processes it at most once. */
  const retry = useCallback(() => {
    const failed = [...messages].reverse().find((m) => m.failed && m.clientMessageId);
    if (failed?.clientMessageId) void run(failed.content, failed.clientMessageId, failed.slotId);
  }, [messages, run]);

  const newConversation = useCallback(() => {
    if (inFlight.current) return;
    const id = newThreadId(); saveThreadId(id); setMessages([]); setBooking(IDLE_BOOKING);
    setLastTrace([]); setError(null); setThreadId(id);
  }, []);

  return { threadId, messages, booking, sending, loadingThread, progress, lastTrace, error, health, online,
    send, retry, newConversation, dismissError: () => setError(null) };
}
