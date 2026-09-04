from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from sqlmodel import Session

from src.models import EnrichmentCache


def fingerprint(model: str, prompt: str) -> str:
    """Content address for one enrichment.

    Hashes the model together with the exact prompt that would be sent, so any
    change to the issue, the score signals, or the prompt wording produces a
    new key and re-enriches, while an unchanged issue reuses the stored answer.
    """
    return hashlib.sha256(f"{model}\n{prompt}".encode("utf-8")).hexdigest()


def read_enrichment(session: Session, key: str) -> dict | None:
    row = session.get(EnrichmentCache, key)
    if row is None:
        return None
    return {
        "summary": row.summary,
        "category": row.category,
        "score_reason": row.score_reason or "",
    }


def write_enrichment(session: Session, key: str, *, model: str, enriched: dict) -> None:
    session.merge(
        EnrichmentCache(
            fingerprint=key,
            otari_model=model,
            summary=enriched["summary"],
            category=enriched["category"],
            score_reason=enriched.get("score_reason") or None,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
    )
