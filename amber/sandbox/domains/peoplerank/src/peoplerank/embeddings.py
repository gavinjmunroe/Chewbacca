"""
Embedding backends for PeopleRank v2.

Two interchangeable backends expose the same `embed_batch(texts)` interface:
  - TFIDFBackend   : sklearn TfidfVectorizer + cosine (local, no API)
  - OpenAIBackend  : OpenAI embeddings API with disk + memory caching

Callers pass a list of texts for one vector type (identity/personality/...) and
get back an (n, dim) numpy matrix. Empty texts map to zero vectors.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import List, Optional

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer


# ---------------------------------------------------------------------------
# TF-IDF backend (local, no API)
# ---------------------------------------------------------------------------


class TFIDFBackend:
    name = "tfidf"
    display = "tfidf (local, no API)"

    def __init__(self, max_features: int = 5000, min_df: int = 1):
        self.max_features = max_features
        self.min_df = min_df

    def embed_batch(self, texts: List[str]) -> np.ndarray:
        """Return a dense (n, dim) matrix. Empty texts -> zero rows."""
        n = len(texts)
        non_empty = [(i, t) for i, t in enumerate(texts) if t and t.strip()]
        if len(non_empty) < 2:
            # Not enough text to fit a vectorizer
            return np.zeros((n, 1))
        docs = [t for _, t in non_empty]
        vec = TfidfVectorizer(
            stop_words="english",
            max_features=self.max_features,
            min_df=self.min_df,
            sublinear_tf=True,
        )
        try:
            m = vec.fit_transform(docs).toarray()
        except ValueError:
            return np.zeros((n, 1))
        dim = m.shape[1]
        out = np.zeros((n, dim))
        for (orig_i, _), row in zip(non_empty, m):
            out[orig_i] = row
        return out


# ---------------------------------------------------------------------------
# OpenAI backend
# ---------------------------------------------------------------------------


# Dimensions and price per 1M tokens for pricing estimates.
# (Approx token = char/4 heuristic is used below.)
_MODEL_INFO = {
    "text-embedding-3-large": {"dim": 3072, "price_per_1m": 0.13},
    "text-embedding-3-small": {"dim": 1536, "price_per_1m": 0.02},
    "text-embedding-ada-002": {"dim": 1536, "price_per_1m": 0.10},
}

_DEFAULT_CACHE_DIR = Path(".embeddings_cache")


class OpenAIBackend:
    name = "openai"

    def __init__(
        self,
        model: str = "text-embedding-3-large",
        cache_dir: Optional[Path] = None,
    ):
        try:
            from openai import OpenAI
        except ImportError as e:
            raise RuntimeError(
                "openai package not installed. Install with: pip install openai"
            ) from e
        if not os.environ.get("OPENAI_API_KEY"):
            raise RuntimeError(
                "OPENAI_API_KEY not set in environment. Export it or put it in .env."
            )
        self.client = OpenAI()
        self.model = model
        self.cache: dict[str, np.ndarray] = {}  # in-memory: text -> vector
        self.cache_dir = Path(cache_dir) if cache_dir else _DEFAULT_CACHE_DIR
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        info = _MODEL_INFO.get(model, {"dim": 3072, "price_per_1m": 0.13})
        self._dim = info["dim"]
        self._price_per_1m = info["price_per_1m"]

        # Usage tracking
        self.api_calls = 0          # number of embeddings actually generated via API
        self.cache_hits = 0         # served from cache (memory or disk)
        self.total_chars = 0        # chars sent to API (for cost estimate)

    @property
    def display(self) -> str:
        return f"openai ({self.model})"

    @property
    def dim(self) -> int:
        return self._dim

    def _cache_path(self, text: str) -> Path:
        digest = hashlib.sha256(
            (self.model + "\x00" + text).encode("utf-8")
        ).hexdigest()
        return self.cache_dir / f"{digest}.json"

    def _load_from_disk(self, text: str) -> Optional[np.ndarray]:
        path = self._cache_path(text)
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text())
            vec = np.array(data["vector"], dtype=float)
            return vec
        except (json.JSONDecodeError, KeyError, OSError):
            return None

    def _save_to_disk(self, text: str, vec: np.ndarray) -> None:
        path = self._cache_path(text)
        payload = {"model": self.model, "vector": vec.tolist()}
        try:
            path.write_text(json.dumps(payload))
        except OSError:
            pass

    def embed_batch(self, texts: List[str]) -> np.ndarray:
        """
        Return (n, dim) matrix. Empty texts -> zero rows.
        Caches by text content (in-memory + disk).
        Batches up to 100 per API call.
        """
        n = len(texts)
        out = np.zeros((n, self._dim))

        # Bucket: indices to resolve
        to_embed: List[tuple[int, str]] = []
        for i, t in enumerate(texts):
            if not t or not t.strip():
                continue
            # memory cache
            if t in self.cache:
                out[i] = self.cache[t]
                self.cache_hits += 1
                continue
            # disk cache
            disk_vec = self._load_from_disk(t)
            if disk_vec is not None and disk_vec.shape[0] == self._dim:
                self.cache[t] = disk_vec
                out[i] = disk_vec
                self.cache_hits += 1
                continue
            to_embed.append((i, t))

        # Batch API calls, 100 at a time
        BATCH = 100
        for k in range(0, len(to_embed), BATCH):
            batch = to_embed[k : k + BATCH]
            batch_texts = [t for _, t in batch]
            try:
                resp = self.client.embeddings.create(
                    model=self.model,
                    input=batch_texts,
                )
            except Exception as e:
                raise RuntimeError(
                    f"OpenAI embedding call failed (model={self.model}, "
                    f"batch_size={len(batch_texts)}): {e}"
                ) from e

            for (orig_i, text), item in zip(batch, resp.data):
                vec = np.array(item.embedding, dtype=float)
                out[orig_i] = vec
                self.cache[text] = vec
                self._save_to_disk(text, vec)
                self.api_calls += 1
                self.total_chars += len(text)

        return out

    def cost_estimate(self) -> float:
        # ~4 chars per token heuristic
        tokens = self.total_chars / 4.0
        return (tokens / 1_000_000.0) * self._price_per_1m

    def usage_summary(self) -> str:
        return (
            f"OpenAI API usage: {self.api_calls} embeddings generated, "
            f"{self.cache_hits} cached. ~${self.cost_estimate():.4f} spent."
        )
