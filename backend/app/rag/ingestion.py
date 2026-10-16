"""Reproducible PDF ingestion: download -> extract pages -> chunk -> embed -> Chroma.

Ingestion is a separate step from chat serving (see scripts/ingest.py). It is
idempotent: chunk ids are deterministic and written with upsert; `rebuild=True`
drops the collection first.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

import chromadb
import httpx
from chromadb.config import Settings as ChromaSettings

from .embeddings import Embedder

log = logging.getLogger(__name__)
COLLECTION = "handbook"


@dataclass(frozen=True)
class PageText:
    page: int  # 1-based, as printed in a PDF viewer
    text: str


@dataclass(frozen=True)
class Chunk:
    id: str
    page: int
    index: int
    text: str


def download_pdf(url: str, dest: Path, timeout: float = 60.0) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    resp = httpx.get(url, timeout=timeout, follow_redirects=True)
    resp.raise_for_status()
    if not resp.content.startswith(b"%PDF"):
        raise ValueError("Downloaded file is not a PDF")
    dest.write_bytes(resp.content)
    return dest


def extract_pages(pdf_path: Path) -> list[PageText]:
    from pypdf import PdfReader

    reader = PdfReader(str(pdf_path))
    pages: list[PageText] = []
    for i, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception as e:  # corrupt page: skip, keep going
            log.warning("page extraction failed", extra={"ctx": {"page": i, "err": type(e).__name__}})
            continue
        text = _clean(text)
        if len(text) < 20:  # empty / title-only pages carry no retrievable content
            continue
        pages.append(PageText(i, text))
    return pages


def _clean(text: str) -> str:
    text = re.sub(r"-\n(?=[a-z])", "", text)  # de-hyphenate line breaks
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\s*\n\s*", " ", text)
    return text.strip()


def chunk_page(page: PageText, size: int = 800, overlap: int = 150) -> list[Chunk]:
    """Character window with overlap, preferring to cut at a sentence boundary."""
    if overlap >= size:
        raise ValueError("overlap must be smaller than chunk size")
    text, n = page.text, len(page.text)
    chunks: list[Chunk] = []
    start = idx = 0
    while start < n:
        end = min(start + size, n)
        if end < n:
            window = text[start:end]
            cut = max(window.rfind(". "), window.rfind("? "), window.rfind("! "))
            if cut > size * 0.5:
                end = start + cut + 1
        piece = text[start:end].strip()
        if piece:
            chunks.append(Chunk(f"p{page.page:02d}-c{idx:02d}", page.page, idx, piece))
            idx += 1
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return chunks


def open_collection(chroma_dir: Path, create: bool = True):
    client = chromadb.PersistentClient(
        path=str(chroma_dir), settings=ChromaSettings(anonymized_telemetry=False)
    )
    if create:
        return client, client.get_or_create_collection(COLLECTION, metadata={"hnsw:space": "cosine"})
    return client, client.get_collection(COLLECTION)


def ingest_pages(
    pages: list[PageText],
    embedder: Embedder,
    chroma_dir: Path,
    doc_name: str,
    chunk_size: int = 800,
    overlap: int = 150,
    rebuild: bool = False,
) -> dict:
    client, _ = open_collection(chroma_dir)
    if rebuild:
        client.delete_collection(COLLECTION)
    _, col = open_collection(chroma_dir)

    existing = col.get(limit=1, include=["metadatas"])
    if existing["metadatas"] and existing["metadatas"][0].get("embedder") != embedder.name:
        raise RuntimeError(
            f"Index was built with a different embedder "
            f"({existing['metadatas'][0].get('embedder')}). Re-run ingestion with --rebuild."
        )

    chunks = [c for p in pages for c in chunk_page(p, chunk_size, overlap)]
    if not chunks:
        raise ValueError("No extractable text found in document")
    vectors = embedder.embed_documents([c.text for c in chunks])
    col.upsert(
        ids=[f"{doc_name}:{c.id}" for c in chunks],
        embeddings=vectors,
        documents=[c.text for c in chunks],
        metadatas=[
            {"source": doc_name, "page": c.page, "chunk": c.index, "embedder": embedder.name}
            for c in chunks
        ],
    )
    stats = {"pages": len(pages), "chunks": len(chunks), "total_in_index": col.count(),
             "embedder": embedder.name}
    log.info("ingested", extra={"ctx": stats})
    return stats


def ingest_pdf(pdf_path: Path, embedder: Embedder, chroma_dir: Path, doc_name: str, **kw) -> dict:
    return ingest_pages(extract_pages(pdf_path), embedder, chroma_dir, doc_name, **kw)
