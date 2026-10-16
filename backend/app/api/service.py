"""Turns graph state into API responses (kept out of route handlers)."""
from __future__ import annotations

from typing import Any, Optional

from langchain_core.messages import AIMessage, HumanMessage

from app.schemas.api import BookingView, ChatResponse, Citation, MessageView, SlotView

from .container import Container


def _slot(svc, slot_id: str) -> Optional[SlotView]:
    s = svc.get_slot(slot_id)
    return SlotView(id=s.id, label=s.label, start=s.start.isoformat()) if s else None


def booking_view(c: Container, values: dict[str, Any]) -> BookingView:
    d = values.get("booking") or {}
    status = d.get("status", "idle")
    selected = None
    if status == "confirmed" and d.get("booking"):
        b = d["booking"]
        selected = SlotView(id=b["slot_id"], label=b["slot_label"])
    elif d.get("slot_id"):
        selected = _slot(c.booking, d["slot_id"])
    offered = [v for v in (_slot(c.booking, i) for i in d.get("offered_slot_ids", [])) if v]
    return BookingView(
        status=status, appointment_type=d.get("appointment_type", "Performance Review"),
        name=d.get("name"), email=d.get("email"),
        offered_slots=offered if status in ("awaiting_slot", "awaiting_confirmation") else [],
        selected_slot=selected, reference=d.get("reference") if status == "confirmed" else None,
        confirmation_required=c.settings.booking_require_confirmation,
    )


def build_response(c: Container, thread_id: str, values: dict[str, Any], *,
                   message_id: Optional[str] = None, duplicate: bool = False,
                   ai: Optional[AIMessage] = None) -> ChatResponse:
    kw = (ai.additional_kwargs if ai else {}) or {}
    return ChatResponse(
        thread_id=thread_id, message_id=message_id,
        reply=ai.content if ai else values.get("reply", ""),
        citations=[Citation(**x) for x in (kw.get("citations") if ai else values.get("citations")) or []],
        booking=booking_view(c, values),
        intent=kw.get("intent") if ai else values.get("intent"),
        trace=kw.get("trace", []) if ai else values.get("trace", []),
        error=None if ai else values.get("error"),
        llm_mode=c.answerer.mode, duplicate=duplicate,
    )


def find_processed(values: dict[str, Any], client_message_id: str) -> Optional[AIMessage]:
    """If this client_message_id was already answered, return that answer (retry safety)."""
    msgs = values.get("messages") or []
    for i, m in enumerate(msgs):
        if isinstance(m, HumanMessage) and m.id == client_message_id:
            nxt = msgs[i + 1] if i + 1 < len(msgs) else None
            return nxt if isinstance(nxt, AIMessage) else None
    return None


def message_views(values: dict[str, Any]) -> list[MessageView]:
    out = []
    for m in values.get("messages") or []:
        role = "user" if isinstance(m, HumanMessage) else "assistant"
        cites = [Citation(**x) for x in (m.additional_kwargs or {}).get("citations", [])] if role == "assistant" else []
        out.append(MessageView(id=m.id, role=role, content=str(m.content), citations=cites))
    return out
