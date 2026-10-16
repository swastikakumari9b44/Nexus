from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.core.config import Settings
from app.rag.embeddings import HashEmbedder
from app.rag.ingestion import PageText, ingest_pages
from app.services.booking_service import BookingService

IST = ZoneInfo("Asia/Kolkata")
# Fixed "now": Thursday 15 Oct 2026, 09:00 IST  -> slots start Thu 15 Oct 15:00 onward
FIXED_NOW = datetime(2026, 10, 15, 9, 0, tzinfo=IST)

# Synthetic handbook (NOT the real PDF) so unit tests are offline and deterministic.
SYNTH_PAGES = [
    PageText(3, "Acme Corp builds industrial widgets. Our mission is quality and safety in every product we ship."),
    PageText(4, "Performance Reviews. Performance reviews are conducted every six months by your supervisor. "
                "During the review your supervisor discusses your goals and gives feedback on areas for improvement. "
                "Employees receive a written summary after each performance review."),
    PageText(5, "Workplace Safety. Our safety program includes hazard identification, safety training, "
                "personal protective equipment and regular inspections. Report incidents to the safety department."),
    PageText(7, "Privacy. Acme will not sell personal information. Contact the Privacy Officer to request deletion "
                "or correction of your personal data."),
    PageText(9, "Data Security. All customer data must be encrypted. Employees complete data security training "
                "annually. Passwords must be complex and updated regularly."),
]


@pytest.fixture
def clock():
    return lambda: FIXED_NOW


@pytest.fixture
def settings(tmp_path):
    return Settings(data_dir=tmp_path, embedding_provider="hash", llm_provider="dev",
                    booking_require_confirmation=True)


@pytest.fixture
def booking(tmp_path, clock):
    return BookingService(tmp_path / "bookings.sqlite", clock=clock)


@pytest.fixture
def indexed(settings):
    ingest_pages(SYNTH_PAGES, HashEmbedder(), settings.chroma_dir, "employee_handbook.pdf")
    return settings
