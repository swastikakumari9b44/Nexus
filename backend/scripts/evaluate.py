"""RAG evaluation. Usage: python -m scripts.evaluate [--json out.json]"""
import argparse
import json
from pathlib import Path

from app.core.config import BACKEND_DIR, get_settings
from app.llm.answerers import ExtractiveAnswerer, make_answerer
from app.rag.embeddings import make_embedder
from app.rag.evaluation import run
from app.rag.retriever import Retriever


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", help="write the full report to this path")
    ap.add_argument("--answerer", choices=["configured", "dev"], default="dev",
                    help="'dev' = extractive (deterministic, no API); 'configured' = LLM_PROVIDER from .env")
    a = ap.parse_args()
    s = get_settings()
    emb = make_embedder(s.embedding_provider, s.fastembed_model)
    r = Retriever(s.chroma_dir, emb, s.rag_top_k, s.effective_min_score)
    if not r.is_ready():
        raise SystemExit("Index is empty. Run: python -m scripts.ingest --download")
    ans = ExtractiveAnswerer() if a.answerer == "dev" else make_answerer(s)
    rep = run(r, ans, BACKEND_DIR / "eval" / "dev_questions.json", s.rag_top_k)
    print(json.dumps({k: rep[k] for k in ("config", "retrieval", "answers", "out_of_scope", "score_calibration")}, indent=2))
    print("\nPer-question (in scope):")
    for row in rep["rows"]:
        print(f"  hit@1={int(row['hit@1'])} hit@k={int(row['hit@k'])} score={row['top1_score']} "
              f"pages={row['retrieved_pages']} exp={row['expected_pages']} terms={row.get('terms_ok')}  {row['q']}")
    print("\nOut of scope:")
    for row in rep["out_of_scope_rows"]:
        print(f"  declined={int(row['correctly_declined'])} top1={row['top1_score']} (p{row['top1_page']})  {row['q']}")
    if a.json:
        Path(a.json).write_text(json.dumps(rep, indent=2))


if __name__ == "__main__":
    main()
