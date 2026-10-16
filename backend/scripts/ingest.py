"""Build the vector index. Usage:  python -m scripts.ingest [--download] [--rebuild] [--pdf PATH]"""
import argparse
import json

from app.core.config import get_settings
from app.core.logging import setup_logging
from app.rag.embeddings import make_embedder
from app.rag.ingestion import download_pdf, ingest_pdf


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--download", action="store_true", help="download the public handbook PDF first")
    ap.add_argument("--rebuild", action="store_true", help="drop and rebuild the index")
    ap.add_argument("--pdf", help="use a local PDF instead of the default location")
    a = ap.parse_args()
    s = get_settings()
    setup_logging(s.log_level)
    pdf = s.pdf_path if not a.pdf else __import__("pathlib").Path(a.pdf)
    if a.download or not pdf.exists():
        print(f"Downloading {s.handbook_url} -> {pdf}")
        download_pdf(s.handbook_url, pdf)
    stats = ingest_pdf(pdf, make_embedder(s.embedding_provider, s.fastembed_model), s.chroma_dir,
                       s.document_name, chunk_size=s.chunk_size, overlap=s.chunk_overlap,
                       rebuild=a.rebuild)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
