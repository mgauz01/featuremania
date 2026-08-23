import math
from datetime import datetime, timezone


def days_since(last_activity_at: str, now: datetime | None = None) -> int:
    if not last_activity_at:
        return 0
    parsed = datetime.fromisoformat(last_activity_at.replace("Z", "+00:00"))
    current = now or datetime.now(timezone.utc)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return max(0, (current - parsed).days)


def compute_score(commits: int, subtasks: int, comments: int, days_since: int) -> float:
    base = 0.5 * math.log1p(commits) + 0.3 * math.log1p(subtasks) + 0.2 * math.log1p(comments)
    decay = 0.5 ** (days_since / 30)  # half-life 30 days
    return base * decay


def score_issue(issue: dict, now: datetime | None = None) -> float:
    issue["score"] = compute_score(
        commits=int(issue.get("commits_on_closing_prs") or 0),
        subtasks=int(issue.get("subtasks_count") or 0),
        comments=int(issue.get("comments_count") or 0),
        days_since=days_since(issue.get("last_activity_at") or "", now=now),
    )
    return issue["score"]
