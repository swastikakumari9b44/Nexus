import re
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_MSGID = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
_SLOT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")


def validate_thread_id(v: str) -> str:
    if not _UUID.match(v or ""):
        raise ValueError("thread_id must be a UUID")
    return v.lower()


class ChatRequest(BaseModel):
    thread_id: str
    message: str = Field(min_length=1)
    client_message_id: Optional[str] = None  # retry-safe: the same id is processed at most once
    slot_id: Optional[str] = None            # set when the user clicks a slot in the UI

    @field_validator("thread_id")
    @classmethod
    def _t(cls, v):
        return validate_thread_id(v)

    @field_validator("message")
    @classmethod
    def _m(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("message must not be blank")
        return v

    @field_validator("client_message_id")
    @classmethod
    def _c(cls, v):
        if v is not None and not _MSGID.match(v):
            raise ValueError("client_message_id must be 1-64 chars of [A-Za-z0-9_-]")
        return v

    @field_validator("slot_id")
    @classmethod
    def _s(cls, v):
        if v is not None and not _SLOT.match(v):
            raise ValueError("slot_id has an invalid format")
        return v


class SlotView(BaseModel):
    id: str
    label: str
    start: Optional[str] = None


class Citation(BaseModel):
    source: str
    page: int
    snippet: str
    score: float
    chunk_id: str


class BookingView(BaseModel):
    status: str = "idle"
    appointment_type: str = "Performance Review"
    name: Optional[str] = None
    email: Optional[str] = None
    offered_slots: list[SlotView] = []
    selected_slot: Optional[SlotView] = None
    reference: Optional[str] = None
    confirmation_required: bool = True


class ChatResponse(BaseModel):
    thread_id: str
    message_id: Optional[str] = None
    reply: str
    citations: list[Citation] = []
    booking: BookingView
    intent: Optional[str] = None
    trace: list[str] = []
    error: Optional[str] = None
    llm_mode: str
    duplicate: bool = False


class SlotsResponse(BaseModel):
    timezone: str
    slots: list[SlotView]


class MessageView(BaseModel):
    id: Optional[str]
    role: str
    content: str
    citations: list[Citation] = []


class ThreadResponse(BaseModel):
    thread_id: str
    exists: bool
    messages: list[MessageView]
    booking: BookingView
    llm_mode: str


class HealthResponse(BaseModel):
    status: str
    llm_mode: str
    embedding: str
    index_ready: bool
    timezone: str
    version: str = "1.0.0"


class BookingRecord(BaseModel):
    reference: str
    status: str
    appointment_type: str
    slot_label: str
    name: str
    email: str
    created_at: str


class ErrorResponse(BaseModel):
    error: str
    detail: Any = None
