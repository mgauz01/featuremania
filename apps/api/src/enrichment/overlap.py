from __future__ import annotations

import json
import re

from src.enrichment.cache import fingerprint
from src.enrichment.pipeline import DEFAULT_JUDGMENT_MODEL
from src.otari.client import OtariClient
from src.otari.config import OtariConfig

OVERLAP_SCALE = (
    (0, "none"),
    (1, "weak theme"),
    (2, "related"),
    (3, "substantial overlap"),
    (4, "same work"),
)
_JSON_FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)
_overlap_cache: dict[str, dict] = {}


class OverlapPipeline:
    def __init__(
        self,
        otari_client: OtariClient,
        config: OtariConfig | None = None,
        cache: dict[str, dict] | None = None,
    ) -> None:
        self.otari_client = otari_client
        resolved = config if config is not None else getattr(otari_client, "config", None)
        self.config = resolved if isinstance(resolved, OtariConfig) else None
        self.cache = cache if cache is not None else _overlap_cache

    def judgment_model(self) -> str:
        if self.config is None:
            return DEFAULT_JUDGMENT_MODEL
        return self.config.judgment_model

    def build_prompt(self, issues: list[dict]) -> str:
        blocks = []
        for issue in sorted(issues, key=lambda row: str(row.get("issueKey") or "")):
            key = str(issue.get("issueKey") or "").strip()
            title = str(issue.get("title") or "").strip()
            summary = str(issue.get("summary") or "").strip()
            blocks.append(f"issueKey={key}\ntitle={title}\nsummary={summary}")
        labeled = "; ".join(f"{index} {label}" for index, label in OVERLAP_SCALE)
        return (
            "Score how much these GitHub issues overlap as the same work.\n"
            "Reply with JSON only, no markdown:\n"
            '{"overlap_index":0,"reason":"<why>","cited_issue_keys":["owner/repo#n"]}\n'
            f"Scale: {labeled}.\n"
            "Use only the issueKey values listed. Do not invent keys.\n"
            "Judge from title and summary only.\n\n"
            + "\n\n".join(blocks)
        )

    def score(self, issues: list[dict]) -> dict:
        prompt = self.build_prompt(issues)
        model = self.judgment_model()
        key = fingerprint(model, prompt)
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        raw = self.otari_client.complete(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            session_label="overlap",
        )
        parsed = parse_overlap(raw, {str(issue.get("issueKey") or "") for issue in issues})
        self.cache[key] = parsed
        return parsed


def parse_overlap(raw: str, allowed_keys: set[str]) -> dict:
    blob = (raw or "").strip()
    fenced = _JSON_FENCE.search(blob)
    if fenced:
        blob = fenced.group(1).strip()
    start = blob.find("{")
    end = blob.rfind("}")
    if start < 0 or end <= start:
        raise RuntimeError("Otari overlap did not return JSON")
    data = json.loads(blob[start : end + 1])
    if not isinstance(data, dict):
        raise RuntimeError("Otari overlap JSON was not an object")
    try:
        index = int(data.get("overlap_index"))
    except (TypeError, ValueError) as exc:
        raise RuntimeError("Otari overlap returned a non-integer index") from exc
    index = max(0, min(4, index))
    cited = data.get("cited_issue_keys") or []
    if not isinstance(cited, list):
        cited = []
    kept = [str(key) for key in cited if str(key) in allowed_keys]
    if index > 0 and not kept:
        raise RuntimeError("Otari overlap cited no provided issue keys")
    return {
        "overlap_index": index,
        "reason": str(data.get("reason") or "").strip(),
        "cited_issue_keys": kept,
    }
