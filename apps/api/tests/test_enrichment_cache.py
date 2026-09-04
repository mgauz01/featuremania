from unittest.mock import MagicMock, patch

import pytest

from src.enrichment.cache import fingerprint
from src.enrichment.pipeline import EnrichmentPipeline, recency_band
from src.live.load import load_board
from src.scraper.cron import get_engine

ISSUE = {
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

ENRICHED = {
    "summary": "Add the thing.",
    "category": "enhancement",
    "worked_on": True,
    "route": "easy",
    "score_reason": "No closing-PR commits and no comments, so the score stays low.",
}


@pytest.fixture(autouse=True)
def _isolate_load_log(tmp_path, monkeypatch):
    monkeypatch.setenv("LIVE_LOAD_LOG", str(tmp_path / "live-load.jsonl"))
    monkeypatch.setenv("OTARI_API_KEY", "gw-test")


def _pipeline() -> EnrichmentPipeline:
    return EnrichmentPipeline(otari_client=MagicMock())


def test_fingerprint_is_stable_for_an_unchanged_issue():
    pipeline = _pipeline()
    first = fingerprint("m", pipeline.build_prompt(ISSUE))
    second = fingerprint("m", pipeline.build_prompt(dict(ISSUE)))
    assert first == second


@pytest.mark.parametrize(
    "change",
    [
        {"title": "Different title"},
        {"body": "Different body"},
        {"commits_on_closing_prs": 3},
        {"subtasks_count": 2},
        {"comments_count": 4},
        {"last_activity_at": "2020-01-01T00:00:00Z"},
    ],
)
def test_fingerprint_changes_when_the_issue_changes(change):
    pipeline = _pipeline()
    before = fingerprint("m", pipeline.build_prompt(ISSUE))
    after = fingerprint("m", pipeline.build_prompt({**ISSUE, **change}))
    assert before != after


def test_fingerprint_changes_with_the_model():
    pipeline = _pipeline()
    prompt = pipeline.build_prompt(ISSUE)
    assert fingerprint("model-a", prompt) != fingerprint("model-b", prompt)


def test_prompt_omits_the_decaying_score_so_cached_reasons_cannot_go_stale():
    prompt = _pipeline().build_prompt({**ISSUE, "score": 0.56})
    assert "displayed_percent" not in prompt
    assert "raw_score" not in prompt
    assert "days_since_activity" not in prompt
    assert "do not quote a specific percentage" in prompt


def test_recency_band_is_coarse_enough_to_survive_a_few_days():
    assert recency_band(0) == recency_band(6)
    assert recency_band(10) == recency_band(29)
    assert recency_band(10) != recency_band(0)
    assert recency_band(400) == "over a year ago"


def test_second_load_of_an_unchanged_issue_makes_no_otari_call(tmp_path):
    engine = get_engine(f"sqlite:///{tmp_path / 'cache.db'}")
    enrich = MagicMock(return_value=ENRICHED)
    with (
        patch("src.live.load.fetch_issues_graphql", return_value=[ISSUE]),
        patch("src.live.load.EnrichmentPipeline.enrich", enrich),
        patch("src.live.load.OtariClient.from_config", return_value=MagicMock()),
    ):
        load_board("oauth-token", ["acme/app"], engine=engine)
        payload = load_board("oauth-token", ["acme/app"], engine=engine)

    assert enrich.call_count == 1
    assert payload["issues"][0]["summary"] == "Add the thing."
    assert payload["issues"][0]["category"] == "enhancement"
    assert payload["issues"][0]["score_reason"] == ENRICHED["score_reason"]
    assert "warning" not in payload


def test_changed_issue_is_re_enriched(tmp_path):
    engine = get_engine(f"sqlite:///{tmp_path / 'changed.db'}")
    enrich = MagicMock(return_value=ENRICHED)
    updated = {**ISSUE, "comments_count": 7, "title": "Real issue, now discussed"}
    with (
        patch("src.live.load.EnrichmentPipeline.enrich", enrich),
        patch("src.live.load.OtariClient.from_config", return_value=MagicMock()),
    ):
        with patch("src.live.load.fetch_issues_graphql", return_value=[ISSUE]):
            load_board("oauth-token", ["acme/app"], engine=engine)
        with patch("src.live.load.fetch_issues_graphql", return_value=[updated]):
            load_board("oauth-token", ["acme/app"], engine=engine)

    assert enrich.call_count == 2


def test_cache_hits_are_counted_but_not_billed_as_usage(tmp_path):
    from src.otari.usage import get_tracker, reset_tracker

    engine = get_engine(f"sqlite:///{tmp_path / 'usage.db'}")
    reset_tracker()
    with (
        patch("src.live.load.fetch_issues_graphql", return_value=[ISSUE]),
        patch("src.live.load.EnrichmentPipeline.enrich", MagicMock(return_value=ENRICHED)),
        patch("src.live.load.OtariClient.from_config", return_value=MagicMock()),
    ):
        load_board("oauth-token", ["acme/app"], engine=engine)
        load_board("oauth-token", ["acme/app"], engine=engine)

    assert len(get_tracker().events) == 1
