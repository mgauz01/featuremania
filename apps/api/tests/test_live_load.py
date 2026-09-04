import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from src.live.load import get_live_board, get_load_progress, load_board
from src.otari.usage import get_tracker, reset_tracker
from src.scraper.cron import get_engine

MAPPED_ISSUE = {
    "repo": "acme/app",
    "number": 11,
    "title": "Real issue",
    "body": "Please add it",
    "comments_count": 0,
    "reactions_count": 0,
    "subtasks_count": 0,
    "commits_on_closing_prs": 0,
    "last_activity_at": "2026-08-22T00:00:00Z",
    "status": "backlog",
    "score": 0.0,
    "created_at": "2026-08-20T00:00:00Z",
    "updated_at": "2026-08-22T00:00:00Z",
}


@pytest.fixture(autouse=True)
def _isolate_load_log(tmp_path, monkeypatch):
    monkeypatch.setenv("LIVE_LOAD_LOG", str(tmp_path / "live-load.jsonl"))


def test_load_board_otari_failure_keeps_scored_issues(tmp_path, monkeypatch):
    monkeypatch.setenv("OTARI_API_KEY", "gw-test")
    engine = get_engine(f"sqlite:///{tmp_path / 'fail.db'}")
    with (
        patch("src.live.load.fetch_issues_graphql", return_value=[MAPPED_ISSUE]),
        patch(
            "src.live.load.EnrichmentPipeline.enrich",
            side_effect=RuntimeError(
                "Otari failed (PermissionDeniedError 403): <html> 403 Forbidden </html>"
            ),
        ),
        patch("src.live.load.OtariClient.from_config", return_value=MagicMock()),
    ):
        payload = load_board("oauth-token", ["acme/app"], engine=engine)
    assert payload["issues"][0]["title"] == "Real issue"
    assert payload["issues"][0]["summary"] == "Otari enrichment skipped."
    assert payload["issues"][0]["category"] == "unknown"
    assert "warning" in payload
    assert "html" not in payload["warning"].lower()
    assert "403" in payload["warning"]
    snapshot = get_live_board(engine=engine)
    assert snapshot["issues"][0]["title"] == "Real issue"


def test_load_board_otari_timeout_is_named_in_warning(tmp_path, monkeypatch):
    monkeypatch.setenv("OTARI_API_KEY", "gw-test")
    engine = get_engine(f"sqlite:///{tmp_path / 'timeout.db'}")
    with (
        patch("src.live.load.fetch_issues_graphql", return_value=[MAPPED_ISSUE]),
        patch(
            "src.live.load.EnrichmentPipeline.enrich",
            side_effect=TimeoutError("Request timed out."),
        ),
        patch("src.live.load.OtariClient.from_config", return_value=MagicMock()),
    ):
        payload = load_board("oauth-token", ["acme/app"], engine=engine)
    assert payload["issues"][0]["title"] == "Real issue"
    assert "TimeoutError" in payload["warning"]
    assert "timed out" in payload["warning"].lower()
    assert "not configured" not in payload["warning"].lower()


def test_load_board_redacts_api_key_from_otari_warning(tmp_path, monkeypatch):
    monkeypatch.setenv("OTARI_API_KEY", "tk_secret_for_test")
    engine = get_engine(f"sqlite:///{tmp_path / 'redact.db'}")
    with (
        patch("src.live.load.fetch_issues_graphql", return_value=[MAPPED_ISSUE]),
        patch(
            "src.live.load.EnrichmentPipeline.enrich",
            side_effect=RuntimeError("auth failed tk_secret_for_test"),
        ),
        patch("src.live.load.OtariClient.from_config", return_value=MagicMock()),
    ):
        payload = load_board("oauth-token", ["acme/app"], engine=engine)
    assert "tk_secret_for_test" not in payload["warning"]
    assert "[redacted]" in payload["warning"]


