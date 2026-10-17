import { vi } from "vitest";
import type { BookingView, ChatResponse, MessageView } from "../lib/types";
import { IDLE_BOOKING } from "../lib/types";

const enc = new TextEncoder();
export const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** A Response whose body streams `chunks`, optionally erroring afterwards (a dropped connection). */
export function streamResponse(chunks: string[], failAfter = false): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (i < chunks.length) ctrl.enqueue(enc.encode(chunks[i++]));
      else if (failAfter) ctrl.error(new TypeError("network error"));
      else ctrl.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

export const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

export const finalPayload = (over: Partial<ChatResponse> = {}): ChatResponse => ({
  thread_id: "t", message_id: "m", reply: "Hello", citations: [], booking: IDLE_BOOKING, intent: "faq",
  trace: ["router", "rag", "finalize"], error: null, llm_mode: "dev", duplicate: false, ...over,
});

export interface Calls { urls: string[]; chatBodies: Array<Record<string, unknown>> }

/** Route-based fetch stub. `chat` decides what each POST /api/chat/stream does. */
export function installFetch(opts: {
  thread?: () => { exists: boolean; messages: MessageView[]; booking: BookingView } | Response;
  chat?: (body: Record<string, unknown>, n: number) => Response | Promise<Response>;
}): Calls {
  const calls: Calls = { urls: [], chatBodies: [] };
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.urls.push(url);
    if (url.includes("/api/health")) return json({ status: "ok", llm_mode: "dev", embedding: "hash", index_ready: true, timezone: "Asia/Kolkata", version: "1" });
    if (url.includes("/api/threads/")) {
      const t = opts.thread?.() ?? { exists: false, messages: [], booking: IDLE_BOOKING };
      return t instanceof Response ? t : json({ thread_id: "t", llm_mode: "dev", ...t });
    }
    if (url.includes("/api/chat/stream")) {
      const body = JSON.parse(String(init?.body));
      calls.chatBodies.push(body);
      return opts.chat!(body, n++);
    }
    return json({}, 404);
  }));
  return calls;
}
