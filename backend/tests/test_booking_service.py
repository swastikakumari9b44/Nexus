import sqlite3
import threading

import pytest

from app.services.booking_service import (
    BookingService, InvalidSlot, SlotUnavailable, ValidationFailure,
    validate_email_address, validate_name,
)


def test_slots_are_future_ist_and_labelled(booking):
    slots = booking.list_available_slots()
    assert slots, "expected slots"
    assert all(s.start.tzname() == "IST" for s in slots)
    assert all(s.start > booking.now() for s in slots)
    assert all(s.start.weekday() < 5 for s in slots)          # no weekends
    assert slots[0].id == "2026-10-15T11:00"                    # 10:30 is <2h lead from 09:00; 11:00 is exactly 2h
    assert slots[0].label.startswith("Today, Thu 15 Oct · 11:00 AM IST")
    assert any(s.label.startswith("Tomorrow") for s in slots)


def test_successful_booking_persists_and_has_reference(booking, tmp_path):
    slot = booking.list_available_slots()[0]
    res = booking.book("Alex Chen", "Alex.Chen@Example.com", slot.id, thread_id="t1")
    assert res.created and res.booking.reference.startswith("REV-")
    assert res.booking.email == "alex.chen@example.com"
    # durable: a brand new service instance on the same file sees it
    again = BookingService(tmp_path / "bookings.sqlite", clock=booking._clock)
    assert again.get_booking(res.booking.reference).name == "Alex Chen"
    assert slot.id not in [s.id for s in again.list_available_slots()]


@pytest.mark.parametrize("name", ["", "A", "Alex", "12345 678", "Alex <script>"])
def test_invalid_names_rejected(name):
    with pytest.raises(ValidationFailure):
        validate_name(name)


@pytest.mark.parametrize("email", ["", "bad", "bad@", "a@b", "x y@z.com"])
def test_invalid_emails_rejected(email):
    with pytest.raises(ValidationFailure):
        validate_email_address(email)


def test_invalid_and_past_slots_rejected(booking):
    with pytest.raises(InvalidSlot):
        booking.book("Alex Chen", "a@example.com", "2020-01-01T10:30")
    with pytest.raises(InvalidSlot):
        booking.book("Alex Chen", "a@example.com", "2026-10-15T10:30")  # inside min lead
    with pytest.raises(InvalidSlot):
        booking.book("Alex Chen", "a@example.com", "not-a-slot")


def test_double_booking_conflict(booking):
    slot = booking.list_available_slots()[0]
    booking.book("Alex Chen", "a@example.com", slot.id, thread_id="t1")
    with pytest.raises(SlotUnavailable):
        booking.book("Sam Lee", "s@example.com", slot.id, thread_id="t2")


def test_duplicate_submission_is_idempotent(booking):
    slot = booking.list_available_slots()[0]
    r1 = booking.book("Alex Chen", "a@example.com", slot.id, thread_id="t1")
    r2 = booking.book("Alex Chen", "a@example.com", slot.id, thread_id="t1")
    assert r1.created and not r2.created
    assert r1.booking.reference == r2.booking.reference
    conn = sqlite3.connect(booking.db_path)
    assert conn.execute("select count(*) from bookings").fetchone()[0] == 1


def test_concurrent_requests_book_only_once(booking):
    slot = booking.list_available_slots()[0]
    results, errors = [], []

    def go(i):
        try:
            results.append(booking.book(f"User Number{chr(65+i)}", f"u{i}@example.com", slot.id, thread_id=f"t{i}"))
        except SlotUnavailable as e:
            errors.append(e)

    ts = [threading.Thread(target=go, args=(i,)) for i in range(8)]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert len(results) == 1 and len(errors) == 7


def test_cancel_frees_slot_and_is_terminal(booking):
    slot = booking.list_available_slots()[0]
    ref = booking.book("Alex Chen", "a@example.com", slot.id, thread_id="t1").booking.reference
    assert booking.cancel_booking(ref) is True
    assert booking.cancel_booking(ref) is False           # terminal
    assert booking.get_booking(ref).status == "cancelled"
    assert booking.book("Sam Lee", "s@example.com", slot.id, thread_id="t2").created  # slot reusable


def test_failure_leaves_no_partial_row(booking, monkeypatch):
    slot = booking.list_available_slots()[0]
    monkeypatch.setattr(BookingService, "_new_reference", staticmethod(lambda c: (_ for _ in ()).throw(RuntimeError("boom"))))
    with pytest.raises(RuntimeError):
        booking.book("Alex Chen", "a@example.com", slot.id, thread_id="t1")
    monkeypatch.undo()
    assert slot.id in [s.id for s in booking.list_available_slots()]   # nothing persisted, slot still free
    assert booking.book("Alex Chen", "a@example.com", slot.id, thread_id="t1").created  # retry succeeds
