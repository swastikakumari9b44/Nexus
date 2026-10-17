import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useChat } from "../hooks/useChat";
import { IDLE_BOOKING, type BookingView } from "../lib/types";
import { finalPayload, installFetch, json, sse, streamResponse } from "./mockServer";

const awaitingSlot: BookingView = { ...IDLE_BOOKING, status: "awaiting_slot", name: "Alex Chen", email: "a@x.com",
  offered_slots: [{ id: "2026-10-16T10:30", label: "Tomorrow · 10:30 AM IST" }] };

describe("useChat", () => {
  it("restores the conversation and booking after a refresh", async () => {
    localStorage.setItem("nexus.thread_id", "11111111-1111-4111-8111-111111111111");
    installFetch({ thread: () => ({ exists: true, booking: awaitingSlot, messages: [
      { id: "u1", role: "user", content: "book", citations: [] }, { id: "a1", role: "assistant", content: "Name?", citations: [] }] }) });
    const { result } = renderHook(() => useChat());
    expect(result.current.loadingThread).toBe(true);
    await waitFor(() => expect(result.current.loadingThread).toBe(false));
    expect(result.current.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(result.current.booking.status).toBe("awaiting_slot");
    expect(result.current.threadId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("sends, reports real node progress, and appends the assistant reply with citations", async () => {
    const cite = { source: "employee_handbook.pdf", page: 4, snippet: "s", score: 0.3, chunk_id: "c1" };
    installFetch({ chat: () => streamResponse([
      sse("node", { node: "router", intent: "faq" }), sse("node", { node: "rag", intent: null }),
      sse("final", finalPayload({ reply: "Annual [Source: employee_handbook.pdf, page 4]", citations: [cite] }))]) });
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.loadingThread).toBe(false));
    await act(async () => { result.current.send("How often?"); });
    await waitFor(() => expect(result.current.sending).toBe(false));
    expect(result.current.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(result.current.messages[1].citations[0].page).toBe(4);
    expect(result.current.lastTrace).toEqual(["router", "rag", "finalize"]);
  });

  it("ignores sends while the thread is still being restored (no clobbered optimistic message)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const calls = installFetch({ chat: () => streamResponse([sse("final", finalPayload())]) });
    const orig = globalThis.fetch;
    globalThis.fetch = (async (u: string, i?: RequestInit) => { if (String(u).includes("/api/threads/")) await gate; return (orig as typeof fetch)(u, i); }) as typeof fetch;
    const { result } = renderHook(() => useChat());
    act(() => { result.current.send("too early"); });
    expect(calls.chatBodies).toHaveLength(0);
    expect(result.current.messages).toHaveLength(0);
    release();
    await waitFor(() => expect(result.current.loadingThread).toBe(false));
  });

  it("prevents duplicate submissions while a request is in flight", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((r) => { finish = r; });
    const calls = installFetch({ chat: async () => { await gate; return streamResponse([sse("final", finalPayload())]); } });
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.loadingThread).toBe(false));
    act(() => { result.current.send("one"); });
    act(() => { result.current.send("two"); result.current.send("three"); });
    finish();
    await waitFor(() => expect(result.current.sending).toBe(false));
    expect(calls.chatBodies).toHaveLength(1);
    expect(result.current.messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("recovers a turn that completed server-side but whose stream was cut (no false 'failed')", async () => {
    localStorage.setItem("nexus.thread_id", "22222222-2222-4222-8222-222222222222");
    let sentId = "";
    installFetch({
      chat: (body) => { sentId = String(body.client_message_id); return streamResponse([sse("node", { node: "router", intent: "booking" })], true); },
      thread: () => sentId
        ? { exists: true, booking: { ...IDLE_BOOKING, status: "confirmed", reference: "REV-ABC123" },
            messages: [{ id: sentId, role: "user", content: "yes", citations: [] },
                       { id: "ai1", role: "assistant", content: "Confirmed! #REV-ABC123", citations: [] }] }
        : { exists: false, messages: [], booking: IDLE_BOOKING },
    });
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.loadingThread).toBe(false));
    await act(async () => { result.current.send("yes"); });
    await waitFor(() => expect(result.current.sending).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.messages.map((m) => m.role)).toEqual(["user", "assistant"]);   // no duplicate user message
    expect(result.current.messages.some((m) => m.failed)).toBe(false);
    expect(result.current.booking.reference).toBe("REV-ABC123");
  });

  it("marks failure, then Retry re-sends with the SAME client_message_id (idempotent)", async () => {
    const calls = installFetch({ chat: (_b, n) => n === 0 ? json({ detail: "boom" }, 500) : streamResponse([sse("final", finalPayload({ reply: "ok" }))]) });
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.loadingThread).toBe(false));
    await act(async () => { result.current.send("hello"); });
    await waitFor(() => expect(result.current.sending).toBe(false));
    expect(result.current.messages[0].failed).toBe(true);
    expect(result.current.error).toBeTruthy();
    await act(async () => { result.current.retry(); });
    await waitFor(() => expect(result.current.sending).toBe(false));
    expect(calls.chatBodies).toHaveLength(2);
    expect(calls.chatBodies[1].client_message_id).toBe(calls.chatBodies[0].client_message_id);
    expect(result.current.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(result.current.messages[0].failed).toBe(false);
  });

  it("reports an unreachable backend and offline status", async () => {
    installFetch({ chat: () => { throw new TypeError("Failed to fetch"); } });
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.loadingThread).toBe(false));
    await act(async () => { result.current.send("hi"); });
    await waitFor(() => expect(result.current.sending).toBe(false));
    expect(result.current.error).toMatch(/Can't reach/);
    expect(result.current.online).toBe(false);
  });

  it("New conversation creates a distinct thread with clean state", async () => {
    installFetch({ thread: () => ({ exists: true, booking: awaitingSlot, messages: [{ id: "u", role: "user", content: "x", citations: [] }] }) });
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.loadingThread).toBe(false));
    const old = result.current.threadId;
    installFetch({});                                   // a brand-new thread has no server state
    act(() => { result.current.newConversation(); });
    await waitFor(() => expect(result.current.loadingThread).toBe(false));
    expect(result.current.threadId).not.toBe(old);
    expect(localStorage.getItem("nexus.thread_id")).toBe(result.current.threadId);
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.booking.status).toBe("idle");     // no inherited pending booking
  });

  it("refuses to start a new conversation while a request is in flight", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((r) => { finish = r; });
    installFetch({ chat: async () => { await gate; return streamResponse([sse("final", finalPayload())]); } });
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.loadingThread).toBe(false));
    const id = result.current.threadId;
    act(() => { result.current.send("hi"); });
    act(() => { result.current.newConversation(); });
    expect(result.current.threadId).toBe(id);
    finish();
    await waitFor(() => expect(result.current.sending).toBe(false));
  });
});
