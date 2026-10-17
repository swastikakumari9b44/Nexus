import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BookingPanel } from "../components/BookingPanel";
import { Drawer } from "../components/Drawer";
import { MessageBubble } from "../components/MessageBubble";
import { stripSourceMarkers } from "../lib/format";
import { IDLE_BOOKING, type BookingView } from "../lib/types";

const slots = [{ id: "2026-10-16T10:30", label: "Tomorrow · 10:30 AM IST" }, { id: "2026-10-16T11:00", label: "Tomorrow · 11:00 AM IST" }];
const b = (over: Partial<BookingView>): BookingView => ({ ...IDLE_BOOKING, ...over });

describe("BookingPanel", () => {
  it("validates name/email client-side and does not send invalid details", async () => {
    const onSend = vi.fn();
    render(<BookingPanel booking={b({ status: "collecting" })} busy={false} onSend={onSend} />);
    await userEvent.type(screen.getByLabelText(/full name/i), "Alex");
    await userEvent.type(screen.getByLabelText(/work email/i), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByText(/first and last name/i)).toBeTruthy();
    expect(screen.getByText(/valid email/i)).toBeTruthy();
  });

  it("sends valid details as a chat message", async () => {
    const onSend = vi.fn();
    render(<BookingPanel booking={b({ status: "collecting" })} busy={false} onSend={onSend} />);
    await userEvent.type(screen.getByLabelText(/full name/i), "Alex Chen");
    await userEvent.type(screen.getByLabelText(/work email/i), "alex.chen@example.com");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(onSend).toHaveBeenCalledWith("My name is Alex Chen and my email is alex.chen@example.com");
  });

  it("slot buttons send the real slot id; confirm sends 'yes'", async () => {
    const onSend = vi.fn();
    const { rerender } = render(<BookingPanel booking={b({ status: "awaiting_slot", name: "A B", email: "a@b.co", offered_slots: slots })} busy={false} onSend={onSend} />);
    await userEvent.click(screen.getByRole("button", { name: /11:00 AM/ }));
    expect(onSend).toHaveBeenCalledWith("Tomorrow · 11:00 AM IST", "2026-10-16T11:00");
    rerender(<BookingPanel booking={b({ status: "awaiting_confirmation", name: "A B", email: "a@b.co", selected_slot: slots[1] })} busy={false} onSend={onSend} />);
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onSend).toHaveBeenLastCalledWith("yes");
  });

  it("shows a reference ONLY when the backend reports confirmed", () => {
    const { rerender } = render(<BookingPanel booking={b({ status: "awaiting_confirmation", selected_slot: slots[0], reference: "REV-FAKE00" })} busy={false} onSend={vi.fn()} />);
    expect(screen.queryByText(/REV-FAKE00/)).toBeNull();
    rerender(<BookingPanel booking={b({ status: "confirmed", selected_slot: slots[0], reference: "REV-ABC123", name: "A B", email: "a@b.co" })} busy={false} onSend={vi.fn()} />);
    expect(screen.getByText("#REV-ABC123")).toBeTruthy();
  });

  it("disables actions while busy", () => {
    render(<BookingPanel booking={b({ status: "awaiting_slot", offered_slots: slots })} busy onSend={vi.fn()} />);
    screen.getAllByRole("button", { name: /AM IST/ }).forEach((x) => expect((x as HTMLButtonElement).disabled).toBe(true));
  });

  it("two mounted panels have unique form control ids (desktop aside + mobile drawer)", () => {
    render(<><BookingPanel booking={b({ status: "collecting" })} busy={false} onSend={vi.fn()} /><BookingPanel booking={b({ status: "collecting" })} busy={false} onSend={vi.fn()} /></>);
    const ids = Array.from(document.querySelectorAll("input")).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Drawer", () => {
  // Inline onClose => a NEW function identity on every parent render, exactly like App.tsx.
  const Host = () => <Drawer open title="Booking" onClose={() => undefined}><input aria-label="field" /></Drawer>;

  it("does not steal focus from an input when the parent re-renders", async () => {
    const { rerender } = render(<Host />);
    const input = screen.getByLabelText("field");
    await userEvent.click(input);
    expect(document.activeElement).toBe(input);
    for (let i = 0; i < 3; i++) rerender(<Host />);          // e.g. SSE progress updates re-rendering App
    expect(document.activeElement).toBe(input);               // no re-click: focus must have survived
  });

  it("closes on Escape and traps Tab inside the dialog", async () => {
    const onClose = vi.fn();
    render(<><button>outside</button><Drawer open title="D" onClose={onClose}><button>a</button><button>b</button></Drawer></>);
    const dialog = screen.getByRole("dialog");
    await userEvent.tab(); await userEvent.tab(); await userEvent.tab(); await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("MessageBubble", () => {
  it("renders untrusted HTML/markdown as inert text (no injected elements)", () => {
    const evil = '<img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> [click](javascript:alert(1))';
    const { container } = render(<MessageBubble m={{ key: "k", role: "assistant", content: evil, citations: [] }} onCite={vi.fn()} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
    const a = container.querySelector("a");
    expect(a === null || !a.getAttribute("href")?.toLowerCase().startsWith("javascript:")).toBe(true);
  });

  it("strips inline source markers and renders structured citation chips that open details", async () => {
    const onCite = vi.fn();
    const c = { source: "employee_handbook.pdf", page: 4, snippet: "s", score: 0.3, chunk_id: "c1" };
    render(<MessageBubble m={{ key: "k", role: "assistant", content: "Annual. [Source: employee_handbook.pdf, page 4]", citations: [c] }} onCite={onCite} />);
    expect(screen.queryByText(/\[Source:/)).toBeNull();
    await userEvent.click(within(document.body).getByRole("button", { name: /open source: employee_handbook.pdf, page 4/i }));
    expect(onCite).toHaveBeenCalledWith(c);
  });

  it("stripSourceMarkers only removes markers", () => {
    expect(stripSourceMarkers("A [Source: x.pdf, page 2] B")).toBe("A B");
  });
});
