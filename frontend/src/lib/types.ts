export interface SlotView { id: string; label: string; start?: string | null }
export interface Citation { source: string; page: number; snippet: string; score: number; chunk_id: string }
export type BookingStatus = "idle" | "collecting" | "awaiting_slot" | "awaiting_confirmation" | "confirmed" | "cancelled";
export interface BookingView {
  status: BookingStatus; appointment_type: string; name: string | null; email: string | null;
  offered_slots: SlotView[]; selected_slot: SlotView | null; reference: string | null; confirmation_required: boolean;
}
export interface ChatResponse {
  thread_id: string; message_id: string | null; reply: string; citations: Citation[]; booking: BookingView;
  intent: string | null; trace: string[]; error: string | null; llm_mode: string; duplicate: boolean;
}
export interface MessageView { id: string | null; role: "user" | "assistant"; content: string; citations: Citation[] }
export interface ThreadResponse { thread_id: string; exists: boolean; messages: MessageView[]; booking: BookingView; llm_mode: string }
export interface Health { status: string; llm_mode: string; embedding: string; index_ready: boolean; timezone: string; version: string }

export interface UiMessage {
  key: string; role: "user" | "assistant"; content: string; citations: Citation[];
  clientMessageId?: string; failed?: boolean; slotId?: string;
}
export const IDLE_BOOKING: BookingView = {
  status: "idle", appointment_type: "Performance Review", name: null, email: null,
  offered_slots: [], selected_slot: null, reference: null, confirmation_required: true,
};
