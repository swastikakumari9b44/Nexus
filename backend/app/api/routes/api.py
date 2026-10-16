import asyncio
import json
import logging
import time
import uuid

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage

from app.api.container import Container
from app.api.service import build_response, booking_view, find_processed, message_views
from app.core.logging import short_id
from app.schemas.api import (BookingRecord, ChatRequest, ChatResponse, HealthResponse, SlotsResponse,
                             SlotView, ThreadResponse, validate_thread_id)

log = logging.getLogger("nexus.api")
router = APIRouter(prefix="/api")
TURN_TIMEOUT_S = 90


def _c(request: Request) -> Container:
    return request.app.state.container


def _check(c: Container, req: ChatRequest) -> None:
    if len(req.message) > c.settings.max_message_chars:
        raise HTTPException(413, f"message too long (max {c.settings.max_message_chars} characters)")


def _inputs(req: ChatRequest) -> dict:
    msg = HumanMessage(content=req.message, id=req.client_message_id or str(uuid.uuid4()))
    return {"messages": [msg], "thread_id": req.thread_id, "request_slot_id": req.slot_id}, msg.id


@router.get("/health", response_model=HealthResponse)
async def health(request: Request):
    c = _c(request)
    return HealthResponse(status="ok", llm_mode=c.answerer.mode, embedding=c.embedder_name,
                          index_ready=await asyncio.to_thread(c.retriever.is_ready),
                          timezone=c.settings.timezone)


@router.get("/slots", response_model=SlotsResponse)
async def slots(request: Request):
    c = _c(request)
    available = await asyncio.to_thread(c.booking.list_available_slots)
    return SlotsResponse(timezone=c.settings.timezone,
                         slots=[SlotView(id=s.id, label=s.label, start=s.start.isoformat()) for s in available])


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request):
    c = _c(request)
    _check(c, req)
    cfg = {"configurable": {"thread_id": req.thread_id}}
    async with c.locks.hold(req.thread_id):
        if req.client_message_id:
            snap = await c.graph.aget_state(cfg)
            done = find_processed(snap.values or {}, req.client_message_id)
            if done is not None:
                return build_response(c, req.thread_id, snap.values, message_id=req.client_message_id,
                                      duplicate=True, ai=done)
        inputs, mid = _inputs(req)
        t0 = time.perf_counter()
        try:
            values = await asyncio.wait_for(c.graph.ainvoke(inputs, cfg), TURN_TIMEOUT_S)
        except asyncio.TimeoutError:
            raise HTTPException(504, "The assistant took too long to respond. Please retry.")
        log.info("turn", extra={"ctx": {"thread": short_id(req.thread_id), "intent": values.get("intent"),
                                        "trace": values.get("trace"), "error": values.get("error"),
                                        "ms": round((time.perf_counter() - t0) * 1000)}})
        return build_response(c, req.thread_id, values, message_id=mid)


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, request: Request):
    """SSE: one `node` event per graph node as it completes (real backend progress),
    then a `final` event carrying the same payload as POST /api/chat.
    Note: node-level progress, not token streaming."""
    c = _c(request)
    _check(c, req)
    cfg = {"configurable": {"thread_id": req.thread_id}}

    async def gen():
        async with c.locks.hold(req.thread_id):
            try:
                if req.client_message_id:
                    snap = await c.graph.aget_state(cfg)
                    done = find_processed(snap.values or {}, req.client_message_id)
                    if done is not None:
                        yield _sse("final", build_response(c, req.thread_id, snap.values,
                                   message_id=req.client_message_id, duplicate=True, ai=done).model_dump())
                        return
                inputs, mid = _inputs(req)
                async for update in c.graph.astream(inputs, cfg, stream_mode="updates"):
                    for node, upd in update.items():
                        yield _sse("node", {"node": node, "intent": (upd or {}).get("intent")})
                snap = await c.graph.aget_state(cfg)
                yield _sse("final", build_response(c, req.thread_id, snap.values, message_id=mid).model_dump())
            except Exception as e:
                log.exception("stream failed", extra={"ctx": {"err": type(e).__name__}})
                yield _sse("error", {"error": "internal_error", "detail": "The request failed. Please retry."})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/threads/{thread_id}", response_model=ThreadResponse)
async def get_thread(thread_id: str, request: Request):
    c = _c(request)
    try:
        tid = validate_thread_id(thread_id)
    except ValueError:
        raise HTTPException(422, "thread_id must be a UUID")
    snap = await c.graph.aget_state({"configurable": {"thread_id": tid}})
    values = snap.values or {}
    return ThreadResponse(thread_id=tid, exists=bool(values), messages=message_views(values),
                          booking=booking_view(c, values), llm_mode=c.answerer.mode)


@router.get("/bookings/{reference}", response_model=BookingRecord)
async def get_booking(reference: str, request: Request):
    c = _c(request)
    if not reference.startswith("REV-") or len(reference) > 16:
        raise HTTPException(404, "booking not found")
    b = await asyncio.to_thread(c.booking.get_booking, reference)
    if not b:
        raise HTTPException(404, "booking not found")
    # NOTE: email is withheld from this unauthenticated lookup (no auth in this demo).
    return BookingRecord(reference=b.reference, status=b.status, appointment_type=b.appointment_type,
                         slot_label=b.slot_label, name=b.name.split()[0] + " " + b.name.split()[-1][:1] + ".",
                         email="***", created_at=b.created_at)
