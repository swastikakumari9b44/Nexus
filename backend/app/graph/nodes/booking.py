"""Booking node: collects/validates fields and executes the booking via the transactional service.

The node never claims success itself: 'confirmed' is set only after BookingService.book()
returns. Any unexpected exception leaves the draft intact and tells the user nothing was booked.
"""
import asyncio
import logging
from dataclasses import asdict

from app.graph.deps import GraphDeps
from app.graph.state import AgentState
from app.services.booking_service import (APPOINTMENT_TYPE, InvalidSlot, SlotUnavailable,
                                          ValidationFailure, validate_email_address, validate_name)

log = logging.getLogger(__name__)
MAX_OFFERED = 5


def _first(d: dict) -> str:
    return (d.get("name") or "").split(" ")[0]


def make_booking(deps: GraphDeps):
    svc = deps.booking

    def slot_list(ids: list[str]) -> str:
        slots = [svc.get_slot(i) for i in ids]
        return "\n".join(f"{n}) {s.label}" for n, s in enumerate(slots, 1) if s)

    async def booking(state: AgentState) -> dict:
        t = state.get("turn") or {}
        d: dict = dict(state.get("booking") or {})
        parts = list(state.get("reply_parts") or [])
        trace = list(state.get("trace") or []) + ["booking"]
        thread_id = state.get("thread_id", "")
        interleaved = bool(parts)          # an FAQ answer / refusal was already given this turn
        status = d.get("status", "idle")
        active = status in ("collecting", "awaiting_slot", "awaiting_confirmation")
        notes: list[str] = []
        error = state.get("error")  # keep an error set earlier this turn (e.g. by the RAG node)

        def out(extra_error=None):
            return {"booking": d, "reply_parts": parts, "trace": trace, "active_node": "booking",
                    "error": extra_error or error}

        started = False
        if not active:
            if not t.get("start_booking"):
                return out()
            keep = {k: d[k] for k in ("name", "email") if d.get(k)}
            d = {"status": "collecting", "appointment_type": APPOINTMENT_TYPE, "offered_slot_ids": [],
                 "slot_id": None, "reference": None, "booking": None, "last_error": None, **keep}
            status, started = "collecting", True

        if t.get("cancel") and not started:
            d.update(status="cancelled", slot_id=None, offered_slot_ids=[])
            parts.append("No problem - I've cancelled that booking request. Nothing was booked. "
                         "Just say the word if you'd like to schedule a session later.")
            return out()

        if t.get("name"):
            try:
                d["name"] = validate_name(t["name"])
            except ValidationFailure as e:
                notes.append(str(e))
        if t.get("email_raw"):
            try:
                d["email"] = validate_email_address(t["email_raw"])
            except ValidationFailure as e:
                notes.append(str(e))
        d["last_error"] = None

        def say(body: str):
            parts.append((" ".join(notes) + "\n\n" if notes else "") + body)

        # ---- stage 1: collect name + email ----
        missing = [k for k in ("name", "email") if not d.get(k)]
        if missing:
            d["status"] = "collecting"
            ask = {"name": "your full name", "email": "your email address"}
            need = " and ".join(ask[k] for k in missing)
            if started:
                say(f"I'd be happy to help schedule a {APPOINTMENT_TYPE} session. May I have {need}?")
            elif interleaved:
                say(f"Returning to your booking - I still need {need}.")
            else:
                say(f"Thanks! I still need {need} to continue.")
            return out()

        # ---- stage 2: slots ----
        available = await asyncio.to_thread(svc.list_available_slots)
        avail_ids = [s.id for s in available]
        offered = [i for i in d.get("offered_slot_ids", []) if i in avail_ids]
        just_collected = status == "collecting"
        if just_collected or not offered:
            offered = avail_ids[:MAX_OFFERED]
        d["offered_slot_ids"] = offered
        if not offered:
            d["status"] = "awaiting_slot"
            say("There are no open review slots right now. Please check back soon.")
            return out()

        cands = t.get("slot_ids") or []
        chosen = None
        if len(cands) == 1:
            if cands[0] in avail_ids:
                chosen = cands[0]
            elif svc.get_slot(cands[0]) is None:
                notes.append("That isn't one of the bookable slots.")
            else:
                notes.append("Sorry, that slot is no longer available.")
        elif len(cands) > 1:
            notes.append("That matches more than one slot - please pick by number.")
        elif t.get("slot_attempt"):
            notes.append(f"I couldn't match that to an offered slot. Please reply with a number from 1 to {len(offered)}.")

        who = _first(d)

        def ask_slots():
            d["status"], d["slot_id"] = "awaiting_slot", None
            if interleaved:
                lead = f"Returning to your booking, {who} - available slots:"
            elif just_collected:
                lead = f"Thanks, {who}! Here are the available slots:"
            else:
                lead = "Available slots:"
            say(f"{lead}\n\n{slot_list(d['offered_slot_ids'])}\n\nWhich slot works best? (reply with a number or a time)")

        def ask_confirm():
            d["status"] = "awaiting_confirmation"
            slot = svc.get_slot(d["slot_id"])
            lead = f"Returning to your booking, {who} - " if interleaved else ""
            say(f"{lead}Please confirm: **{APPOINTMENT_TYPE}** on **{slot.label}** for **{d['name']}** "
                f"({d['email']}). Reply **yes** to confirm, or **no** to choose a different slot.")

        async def do_book():
            nonlocal error
            try:
                res = await asyncio.to_thread(svc.book, d["name"], d["email"], d["slot_id"],
                                              APPOINTMENT_TYPE, thread_id)
            except (SlotUnavailable, InvalidSlot):
                notes.append("Sorry - that slot was just taken, so nothing was booked.")
                fresh = [s.id for s in await asyncio.to_thread(svc.list_available_slots)]
                d["offered_slot_ids"] = fresh[:MAX_OFFERED]
                ask_slots()
            except ValidationFailure as e:
                notes.append(str(e))
                d["status"] = "collecting"
                say("Please correct that and try again.")
            except Exception as e:  # unexpected: nothing is marked booked
                log.exception("booking failed", extra={"ctx": {"err": type(e).__name__}})
                d["status"], d["last_error"] = "awaiting_confirmation", "booking_failed"
                error = "booking_failed"
                say("Something went wrong on our side and your booking was **not** created. "
                    "Reply **yes** to try again.")
            else:
                b = res.booking
                d.update(status="confirmed", reference=b.reference, booking=asdict(b),
                         offered_slot_ids=[], slot_id=b.slot_id)
                extra = "" if res.created else " (This was already confirmed earlier - no duplicate was created.)"
                say(f"Confirmed! Your {b.appointment_type} is scheduled for **{b.slot_label}** for "
                    f"{b.name}. Reference ID: **#{b.reference}**.{extra}")

        # ---- stage 3: choose + confirm ----
        require = deps.settings.booking_require_confirmation
        if status == "awaiting_confirmation" and d.get("slot_id"):
            if chosen:
                d["slot_id"] = chosen
                ask_confirm()
            elif t.get("confirm") is True:
                await do_book()
            elif t.get("confirm") is False:
                ask_slots()
            else:
                ask_confirm()
        elif chosen:
            d["slot_id"] = chosen
            if require:
                ask_confirm()
            else:
                await do_book()
        else:
            ask_slots()
        return out()

    return booking
