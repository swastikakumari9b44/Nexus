import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass

from app.core.config import Settings
from app.llm.answerers import Answerer
from app.rag.retriever import Retriever
from app.services.booking_service import BookingService


class ThreadLocks:
    """Serialises turns within one thread (a double-click or client retry can't interleave
    two graph runs on the same checkpoint). Entries are dropped when nobody waits."""

    def __init__(self) -> None:
        self._locks: dict[str, list] = {}

    @asynccontextmanager
    async def hold(self, thread_id: str):
        entry = self._locks.setdefault(thread_id, [asyncio.Lock(), 0])
        entry[1] += 1
        try:
            async with entry[0]:
                yield
        finally:
            entry[1] -= 1
            if entry[1] == 0:
                self._locks.pop(thread_id, None)


@dataclass
class Container:
    settings: Settings
    booking: BookingService
    retriever: Retriever
    answerer: Answerer
    graph: object
    embedder_name: str
    locks: ThreadLocks
