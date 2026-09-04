import json
import re

from src.otari.client import OtariClient
from src.otari.config import OtariConfig

EASY_BODY_LIMIT = 800
ISSUE_TEXT_LIMIT = 2000
DEFAULT_SUMMARY_MODEL = "mzai:moonshotai/Kimi-K2.6"
DEFAULT_CATEGORY_MODEL = "mzai:moonshotai/Kimi-K2.6"
DEFAULT_JUDGMENT_MODEL = "mzai:moonshotai/Kimi-K2.6"
_CATEGORIES = {"bugfix", "enhancement", "docs", "chore", "question"}
_JSON_FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)


class EnrichmentPipeline:
    def __init__(
        self,
        otari_client: OtariClient,
        config: OtariConfig | None = None,
        job_label: str = "enrichment",
    ):
        self.otari_client = otari_client
        resolved = config if config is not None else getattr(otari_client, "config", None)
        self.config = resolved if isinstance(resolved, OtariConfig) else None
        self.job_label = job_label

    def enrich(self, issue: dict) -> dict:
        route = self.route(issue)
        models = self._models_for(route)
        text = _issue_text(issue)
        model = models["summary"] if route == "easy" else models["judgment"]
        raw = self.otari_client.complete(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": (
                        "Read this GitHub issue. Reply with JSON only, no markdown:\n"
                        '{"summary":"<one line>","category":"bugfix|enhancement|docs|chore|question",'
                        '"worked_on":true or false}\n\n'
                        f"Issue:\n{text}"
                    ),
                }
            ],
            user=self.job_label,
            session_label=self.job_label,
        )
        parsed = _parse_enrichment(raw)
        return {
            "summary": parsed["summary"],
            "category": parsed["category"],
            "worked_on": parsed["worked_on"],
            "route": route,
        }

    def route(self, issue: dict) -> str:
        body = issue.get("body") or ""
        commits = int(issue.get("commits_on_closing_prs") or 0)
        comments = int(issue.get("comments_count") or 0)
        if commits > 0 or comments >= 5 or len(body) > EASY_BODY_LIMIT:
            return "hard"
        return "easy"

    def _models_for(self, route: str) -> dict[str, str]:
        cheap = self._model("summary_model", DEFAULT_SUMMARY_MODEL)
        if route == "easy":
            return {"summary": cheap, "category": cheap, "judgment": cheap}
        return {
            "summary": cheap,
            "category": self._model("category_model", DEFAULT_CATEGORY_MODEL),
            "judgment": self._model("judgment_model", DEFAULT_JUDGMENT_MODEL),
        }

    def _model(self, name: str, default: str) -> str:
        if self.config is None:
            return default
        return getattr(self.config, name)


def _issue_text(issue: dict) -> str:
    title = issue.get("title") or ""
    body = issue.get("body") or ""
    text = f"{title}\n{body}".strip()
    if len(text) <= ISSUE_TEXT_LIMIT:
        return text
    return text[:ISSUE_TEXT_LIMIT]


def _parse_enrichment(raw: str) -> dict:
    blob = (raw or "").strip()
    fenced = _JSON_FENCE.search(blob)
    if fenced:
        blob = fenced.group(1).strip()
    start = blob.find("{")
    end = blob.rfind("}")
    if start < 0 or end <= start:
        raise RuntimeError("Otari enrichment did not return JSON")
    data = json.loads(blob[start : end + 1])
    if not isinstance(data, dict):
        raise RuntimeError("Otari enrichment JSON was not an object")
    summary = str(data.get("summary") or "").strip()
    if not summary:
        raise RuntimeError("Otari enrichment returned empty summary")
    category = str(data.get("category") or "").strip().lower()
    if category not in _CATEGORIES:
        category = "unknown"
    return {
        "summary": summary,
        "category": category,
        "worked_on": _parse_yes(data.get("worked_on")),
    }


def _parse_yes(value: object) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    first = text.split()[0] if text else ""
    return first in {"yes", "y", "true"}
