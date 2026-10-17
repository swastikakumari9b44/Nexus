from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

from .embeddings import Embedder
from .ingestion import open_collection


@dataclass(frozen=True)
class Passage:
    id: str
    source: str
    page: int
    text: str
    score: float  # cosine similarity (1 - cosine distance)


class Retriever:
    def __init__(self, chroma_dir: Path, embedder: Embedder, top_k: int = 4, min_score: float = 0.2):
        self.chroma_dir = chroma_dir
        self.embedder = embedder
        self.top_k = top_k
        self.min_score = min_score
        self._col = None

    def _collection(self):
        if self._col is None:
            try:
                _, self._col = open_collection(self.chroma_dir, create=False)
            except Exception:
                return None
        return self._col

    def is_ready(self) -> bool:
        for _ in range(2):
            col = self._collection()
            if col is None:
                return False
            try:
                return col.count() > 0
            except Exception:       # handle went stale (index rebuilt by another process)
                self._col = None
        return False

    def search_raw(self, query: str, k: int | None = None) -> list[Passage]:
        """Top-k by similarity with NO threshold (used by evaluation/calibration)."""
        res = None
        for attempt in (1, 2):
            col = self._collection()
            if col is None:
                return []
            try:
                if col.count() == 0:
                    return []
                res = col.query(
                    query_embeddings=[self.embedder.embed_query(query)],
                    n_results=k or self.top_k,
                    include=["documents", "metadatas", "distances"],
                )
                break
            except Exception:
                self._col = None    # stale handle after a rebuild: reopen once, then give up
                if attempt == 2:
                    raise
        out = []
        for id_, doc, meta, dist in zip(res["ids"][0], res["documents"][0],
                                        res["metadatas"][0], res["distances"][0]):
            out.append(Passage(id_, meta["source"], int(meta["page"]), doc, 1.0 - float(dist)))
        return out

    def search(self, query: str) -> list[Passage]:
        return [p for p in self.search_raw(query) if p.score >= self.min_score]

    async def asearch(self, query: str) -> list[Passage]:
        return await asyncio.to_thread(self.search, query)
