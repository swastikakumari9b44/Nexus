"""Embedding providers behind one interface.

* `fastembed`  - local ONNX model (default; semantic; needs a one-time model download).
* `hash`       - deterministic lexical hashing embedder. NOT semantic. Offline/test only.
"""
from __future__ import annotations

import hashlib
import math
import re
from typing import Protocol

_STOP = set("""a an the and or but if of to in on at for from by with about as is are was were be been being
do does did can could should would will may might must i me my we our you your it its this that these those
what when where who whom why how which there their they them he she his her not no so than then also
please tell according handbook employee employees zava""".split())


def _stem(w: str) -> str:
    for suf in ("ing", "edly", "ed", "ies", "es", "s", "ly"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def tokenize(text: str) -> list[str]:
    text = re.sub(r"['\u2019]s\b", "", text.lower())  # possessives: "company's" -> "company"
    return [_stem(w) for w in re.findall(r"[a-z0-9]+", text) if len(w) > 1 and w not in _STOP]


class Embedder(Protocol):
    name: str

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...
    def embed_query(self, text: str) -> list[float]: ...


class HashEmbedder:
    name = "hash-lexical-v1"
    dim = 2048

    def _vec(self, text: str) -> list[float]:
        toks = tokenize(text)
        feats = toks + [f"{a}_{b}" for a, b in zip(toks, toks[1:])]
        v = [0.0] * self.dim
        counts: dict[str, int] = {}
        for f in feats:
            counts[f] = counts.get(f, 0) + 1
        for f, c in counts.items():
            h = int.from_bytes(hashlib.blake2b(f.encode(), digest_size=8).digest(), "big")
            v[h % self.dim] += (1 if (h >> 63) & 1 else -1) * (1 + math.log(c))
        n = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / n for x in v]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vec(text)


class FastEmbedEmbedder:
    def __init__(self, model_name: str):
        from fastembed import TextEmbedding  # lazy: optional heavy dependency

        self.name = f"fastembed:{model_name}"
        self._model = TextEmbedding(model_name=model_name)

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [[float(x) for x in v] for v in self._model.embed(texts)]

    def embed_query(self, text: str) -> list[float]:
        return [float(x) for x in next(iter(self._model.query_embed(text)))]


def make_embedder(provider: str, fastembed_model: str) -> Embedder:
    if provider == "hash":
        return HashEmbedder()
    if provider == "fastembed":
        return FastEmbedEmbedder(fastembed_model)
    raise ValueError(f"Unknown embedding provider: {provider}")