def test_load_board_writes_call_log(tmp_path, monkeypatch):
    monkeypatch.setenv("OTARI_API_KEY", "gw-test")
    log_file = tmp_path / "live-load.jsonl"
    monkeypatch.setenv("LIVE_LOAD_LOG", str(log_file))
    engine = get_engine(f"sqlite:///{tmp_path / 'log.db'}")
    with (
        patch("src.live.load.fetch_issues_graphql", return_value=[MAPPED_ISSUE]),
        patch(
            "src.live.load.EnrichmentPipeline.enrich",
            return_value={
                "summary": "Add the thing.",
                "category": "enhancement",
                "worked_on": True,
                "route": "easy",
            },
        ),
        patch("src.live.load.OtariClient.from_config", return_value=MagicMock()),
    ):
        load_board("oauth-token", ["acme/app"], engine=engine)
    events = [json.loads(line) for line in log_file.read_text(encoding="utf-8").splitlines()]
    done = events[-1]
    assert done["event"] == "load_done"
    assert done["repos"] == ["acme/app"]
    assert done["issues_scraped"] == 1
    assert done["issues_enriched"] == 1
    assert done["issues_fallback"] == 0


def test_load_board_success_returns_enriched_issues(tmp_path, monkeypatch):
    monkeypatch.setenv("OTARI_API_KEY", "gw-test")
    engine = get_engine(f"sqlite:///{tmp_path / 'ok.db'}")
    with (
        patch("src.live.load.fetch_issues_graphql", return_value=[MAPPED_ISSUE]),
        patch(
            "src.live.load.EnrichmentPipeline.enrich",
            return_value={
                "summary": "Add the thing.",
                "category": "enhancement",
                "worked_on": True,
                "route": "easy",
            },
        ),
        patch("src.live.load.OtariClient.from_config", return_value=MagicMock()),
    ):
        payload = load_board("oauth-token", ["acme/app"], engine=engine)
    assert payload["issues"][0]["title"] == "Real issue"
    assert payload["issues"][0]["summary"] == "Add the thing."
    assert payload["issues"][0]["category"] == "enhancement"
    snapshot = get_live_board(engine=engine)
    assert snapshot["issues"][0]["title"] == "Real issue"


def test_load_board_rejects_too_many_repos():
    with pytest.raises(HTTPException) as exc:
        load_board("oauth-token", [f"acme/r{i}" for i in range(16)])
    assert exc.value.status_code == 400


def test_load_board_maps_closed_issues_to_done(tmp_path, monkeypatch):
    monkeypatch.setenv("OTARI_API_KEY", "gw-test")
    closed = {**MAPPED_ISSUE, "number": 12, "title": "Shipped", "status": "done"}
    engine = get_engine(f"sqlite:///{tmp_path / 'closed.db'}")
    with (
        patch("src.live.load.fetch_issues_graphql", return_value=[closed]),
        patch(
            "src.live.load.EnrichmentPipeline.enrich",
            return_value={
                "summary": "Shipped.",
                "category": "enhancement",
                "worked_on": True,
                "route": "easy",
            },
        ),
        patch("src.live.load.OtariClient.from_config", return_value=MagicMock()),
    ):
        payload = load_board("oauth-token", ["acme/app"], engine=engine)
    assert payload["issues"][0]["status"] == "done"


def test_load_board_refresh_replaces_snapshot(tmp_path, monkeypatch):
    monkeypatch.setenv("OTARI_API_KEY", "gw-test")
    engine = get_engine(f"sqlite:///{tmp_path / 'refresh.db'}")
    first = {**MAPPED_ISSUE, "title": "First"}
    second = {**MAPPED_ISSUE, "number": 99, "title": "Second"}
    with (
        patch(
            "src.live.load.EnrichmentPipeline.enrich",
            return_value={
                "summary": "Note.",
                "category": "enhancement",
                "worked_on": True,
                "route": "easy",
            },
        ),
        patch("src.live.load.OtariClient.from_config", return_value=MagicMock()),
    ):
        with patch("src.live.load.fetch_issues_graphql", return_value=[first]):
            load_board("oauth-token", ["acme/app"], engine=engine)
        with patch("src.live.load.fetch_issues_graphql", return_value=[second]):
            payload = load_board("oauth-token", ["acme/app"], engine=engine)
    titles = [issue["title"] for issue in payload["issues"]]
    assert titles == ["Second"]


def test_load_board_logs_usage_on_success(tmp_path, monkeypatch):
    monkeypatch.setenv("OTARI_API_KEY", "gw-test")
    reset_tracker()
    engine = get_engine(f"sqlite:///{tmp_path / 'usage.db'}")
    with (
        patch("src.live.load.fetch_issues_graphql", return_value=[MAPPED_ISSUE]),
        patch(
            "src.live.load.EnrichmentPipeline.enrich",
            return_value={
                "summary": "Add the thing.",
                "category": "enhancement",
                "worked_on": True,
                "route": "easy",
            },
        ),
        patch("src.live.load.OtariClient.from_config", return_value=MagicMock()),
    ):
        load_board("oauth-token", ["acme/app"], engine=engine)
    assert len(get_tracker().events) >= 1


