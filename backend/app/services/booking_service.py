"""Deterministic, transactional booking service (SQLite).

All booking decisions are made here, never by an LLM. `book()` runs inside a
BEGIN IMMEDIATE transaction, is idempotent, and a partial unique index on
confirmed slots is the final backstop against double booking.
"""
from __future__ import annotations

import hashlib
import re
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, Optional
from zoneinfo import ZoneInfo

from email_validator import EmailNotValidError, validate_email

APPOINTMENT_TYPE = "Performance Review"
_REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_NAME_RE = re.compile(r"[^\W\d_]+(?:[ .'\-][^\W\d_]+)*\.?")


class BookingError(Exception):
    code = "booking_error"


class ValidationFailure(BookingError):
    code = "validation_failed"


class InvalidSlot(BookingError):
    code = "invalid_slot"


class SlotUnavailable(BookingError):
    code = "slot_unavailable"


@dataclass(frozen=True)
class Slot:
    id: str  # local ISO, e.g. 2026-10-16T11:00
    start: datetime
    label: str


@dataclass(frozen=True)
class Booking:
    reference: str
    slot_id: str
    slot_label: str
    name: str
    email: str
    appointment_type: str
    status: str
    thread_id: Optional[str]
    created_at: str


@dataclass(frozen=True)
class BookResult:
    booking: Booking
    created: bool  # False => idempotent replay of an earlier identical request


def validate_name(name: str) -> str:
    name = " ".join((name or "").split())
    if not (2 <= len(name) <= 80) or not _NAME_RE.fullmatch(name):
        raise ValidationFailure("Please provide your full name using letters only (e.g. 'Alex Chen').")
    if len(name.split()) < 2:
        raise ValidationFailure("Please provide your full name (first and last name).")
    return name


