import logging
from contextlib import asynccontextmanager
from typing import Callable, Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.container import Container, ThreadLocks
from app.api.routes.api import router
from app.core.config import Settings, get_settings
from app.core.logging import setup_logging
from app.graph.builder import build_graph
from app.graph.deps import GraphDeps
from app.llm.answerers import Answerer, make_answerer
from app.persistence.checkpointing import open_checkpointer
from app.rag.embeddings import make_embedder
from app.rag.retriever import Retriever
from app.services.booking_service import BookingService

log = logging.getLogger("nexus")
MAX_BODY_BYTES = 16 * 1024


def create_app(settings: Optional[Settings] = None, clock: Optional[Callable] = None,
               answerer: Optional[Answerer] = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        setup_logging(settings.log_level)
        booking = BookingService(settings.bookings_db, tz=settings.timezone, clock=clock)
        try:
            embedder = make_embedder(settings.embedding_provider, settings.fastembed_model)
        except Exception as e:
            raise RuntimeError(
                f"Could not initialise embedding provider '{settings.embedding_provider}' ({type(e).__name__}). "
                "If the model can't be downloaded, set EMBEDDING_PROVIDER=hash (lexical, offline) "
                "and re-run ingestion with --rebuild.") from e
        retriever = Retriever(settings.chroma_dir, embedder, settings.rag_top_k, settings.effective_min_score)
        ans = answerer or make_answerer(settings)
        if not retriever.is_ready():
            log.warning("vector index is empty - run `python -m scripts.ingest --download`")
        log.info("starting", extra={"ctx": {"llm_mode": ans.mode, "embedder": embedder.name}})
        async with open_checkpointer(settings.checkpoint_db) as cp:
            graph = build_graph(GraphDeps(settings, booking, retriever, ans), cp)
            app.state.container = Container(settings, booking, retriever, ans, graph, embedder.name, ThreadLocks())
            yield
        log.info("stopped")

    app = FastAPI(title="NEXUS - Stateful AI Service Assistant", version="1.0.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type"], allow_credentials=False)

    @app.middleware("http")
    async def limit_body(request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > MAX_BODY_BYTES:
            return JSONResponse({"error": "payload_too_large", "detail": "Request body too large"}, status_code=413)
        resp = await call_next(request)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        return resp

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.error("unhandled", extra={"ctx": {"path": request.url.path, "err": type(exc).__name__}})
        return JSONResponse({"error": "internal_error", "detail": "Something went wrong. Please retry."},
                            status_code=500)

    app.include_router(router)
    return app


app = None  # `uvicorn app.main:create_app --factory`
