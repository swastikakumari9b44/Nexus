"""Deterministic turn analysis (the router's brain).

Design decision: routing and slot/confirmation parsing are rule-based so that every
transactional decision is testable and cannot be talked into anything by an LLM.
The LLM is used only for grounded answer synthesis in the RAG node.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Callable, Optional

from app.services.booking_service import Slot

from .state import TurnInfo

BOOK_VERB = re.compile(r"\b(book|schedule|arrange|reserve|set up|make an appointment)\b", re.I)
BOOK_NOUN = re.compile(r"\b(review|appointment|session|slot|meeting|1[- ]?on[- ]?1|one[- ]on[- ]one)\b", re.I)
WANT_BOOK = re.compile(r"\b(?:need|want|like|wish)\s+to\s+(?:book|schedule|arrange|reserve)\b", re.I)
CANCEL = re.compile(r"\b(cancel|never ?mind|forget it|abort)\b", re.I)
YES = re.compile(r"^\s*(yes|yep|yeah|yup|y|confirm|confirmed|sure|ok|okay|go ahead|do it|book it|please do|sounds good|that'?s (?:right|correct))\b", re.I)
NO = re.compile(r"^\s*(no|nope|nah|n|change|different|not that)\b", re.I)
Q_START = re.compile(
    r"^(?:(?:wait|actually|also|and|but|sorry|um|hmm|before that|by the way|quick question)[,:]?\s+)*"
    r"(what|when|where|who|whom|whose|why|how|which|is|are|does|do|did|can|could|should|will|would|"
    r"tell me|explain|describe|give me|list)\b", re.I)
LEAK = re.compile(
    r"(system prompt|your (instructions|prompt|rules)\b|ignore (all |any )?(the )?(previous|prior|above|earlier) "
    r"(instructions|prompts|rules)|disregard (the )?(previous|above|system)|"
    r"reveal .{0,40}(prompt|instruction|api[ _-]?key|secret|password|environment variable|env var)|"
    r"(api[ _-]?key|environment variables?|\.env\b|secret key).{0,40}(show|print|reveal|tell|give|what|dump)|"
    r"(show|print|reveal|tell|give|what|dump).{0,40}(api[ _-]?key|environment variables?|\.env\b|secret key)|"
    r"you are now|developer mode|jailbreak|act as (?:an? )?(?:unrestricted|dan))", re.I)
EMAIL_TOKEN = re.compile(r"[^\s<>()\[\],;]+@[^\s<>()\[\],;]+")
NAME_FILLER = {"email", "e-mail", "mail", "is", "my", "at", "and", "hi", "hello", "hey", "name", "i", "am", "im",
               "the", "its", "it's", "this", "me", "please", "thanks", "thank", "you", "yes", "no", "ok", "okay"}
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
ORDINALS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5}
TIME_RE = re.compile(r"\b(\d{1,2}):(\d{2})\s*(am|pm)?\b|\b(\d{1,2})\s*(am|pm)\b", re.I)


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.?!])\s+|\n+", text.strip()) if s.strip()]


def is_booking_start(s: str) -> bool:
    return bool((BOOK_VERB.search(s) and BOOK_NOUN.search(s)) or WANT_BOOK.search(s))


def is_question(s: str) -> bool:
    return not is_booking_start(s) and (s.rstrip().endswith("?") or bool(Q_START.match(s)))


def extract_email(text: str) -> Optional[str]:
    m = EMAIL_TOKEN.search(text)
    return m.group(0).rstrip(".") if m else None


def _name_from_tokens(s: str, lo: int = 2) -> Optional[str]:
    toks = [t for t in re.split(r"\s+", re.sub(r"[()\[\]<>:,;!]", " ", s).strip()) if t]
    toks = [t for t in toks if t.lower().strip(".") not in NAME_FILLER]
    if lo <= len(toks) <= 4 and all(re.fullmatch(r"[^\W\d_][\w.'\-]*", t) for t in toks):
        return " ".join(toks)
    return None


def extract_name(text: str, email_raw: Optional[str], need_name: bool) -> Optional[str]:
    m = re.search(r"(?i:my name is|name is|call me|name:)\s+([A-Za-z][A-Za-z.'\- ]{1,60})", text)
    if m:
        cand = re.split(r"(?i)\b(?:and|my|email|e-mail|at)\b|[,.(@]", m.group(1))[0].strip()
        return cand or None
    m = re.search(r"\b(?:I am|I'm|Im|this is|It's)\s+([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,3})", text)
    if m:
        return m.group(1).strip()
    if email_raw and need_name:
        before, _, after = text.partition(email_raw)
        return _name_from_tokens(before) or _name_from_tokens(after)
    if need_name and not email_raw:
        t = text.strip()
        if not YES.match(t) and not NO.match(t) and not is_booking_start(t):
            return _name_from_tokens(t, lo=2)
    return None


def _time_matches(slot: Slot, h: int, mn: int, ampm: Optional[str]) -> bool:
    if slot.start.minute != mn:
        return False
    sh = slot.start.hour
    if ampm:
        h24 = (h % 12) + (12 if ampm.lower() == "pm" else 0)
        return sh == h24
    return sh % 12 == h % 12


def match_slots(text: str, pool_ids: list[str], offered_ids: list[str],
                get_slot: Callable[[str], Optional[Slot]], today: date) -> tuple[list[str], bool]:
    """Return (matched slot ids, attempted?)."""
    t = text.lower()
    # 1) by position in the offered list: "2", "option 2", "the second one"
    m = re.search(r"\b(?:option|slot|number|no\.?|choice|#)\s*(\d{1,2})\b", t) or \
        re.fullmatch(r"\s*(?:i(?:'ll| will)?\s+(?:take|choose|pick)\s+)?(\d{1,2})[.)]?\s*", t)
    if m and offered_ids:
        idx = int(m.group(1)) - 1
        return ([offered_ids[idx]] if 0 <= idx < len(offered_ids) else []), True
    for word, n in ORDINALS.items():
        if re.search(rf"\b{word}\b", t) and offered_ids:
            return ([offered_ids[n - 1]] if n - 1 < len(offered_ids) else []), True
    if re.search(r"\blast (?:one|option|slot)\b", t) and offered_ids:
        return [offered_ids[-1]], True

    slots = [s for s in (get_slot(i) for i in pool_ids) if s]
    times = TIME_RE.findall(t)
    day_words = [w for w in WEEKDAYS if re.search(rf"\b{w[:3]}(?:{w[3:]})?\b", t)]
    wants_today, wants_tomorrow = bool(re.search(r"\btoday\b", t)), bool(re.search(r"\btomorrow\b", t))
    if not times and not day_words and not wants_today and not wants_tomorrow:
        return [], False

    cands = slots
    if times:
        parsed = [(int(a or d), int(b or 0), (c or e) or None) for a, b, c, d, e in times]
        cands = [s for s in cands if any(_time_matches(s, h, mn, ap) for h, mn, ap in parsed)]
    if day_words:
        cands = [s for s in cands if s.start.strftime("%A").lower() in day_words]
    if wants_today:
        cands = [s for s in cands if s.start.date() == today]
    if wants_tomorrow:
        cands = [s for s in cands if s.start.date() == today + timedelta(days=1)]
    return [s.id for s in cands], True


def analyze_turn(
    text: str,
    status: str,
    has_name: bool,
    offered_ids: list[str],
    available_ids: list[str],
    get_slot: Callable[[str], Optional[Slot]],
    today: date,
    request_slot_id: Optional[str] = None,
) -> TurnInfo:
    turn: TurnInfo = {"question": None, "start_booking": False, "cancel": False, "name": None,
                      "email_raw": None, "slot_ids": [], "slot_attempt": False, "confirm": None,
                      "blocked": False}
    if LEAK.search(text):
        turn["blocked"] = True
        return turn

    sentences = split_sentences(text)
    questions = [s for s in sentences if is_question(s)]
    rest = " ".join(s for s in sentences if s not in questions)
    turn["question"] = " ".join(questions) or None
    turn["start_booking"] = any(is_booking_start(s) for s in sentences)
    active = status in ("collecting", "awaiting_slot", "awaiting_confirmation")
    in_flow = active or turn["start_booking"]
    if not in_flow:
        return turn

    if active and CANCEL.search(rest):
        turn["cancel"] = True
        return turn

    turn["email_raw"] = extract_email(rest)
    turn["name"] = extract_name(rest, turn["email_raw"], need_name=not has_name)

    if request_slot_id:
        turn["slot_ids"], turn["slot_attempt"] = [request_slot_id], True
    else:
        pool = offered_ids or available_ids
        if status in ("awaiting_slot", "awaiting_confirmation") or turn["email_raw"] or turn["name"] or offered_ids:
            ids, attempt = match_slots(rest, pool, offered_ids, get_slot, today)
            if not ids and offered_ids and pool is offered_ids:
                # wording didn't hit a listed slot: allow any other open slot ("tomorrow at 3 pm")
                ids, attempt2 = match_slots(rest, available_ids, offered_ids, get_slot, today)
                attempt = attempt or attempt2
            turn["slot_ids"], turn["slot_attempt"] = ids, attempt

    if status == "awaiting_confirmation" and not turn["slot_attempt"]:
        if YES.match(rest):
            turn["confirm"] = True
        elif NO.match(rest):
            turn["confirm"] = False
    return turn
