import json
import re

from src.otari.client import OtariClient
from src.otari.config import OtariConfig
from src.scoring.engine import days_since

EASY_BODY_LIMIT = 800
ISSUE_TEXT_LIMIT = 2000
SCORE_REASON_LIMIT = 600
DEFAULT_SUMMARY_MODEL = "mzai:deepseek-ai/DeepSeek-V4-Pro"
DEFAULT_CATEGORY_MODEL = "mzai:deepseek-ai/DeepSeek-V4-Pro"
DEFAULT_JUDGMENT_MODEL = "mzai:deepseek-ai/DeepSeek-V4-Pro"
_CATEGORIES = {"bugfix", "enhancement", "docs", "chore", "question"}
_JSON_FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)
_SCORE_FORMULA = (
    "0.5*log1p(commits) + 0.3*log1p(subtasks) + 0.2*log1p(comments), "
    "times 0.5^(days/30) with a 30-day half-life"
)
# Coarse enough that an explanation stays true for days, so the cache holds.
_RECENCY_BANDS = (
    (7, "within the last week"),
    (30, "one to four weeks ago"),
    (90, "one to three months ago"),
    (365, "three to twelve months ago"),
)


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

    def build_prompt(self, issue: dict) -> str:
        """The exact user message enrich() sends for this issue.

        Public because the enrichment cache keys on it: hashing the real prompt
        means a cache entry can never drift from the request that produced it.
        """
        return (
            "Read this GitHub issue and the deterministic score facts. "
            "Reply with JSON only, no markdown:\n"
            '{"summary":"<one line>","category":"bugfix|enhancement|docs|chore|question",'
            '"worked_on":true or false,'
            '"score_reason":"<2-4 sentences explaining why this score is high or low>"}\n'
            "Do not invent commits, comments, subtasks, or activity that is not listed. "
            "Explain the score from the signals below; do not quote a specific percentage.\n\n"
            f"Score facts:\n{_score_facts(issue)}\n\n"
            f"Issue:\n{_issue_text(issue)}"
        )

    def model_for(self, issue: dict) -> str:
        return self._model_for_route(self.route(issue))

    def enrich(self, issue: dict) -> dict:
        route = self.route(issue)
        raw = self.otari_client.complete(
            model=self._model_for_route(route),
            messages=[{"role": "user", "content": self.build_prompt(issue)}],
            user=self.job_label,
            session_label=self.job_label,
        )
        parsed = _parse_enrichment(raw)
        return {
            "summary": parsed["summary"],
            "category": parsed["category"],
            "worked_on": parsed["worked_on"],
            "score_reason": parsed["score_reason"],
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

    def _model_for_route(self, route: str) -> str:
        models = self._models_for(route)
        return models["summary"] if route == "easy" else models["judgment"]

    def _model(self, name: str, default: str) -> str:
        if self.config is None:
            return default
        return getattr(self.config, name)


def recency_band(days: int) -> str:
    for limit, label in _RECENCY_BANDS:
        if days <= limit:
            return label
    return "over a year ago"


def _score_facts(issue: dict) -> str:
    """Score inputs for the prompt, stated so they do not move with the clock.

    The exact score and day count are omitted on purpose. Both drift as the
    30-day decay runs, which would make a cached explanation quote a number the
    board no longer shows, and would expire every cache entry daily. The UI
    already renders the precise arithmetic, so the model only has to explain
    the signals behind it.
    """
    last_activity = str(issue.get("last_activity_at") or "")
    return (
        f"formula={_SCORE_FORMULA}\n"
        f"commits_on_closing_prs={int(issue.get('commits_on_closing_prs') or 0)}\n"
        f"subtasks_count={int(issue.get('subtasks_count') or 0)}\n"
        f"comments_count={int(issue.get('comments_count') or 0)}\n"
        f"last_activity={recency_band(days_since(last_activity))}"
    )


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
        "score_reason": _parse_score_reason(data.get("score_reason")),
    }


def _parse_score_reason(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) > SCORE_REASON_LIMIT:
        return text[: SCORE_REASON_LIMIT - 1].rstrip() + "…"
    return text


def _parse_yes(value: object) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    first = text.split()[0] if text else ""
    return first in {"yes", "y", "true"}
