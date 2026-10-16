from dataclasses import dataclass

from app.core.config import Settings
from app.llm.answerers import Answerer
from app.rag.retriever import Retriever
from app.services.booking_service import BookingService


@dataclass
class GraphDeps:
    settings: Settings
    booking: BookingService
    retriever: Retriever
    answerer: Answerer