def test_load_board_caps_graphql_at_twenty_issues(tmp_path, monkeypatch):
    monkeypatch.delenv("LIVE_MAX_ISSUES", raising=False)
    monkeypatch.setenv("OTARI_API_KEY", "gw-test")
    engine = get_engine(f"sqlite:///{tmp_path / 'cap.db'}")
    captured: dict[str, object] = {}

    def fake_fetch(_owner, _name, _token, *, max_issues=None, fill_open_first=False):
        captured["max_issues"] = max_issues
        captured["fill_open_first"] = fill_open_first
        return [{**MAPPED_ISSUE, "number": i} for i in range(max_issues or 0)]

    with (
        patch("src.live.load.fetch_issues_graphql", side_effect=fake_fetch),
        patch(
            "src.live.load.EnrichmentPipeline.enrich",
            return_value={
                "summary": "Note.",
                "category": "enhancement",
                "worked_on": True,
                "route": "easy",
            },
        ),
        patch("src.live.load.OtariClient.from_config", return_value=MagicMock()),
    ):
        payload = load_board("oauth-token", ["acme/app"], engine=engine)

    assert captured["max_issues"] == 20
    assert captured["fill_open_first"] is True
    assert len(payload["issues"]) == 20
    assert payload["issues"][0]["commits_on_closing_prs"] == 0
    assert payload["issues"][0]["comments_count"] == 0
    assert payload["issues"][0]["subtasks_count"] == 0
    assert payload["issues"][0]["last_activity_at"] == "2026-08-22T00:00:00Z"


def test_load_board_prefers_open_issues_under_cap(tmp_path, monkeypatch):
    monkeypatch.delenv("LIVE_MAX_ISSUES", raising=False)
    monkeypatch.setenv("OTARI_API_KEY", "gw-test")
    engine = get_engine(f"sqlite:///{tmp_path / 'open-first.db'}")

    def fake_fetch(_owner, _name, _token, *, max_issues=None, fill_open_first=False):
        assert fill_open_first is True
        opens = [
            {**MAPPED_ISSUE, "number": i, "title": f"Open {i}", "status": "backlog"}
            for i in range(1, 16)
        ]
        closed = [
            {**MAPPED_ISSUE, "number": 100 + i, "title": f"Closed {i}", "status": "done"}
            for i in range(1, 11)
        ]
        return (opens + closed)[: max_issues or 0]

    with (
        patch("src.live.load.fetch_issues_graphql", side_effect=fake_fetch),
        patch(
            "src.live.load.EnrichmentPipeline.enrich",
            return_value={
                "summary": "Note.",
                "category": "enhancement",
                "worked_on": True,
                "route": "easy",
            },
        ),
        patch("src.live.load.OtariClient.from_config", return_value=MagicMock()),
    ):
        payload = load_board("oauth-token", ["acme/app"], engine=engine)

    statuses = [issue["status"] for issue in payload["issues"]]
    assert statuses == (["backlog"] * 15) + (["done"] * 5)
    assert payload["issues"][0]["title"] == "Open 1"
    assert payload["issues"][-1]["title"] == "Closed 5"


def test_load_progress_tracks_each_enrichment(tmp_path, monkeypatch):
    monkeypatch.setenv("OTARI_API_KEY", "gw-test")
    engine = get_engine(f"sqlite:///{tmp_path / 'progress.db'}")
    seen: list[dict] = []

    def fake_enrich(self, issue):
        del self
        seen.append(get_load_progress())
        return {
            "summary": issue["title"],
            "category": "enhancement",
            "worked_on": False,
            "route": "easy",
        }

    issues = [{**MAPPED_ISSUE, "number": 1}, {**MAPPED_ISSUE, "number": 2, "title": "Second"}]
    with (
        patch("src.live.load.fetch_issues_graphql", return_value=issues),
        patch("src.live.load.EnrichmentPipeline.enrich", fake_enrich),
        patch("src.live.load.OtariClient.from_config", return_value=MagicMock()),
    ):
        load_board("oauth-token", ["acme/app"], engine=engine)

    assert seen[0]["status"] == "running"
    assert seen[0]["current"] == 1
    assert seen[0]["total"] == 2
    assert "1 of 2" in seen[0]["detail"]
    assert get_load_progress()["status"] == "idle"