def validate_email_address(email: str) -> str:
    try:
        return validate_email((email or "").strip(), check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        raise ValidationFailure(
            "That email address doesn't look valid. Please enter it like name@company.com."
        ) from None


class BookingService:
    def __init__(
        self,
        db_path: Path,
        tz: str = "Asia/Kolkata",
        clock: Optional[Callable[[], datetime]] = None,
        times: tuple[str, ...] = ("10:30", "11:00", "15:00", "16:30"),
        business_days: int = 5,
        min_lead: timedelta = timedelta(hours=2),
    ):
        self.db_path = Path(db_path)
        self.tz = ZoneInfo(tz)
        self.tz_name = tz
        self._clock = clock
        self.times = times
        self.business_days = business_days
        self.min_lead = min_lead
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    # ---- infrastructure ------------------------------------------------
    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init_db(self) -> None:
        conn = self._connect()
        try:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS bookings (
                    reference TEXT PRIMARY KEY,
                    slot_id TEXT NOT NULL,
                    slot_label TEXT NOT NULL,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL,
                    appointment_type TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('confirmed','cancelled')),
                    thread_id TEXT,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL
                )"""
            )
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_confirmed_slot "
                "ON bookings(slot_id) WHERE status='confirmed'"
            )
        finally:
            conn.close()

    def now(self) -> datetime:
        return self._clock().astimezone(self.tz) if self._clock else datetime.now(self.tz)

    # ---- slots -----------------------------------------------------------
    def _label(self, start: datetime) -> str:
        today = self.now().date()
        rel = ""
        if start.date() == today:
            rel = "Today, "
        elif start.date() == today + timedelta(days=1):
            rel = "Tomorrow, "
        hour = start.strftime("%I:%M %p").lstrip("0")
        zone = "IST" if self.tz_name == "Asia/Kolkata" else start.tzname()
        return f"{rel}{start.strftime('%a %d %b')} · {hour} {zone}"

    def generate_slots(self) -> list[Slot]:
        now = self.now()
        out: list[Slot] = []
        day = now.date()
        counted = 0
        while counted < self.business_days:
            if day.weekday() < 5:
                counted += 1
                for t in self.times:
                    hh, mm = (int(x) for x in t.split(":"))
                    start = datetime(day.year, day.month, day.day, hh, mm, tzinfo=self.tz)
                    if start - now >= self.min_lead:
                        out.append(Slot(start.strftime("%Y-%m-%dT%H:%M"), start, self._label(start)))
            day += timedelta(days=1)
        return out

    @staticmethod
    def _booked_slot_ids(conn: sqlite3.Connection) -> set[str]:
        rows = conn.execute("SELECT slot_id FROM bookings WHERE status='confirmed'").fetchall()
        return {r["slot_id"] for r in rows}

    def list_available_slots(self) -> list[Slot]:
        conn = self._connect()
        try:
            taken = self._booked_slot_ids(conn)
        finally:
            conn.close()
        return [s for s in self.generate_slots() if s.id not in taken]

    def get_slot(self, slot_id: str) -> Optional[Slot]:
        return next((s for s in self.generate_slots() if s.id == slot_id), None)

    def is_available(self, slot_id: str) -> bool:
        return any(s.id == slot_id for s in self.list_available_slots())

    # ---- booking ---------------------------------------------------------
    @staticmethod
    def idempotency_key(thread_id: Optional[str], slot_id: str, email: str, appointment_type: str) -> str:
        raw = f"{thread_id or '-'}|{slot_id}|{email}|{appointment_type}"
        return hashlib.sha256(raw.encode()).hexdigest()

    def book(
        self,
        name: str,
        email: str,
        slot_id: str,
        appointment_type: str = APPOINTMENT_TYPE,
        thread_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> BookResult:
        name = validate_name(name)
        email = validate_email_address(email)
        slot = self.get_slot(slot_id)
        if slot is None:
            raise InvalidSlot("That isn't one of the bookable time slots.")
        key = idempotency_key or self.idempotency_key(thread_id, slot_id, email, appointment_type)

        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            try:
                existing = conn.execute(
                    "SELECT * FROM bookings WHERE idempotency_key=? AND status='confirmed'", (key,)
                ).fetchone()
                if existing:
                    conn.execute("COMMIT")
                    return BookResult(self._row(existing), created=False)
                if slot_id in self._booked_slot_ids(conn):
                    raise SlotUnavailable("That slot was just taken. Please choose another one.")
                reference = self._new_reference(conn)
                created_at = self.now().isoformat(timespec="seconds")
                conn.execute(
                    "INSERT INTO bookings VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (reference, slot_id, slot.label, name, email, appointment_type,
                     "confirmed", thread_id, key, created_at),
                )
                row = conn.execute("SELECT * FROM bookings WHERE reference=?", (reference,)).fetchone()
                conn.execute("COMMIT")
                return BookResult(self._row(row), created=True)
            except sqlite3.IntegrityError as e:  # backstop: unique index / key race
                if conn.in_transaction:
                    conn.execute("ROLLBACK")
                raise SlotUnavailable("That slot was just taken. Please choose another one.") from e
            except BaseException:
                if conn.in_transaction:
                    conn.execute("ROLLBACK")
                raise
        finally:
            conn.close()

    def find_by_key(self, thread_id: Optional[str], slot_id: str, email: str,
                    appointment_type: str = APPOINTMENT_TYPE) -> Optional[Booking]:
        """Look up the confirmed booking an identical earlier `book()` call would have created.
        Used to recover when the outcome of a call is unknown (e.g. connection lost after COMMIT)."""
        key = self.idempotency_key(thread_id, slot_id, email.strip().lower(), appointment_type)
        conn = self._connect()
        try:
            r = conn.execute("SELECT * FROM bookings WHERE idempotency_key=? AND status='confirmed'", (key,)).fetchone()
        finally:
            conn.close()
        return self._row(r) if r else None

    @staticmethod
    def _new_reference(conn: sqlite3.Connection) -> str:
        for _ in range(10):
            ref = "REV-" + "".join(secrets.choice(_REF_ALPHABET) for _ in range(6))
            if not conn.execute("SELECT 1 FROM bookings WHERE reference=?", (ref,)).fetchone():
                return ref
        raise BookingError("Could not allocate a unique booking reference.")

    @staticmethod
    def _row(r: sqlite3.Row) -> Booking:
        return Booking(r["reference"], r["slot_id"], r["slot_label"], r["name"], r["email"],
                       r["appointment_type"], r["status"], r["thread_id"], r["created_at"])

    def get_booking(self, reference: str) -> Optional[Booking]:
        conn = self._connect()
        try:
            r = conn.execute("SELECT * FROM bookings WHERE reference=?", (reference,)).fetchone()
        finally:
            conn.close()
        return self._row(r) if r else None

    def cancel_booking(self, reference: str) -> bool:
        """confirmed -> cancelled (frees the slot). Cancelled is terminal."""
        conn = self._connect()
        try:
            cur = conn.execute(
                "UPDATE bookings SET status='cancelled' WHERE reference=? AND status='confirmed'",
                (reference,),
            )
            return cur.rowcount == 1
        finally:
            conn.close()
