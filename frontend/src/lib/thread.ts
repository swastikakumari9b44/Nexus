const KEY = "nexus.thread_id";
export const newThreadId = (): string => crypto.randomUUID();
export function saveThreadId(id: string): void { try { localStorage.setItem(KEY, id); } catch { /* storage unavailable */ } }
export function loadThreadId(): string {
  try { const v = localStorage.getItem(KEY); if (v) return v; } catch { /* storage unavailable */ }
  const id = newThreadId(); saveThreadId(id); return id;
}
