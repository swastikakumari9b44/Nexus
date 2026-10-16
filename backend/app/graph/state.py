"""Typed LangGraph state.

Only `messages` uses a reducer (add_messages, which de-duplicates by message id).
Everything else is last-write-wins and is rewritten by exactly one node per turn,
so there are no concurrent writers to the same key.
"""
from __future__ import annotations

from typing import Annotated, Any, Optional, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages

ACTIVE_STATUSES = ("collecting", "awaiting_slot", "awaiting_confirmation")


class TurnInfo(TypedDict, total=False):
    question: Optional[str]      # FAQ text found in this message
    start_booking: bool
    cancel: bool
    name: Optional[str]
    email_raw: Optional[str]     # unvalidated; validated deterministically by the booking node
    slot_ids: list[str]          # slots the user's wording matched
    slot_attempt: bool           # user tried to pick a slot (even if nothing matched)
    confirm: Optional[bool]      # yes / no to the confirmation prompt
    blocked: bool                # prompt-injection / secret-exfiltration attempt


class BookingDraft(TypedDict, total=False):
    status: str                  # idle|collecting|awaiting_slot|awaiting_confirmation|confirmed|cancelled
    appointment_type: str
    name: Optional[str]
    email: Optional[str]
    offered_slot_ids: list[str]
    slot_id: Optional[str]
    reference: Optional[str]
    booking: Optional[dict[str, Any]]   # persisted booking, set ONLY after the DB transaction succeeds
    last_error: Optional[str]


class AgentState(TypedDict, total=False):
    messages: Annotated[list[AnyMessage], add_messages]
    thread_id: str
    request_slot_id: Optional[str]
    intent: str
    turn: TurnInfo
    booking: BookingDraft
    citations: list[dict[str, Any]]
    reply_parts: list[str]
    trace: list[str]
    active_node: str
    error: Optional[str]
    reply: str


def booking_active(state: AgentState) -> bool:
    return (state.get("booking") or {}).get("status") in ACTIVE_STATUSES
