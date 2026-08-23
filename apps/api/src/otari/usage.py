from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import httpx


@dataclass(frozen=True)
class UsageEvent:
    model: str
    tokens: int
    cost: float
    feature: str
    guardrail_block: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


class UsageTracker:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def log(
        self,
        model: str,
        tokens: int,
        cost: float,
        feature: str,
        guardrail_block: str | None = None,
    ) -> dict[str, Any]:
        event = UsageEvent(
            model=model,
            tokens=tokens,
            cost=cost,
            feature=feature,
            guardrail_block=guardrail_block,
        ).as_dict()
        self.events.append(event)
        return event

    def fetch_otari(
        self,
        *,
        base_url: str,
        api_key: str,
        client: httpx.Client | None = None,
    ) -> list[dict[str, Any]]:
        http = client or httpx.Client(timeout=10.0)
        url = f"{base_url.rstrip('/')}/usage"
        response = http.get(url, headers={"Authorization": f"Bearer {api_key}"})
        response.raise_for_status()
        return _normalize_usage_payload(response.json())


_tracker: UsageTracker | None = None


def get_tracker() -> UsageTracker:
    global _tracker
    if _tracker is None:
        _tracker = UsageTracker()
    return _tracker


def reset_tracker() -> UsageTracker:
    global _tracker
    _tracker = UsageTracker()
    return _tracker


def _normalize_usage_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        raw = payload.get("events")
        if raw is None:
            raw = payload.get("data")
        if raw is None:
            raw = payload.get("usage")
        items = raw if isinstance(raw, list) else []
    else:
        items = []

    normalized: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        model = item.get("model")
        if not isinstance(model, str) or not model:
            continue
        tokens = _as_int(item.get("tokens", item.get("total_tokens", 0)))
        cost = _as_float(item.get("cost", 0))
        feature = item.get("feature")
        if not isinstance(feature, str) or not feature:
            feature = "unknown"
        block = item.get("guardrail_block", item.get("guardrail"))
        if block is not None and not isinstance(block, str):
            block = str(block)
        normalized.append(
            UsageEvent(
                model=model,
                tokens=tokens,
                cost=cost,
                feature=feature,
                guardrail_block=block,
            ).as_dict()
        )
    return normalized


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _as_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0
