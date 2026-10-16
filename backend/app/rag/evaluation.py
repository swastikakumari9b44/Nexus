"""Reproducible RAG evaluation. Every number printed is computed here, from eval/dev_questions.json."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from app.llm.answerers import INSUFFICIENT, Answerer, validate_citations
from app.rag.retriever import Retriever


def _mrr(pages: list[int], expected: list[int]) -> float:
    for i, p in enumerate(pages, 1):
        if p in expected:
            return 1.0 / i
    return 0.0


async def evaluate(retriever: Retriever, answerer: Answerer, dataset_path: Path, k: int = 4) -> dict:
    data = json.loads(Path(dataset_path).read_text())
    rows, oos_rows = [], []
    for item in data["answerable"]:
        raw = retriever.search_raw(item["q"], k)
        pages = [p.page for p in raw]
        kept = [p for p in raw if p.score >= retriever.min_score]
        ans = await answerer.answer(item["q"], kept) if kept else INSUFFICIENT
        declined = INSUFFICIENT in ans
        row = {"q": item["q"], "expected_pages": item["pages"], "retrieved_pages": pages,
               "top1_score": round(raw[0].score, 3) if raw else None,
               "hit@1": bool(pages) and pages[0] in item["pages"],
               "hit@k": any(p in item["pages"] for p in pages),
               "mrr": _mrr(pages, item["pages"]), "answered": not declined}
        if not declined:
            clean, cited = validate_citations(ans, kept)
            cp = [c.page for c in cited]
            row.update(cited_pages=cp, citation_page_correct=any(p in item["pages"] for p in cp),
                       terms_ok=all(t.lower() in clean.lower() for t in item["terms"]))
        rows.append(row)
    for q in data["out_of_scope"]:
        raw = retriever.search_raw(q, k)
        kept = [p for p in raw if p.score >= retriever.min_score]
        ans = await answerer.answer(q, kept) if kept else INSUFFICIENT
        oos_rows.append({"q": q, "top1_score": round(raw[0].score, 3) if raw else None,
                         "top1_page": raw[0].page if raw else None,
                         "declined_by": "retrieval_gate" if not kept else ("answerer" if INSUFFICIENT in ans else None),
                         "correctly_declined": not kept or INSUFFICIENT in ans})
    n = len(rows)
    in_scores = [r["top1_score"] for r in rows if r["top1_score"] is not None]
    oos_scores = [r["top1_score"] for r in oos_rows if r["top1_score"] is not None]
    answered = [r for r in rows if r["answered"]]
    return {
        "config": {"embedder": retriever.embedder.name, "answerer_mode": answerer.mode,
                   "top_k": k, "min_score": retriever.min_score},
        "retrieval": {"n": n, "hit@1": sum(r["hit@1"] for r in rows) / n,
                      "hit@k": sum(r["hit@k"] for r in rows) / n,
                      "mrr": sum(r["mrr"] for r in rows) / n},
        "answers": {"answered": len(answered), "of": n,
                    "citation_page_correct": sum(bool(r.get("citation_page_correct")) for r in answered) / max(1, len(answered)),
                    "expected_terms_present": sum(bool(r.get("terms_ok")) for r in answered) / max(1, len(answered))},
        "out_of_scope": {"n": len(oos_rows),
                         "correctly_declined": sum(r["correctly_declined"] for r in oos_rows) / max(1, len(oos_rows))},
        "score_calibration": {
            "min_in_scope_top1": min(in_scores) if in_scores else None,
            "max_out_of_scope_top1": max(oos_scores) if oos_scores else None,
            "suggested_min_score": round((min(in_scores) + max(oos_scores)) / 2, 3)
            if in_scores and oos_scores and min(in_scores) > max(oos_scores) else None,
            "separable": bool(in_scores and oos_scores and min(in_scores) > max(oos_scores)),
        },
        "errors": [r for r in rows if not r["hit@k"] or not r["answered"] or not r.get("terms_ok", False)],
        "out_of_scope_rows": oos_rows, "rows": rows,
    }


def run(retriever, answerer, path, k=4) -> dict:
    return asyncio.run(evaluate(retriever, answerer, path, k))
