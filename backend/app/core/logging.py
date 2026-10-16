"""Structured logging. Never log message bodies, emails, or credentials."""
import hashlib
import json
import logging
import sys


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {"level": record.levelname, "logger": record.name, "msg": record.getMessage()}
        extra = getattr(record, "ctx", None)
        if extra:
            payload.update(extra)
        if record.exc_info:
            payload["exc"] = record.exc_info[0].__name__ if record.exc_info[0] else None
        return json.dumps(payload, default=str)


def setup_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    root.handlers.clear()
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(JsonFormatter())
    root.addHandler(h)
    root.setLevel(level.upper())
    logging.getLogger("httpx").setLevel(logging.WARNING)  # httpx logs URLs


def short_id(value: str) -> str:
    """Stable, non-reversible short identifier for log correlation."""
    return hashlib.sha256(value.encode()).hexdigest()[:10]
