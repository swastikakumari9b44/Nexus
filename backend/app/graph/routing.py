"""Conditional-edge functions. The graph is acyclic within a turn, so routing cannot loop."""
from .state import AgentState, booking_active


def after_router(state: AgentState) -> str:
    t = state.get("turn") or {}
    if t.get("blocked"):
        return "booking" if booking_active(state) else "finalize"
    if t.get("question"):
        return "rag"
    if booking_active(state) or t.get("start_booking"):
        return "booking"
    return "clarify"


def after_rag(state: AgentState) -> str:
    t = state.get("turn") or {}
    return "booking" if (booking_active(state) or t.get("start_booking")) else "finalize"
