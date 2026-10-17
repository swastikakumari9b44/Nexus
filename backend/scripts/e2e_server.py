"""Server for browser E2E tests.

It is the REAL application: FastAPI app + LangGraph graph + SQLite checkpointer + booking DB +
Chroma + the real public handbook PDF. Isolation and determinism come from configuration only:
  * a fresh temporary data directory per run (override with --data-dir),
  * EMBEDDING_PROVIDER=hash (offline, deterministic) and LLM_PROVIDER=dev (extractive, labelled),
  * optional pacing of SSE chunks (E2E_SSE_DELAY_MS) so a browser can observe the live node status.
    The pacing only delays bytes the real app already produced; it changes no behaviour.
Usage (from backend/):  python -m scripts.e2e_server --port 8000
"""
import argparse
import asyncio
import os
import sys
import tempfile
from pathlib import Path

import uvicorn

from app.core.config import BACKEND_DIR, Settings
from app.core.logging import setup_logging
from app.main import create_app
from app.rag.embeddings import HashEmbedder
from app.rag.ingestion import download_pdf, ingest_pdf


class PaceSSE:
    def __init__(self, app, delay_s: float):
        self.app, self.delay = app, delay_s

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"] == "/api/chat/stream" and self.delay > 0:
            async def paced(msg):
                if msg["type"] == "http.response.body" and msg.get("body"):
                    await asyncio.sleep(self.delay)
                await send(msg)
            return await self.app(scope, receive, paced)
        return await self.app(scope, receive, send)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--data-dir")
    ap.add_argument("--origins", default="http://127.0.0.1:4173,http://127.0.0.1:4174")
    a = ap.parse_args()

    data_dir = Path(a.data_dir) if a.data_dir else Path(tempfile.mkdtemp(prefix="nexus-e2e-"))
    s = Settings(data_dir=data_dir, embedding_provider="hash", llm_provider="dev", cors_origins=a.origins)
    setup_logging("WARNING")

    cache = BACKEND_DIR / "data" / "source" / s.document_name        # cached download (git-ignored)
    if not cache.exists():
        print(f"downloading {s.handbook_url}", flush=True)
        download_pdf(s.handbook_url, cache)
    stats = ingest_pdf(cache, HashEmbedder(), s.chroma_dir, s.document_name,
                       chunk_size=s.chunk_size, overlap=s.chunk_overlap, rebuild=True)
    if not a.data_dir:      # only the primary server records its directory (secondary instances pass --data-dir)
        (BACKEND_DIR / "data").mkdir(exist_ok=True)
        (BACKEND_DIR / "data" / "e2e_last_data_dir.txt").write_text(str(data_dir), encoding="utf-8")
    print(f"E2E data dir: {data_dir} | index: {stats}", flush=True)

    app = PaceSSE(create_app(s), float(os.getenv("E2E_SSE_DELAY_MS", "0")) / 1000)
    uvicorn.run(app, host="127.0.0.1", port=a.port, log_level="warning")


if __name__ == "__main__":
    sys.exit(main())
