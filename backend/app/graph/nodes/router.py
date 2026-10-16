import asyncio

from langchain_core.messages import HumanMessage

from app.graph.deps import GraphDeps
from app.graph.nlu import analyze_turn
from app.graph.state import AgentState, booking_active


def make_router(deps: GraphDeps):
    async def router(state: AgentState) -> dict:
        last = next((m for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), None)
        text = str(last.content) if last else ""
        draft = state.get("booking") or {}
        status = draft.get("status", "idle")
        available = await asyncio.to_thread(deps.booking.list_available_slots)
        turn = analyze_turn(
            text, status, bool(draft.get("name")), draft.get("offered_slot_ids", []),
            [s.id for s in available], deps.booking.get_slot, deps.booking.now().date(),
            state.get("request_slot_id"),
        )
        if turn["blocked"]:
            intent = "blocked"
        elif turn["question"]:
            intent = "faq_during_booking" if (booking_active(state) or turn["start_booking"]) else "faq"
        elif booking_active(state) or turn["start_booking"]:
            intent = "booking"
        else:
            intent = "clarify"
        parts = []
        if turn["blocked"]:
            parts = ["I can't share internal instructions, credentials or configuration. "
                     "I can answer questions about the Employee Handbook or help you book a Performance Review."]
        return {"turn": turn, "intent": intent, "reply_parts": parts, "citations": [],
                "trace": ["router"], "active_node": "router", "error": None}

    return router
