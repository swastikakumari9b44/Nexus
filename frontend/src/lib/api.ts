import type { ChatResponse, Health, ThreadResponse } from "./types";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export class ApiError extends Error {
  constructor(message: string, public status: number, public retryable: boolean) { super(message); }
}

async function parseError(res: Response): Promise<ApiError> {
  let detail = "";
  try { const j = await res.json(); detail = typeof j.detail === "string" ? j.detail : ""; } catch { /* non-JSON body */ }
  const msg = res.status === 413 ? "That message is too long." :
    res.status === 422 ? (detail || "That request wasn't valid.") :
    res.status === 504 ? "The assistant took too long to respond." :
    detail || "The server hit an error.";
  return new ApiError(msg, res.status, res.status >= 500 || res.status === 429);
}

async function request<T>(path: string): Promise<T> {
  let res: Response;
  try { res = await fetch(`${BASE}${path}`); }
  catch { throw new ApiError("Can't reach the NEXUS backend. Check that it is running.", 0, true); }
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<T>;
}

export const getHealth = () => request<Health>("/api/health");
export const getThread = (id: string) => request<ThreadResponse>(`/api/threads/${id}`);

export interface SendArgs { threadId: string; message: string; clientMessageId: string; slotId?: string }

/** POST /api/chat/stream and parse SSE. `onNode` fires for each real graph node completion. */
export async function sendMessage(
  a: SendArgs, onNode: (node: string, intent: string | null) => void, signal?: AbortSignal,
): Promise<ChatResponse> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/chat/stream`, {
      method: "POST", signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: a.threadId, message: a.message, client_message_id: a.clientMessageId, slot_id: a.slotId ?? null }),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Can't reach the NEXUS backend. Check that it is running.", 0, true);
  }
  if (!res.ok || !res.body) throw await parseError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let final: ChatResponse | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const ev = /^event: (.+)$/m.exec(block)?.[1]; const data = /^data: (.+)$/m.exec(block)?.[1];
        if (!ev || !data) continue;
        const payload = JSON.parse(data);
        if (ev === "node") onNode(payload.node, payload.intent ?? null);
        else if (ev === "final") final = payload as ChatResponse;
        else if (ev === "error") throw new ApiError(payload.detail ?? "The request failed.", payload.error === "timeout" ? 504 : 500, true);
      }
    }
  } catch (e) {
    if (e instanceof ApiError || (e as Error).name === "AbortError") throw e;
    // A dropped connection mid-stream: the turn may still have completed on the server.
    throw new ApiError("The connection was interrupted before the reply arrived.", 0, true);
  }
  if (!final) throw new ApiError("The connection closed before a reply arrived.", 0, true);
  return final;
}
