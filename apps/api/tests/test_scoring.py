from datetime import datetime, timezone

from src.scoring.engine import compute_score, days_since, score_issue


def test_score_calculation():
    score = compute_score(commits=10, subtasks=5, comments=20, days_since=5)
    assert score > 0
    # More commits should increase score
    assert compute_score(commits=20, subtasks=5, comments=20, days_since=5) > score


def test_score_decays_with_staleness():
    fresh = compute_score(commits=10, subtasks=5, comments=20, days_since=0)
    stale = compute_score(commits=10, subtasks=5, comments=20, days_since=30)
    assert stale == fresh * 0.5


def test_score_issue_uses_activity_timestamp():
    issue = {
        "commits_on_closing_prs": 10,
        "subtasks_count": 5,
        "comments_count": 20,
        "last_activity_at": "2026-07-24T00:00:00Z",
    }
    now = datetime(2026, 8, 23, tzinfo=timezone.utc)
    value = score_issue(issue, now=now)
    assert issue["score"] == value
    assert days_since("2026-07-24T00:00:00Z", now=now) == 30
    assert value == compute_score(10, 5, 20, 30)
