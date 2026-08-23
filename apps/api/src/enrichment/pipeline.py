from src.otari.client import OtariClient
from src.otari.config import OtariConfig

EASY_BODY_LIMIT = 800
DEFAULT_SUMMARY_MODEL = "mzai:deepseek-ai/DeepSeek-V3.2"
DEFAULT_CATEGORY_MODEL = "mzai:moonshotai/Kimi-K2.6"
DEFAULT_JUDGMENT_MODEL = "mzai:deepseek-ai/DeepSeek-V3.2"


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
        summary = self.otari_client.complete(
            model=models["summary"],
            messages=[
                {
                    "role": "user",
                    "content": f"Summarize this GitHub issue in one line:\n{text}",
                }
            ],
            user=self.job_label,
            session_label=self.job_label,
        )
        category = self.otari_client.complete(
            model=models["category"],
            messages=[
                {
                    "role": "user",
                    "content": (
                        "Classify this GitHub issue as one word: "
                        "bugfix, enhancement, docs, chore, or question.\n"
                        f"{text}"
                    ),
                }
            ],
            user=self.job_label,
            session_label=self.job_label,
        )
        worked = self.otari_client.complete(
            model=models["judgment"],
            messages=[
                {
                    "role": "user",
                    "content": (
                        "Has this GitHub issue been worked on? "
                        "Answer yes or no only.\n"
                        f"commits_on_closing_prs={issue.get('commits_on_closing_prs', 0)}\n"
                        f"comments_count={issue.get('comments_count', 0)}\n"
                        f"{text}"
                    ),
                }
            ],
            user=self.job_label,
            session_label=self.job_label,
        )
        return {
            "summary": summary.strip(),
            "category": category.strip().lower(),
            "worked_on": _parse_yes(worked),
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
    return f"{title}\n{body}".strip()


def _parse_yes(text: str) -> bool:
    first = text.strip().lower().split()[0] if text.strip() else ""
    return first in {"yes", "y", "true"}
