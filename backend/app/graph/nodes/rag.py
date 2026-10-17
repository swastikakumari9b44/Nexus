import asyncio
import logging

from app.graph.deps import GraphDeps
from app.graph.state import AgentState
from app.llm.answerers import INSUFFICIENT, validate_citations

log = logging.getLogger(__name__)

SNIPPET_CHARS = 1200   # chunks are <= ~800 chars: show the whole passage the answer was grounded in

FALLBACK = ("I couldn't find that in the Employee Handbook, so I don't want to guess. "
            "Try rephrasing, or ask about a policy the handbook covers.")


def make_rag(deps: GraphDeps):
    async def rag(state: AgentState) -> dict:
        question = (state.get("turn") or {}).get("question") or ""
        parts = list(state.get("reply_parts") or [])
        trace = list(state.get("trace") or []) + ["rag"]
        base = {"trace": trace, "active_node": "rag"}

        if not await asyncio.to_thread(deps.retriever.is_ready):
            parts.append("The handbook knowledge base hasn't been indexed yet. "
                         "Run `python -m scripts.ingest --download` in the backend, then try again.")
            return {**base, "reply_parts": parts, "citations": [], "error": "index_not_ready"}

        try:
            passages = await deps.retriever.asearch(question)
        except Exception as e:
            log.warning("retrieval failed", extra={"ctx": {"err": type(e).__name__}})
            parts.append("The handbook search is temporarily unavailable. Any booking progress is saved - please try again shortly.")
            return {**base, "reply_parts": parts, "citations": [], "error": "retrieval_unavailable"}
        if not passages:
            parts.append(FALLBACK)
            return {**base, "reply_parts": parts, "citations": []}
        try:
            raw = await deps.answerer.answer(question, passages)
        except Exception as e:  # provider timeout / HTTP error: degrade, don't 500, keep booking state
            log.warning("answerer failed", extra={"ctx": {"err": type(e).__name__}})
            parts.append("I couldn't reach the language model just now, so I can't answer handbook "
                         "questions right this moment. Any booking progress is saved - please try again shortly.")
            return {**base, "reply_parts": parts, "citations": [], "error": "llm_unavailable"}
        if INSUFFICIENT in raw:
            parts.append(FALLBACK)
            return {**base, "reply_parts": parts, "citations": []}

        clean, cited = validate_citations(raw, passages)
        parts.append(clean)
        citations = [{"source": p.source, "page": p.page, "snippet": p.text[:SNIPPET_CHARS],
                      "score": round(p.score, 3), "chunk_id": p.id} for p in cited]
        return {**base, "reply_parts": parts, "citations": citations}

    return rag
