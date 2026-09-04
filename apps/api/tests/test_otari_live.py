"""Live HTTP checks against hosted Otari.

Default `uv run pytest` skips this module. To prove the API key and models:

    cd apps/api && RUN_OTARI_LIVE=1 uv run pytest -m live
"""

from __future__ import annotations

import json
import os
import re
from unittest.mock import patch

import pytest

from src.envload import load_repo_dotenv
from src.enrichment.pipeline import EnrichmentPipeline
from src.live.load import load_board
from src.live.preflight import ping_otari
from src.otari.client import OtariClient, otari_call_count, reset_otari_call_counts
from src.otari.config import OtariConfig
from src.scraper.cron import get_engine

load_repo_dotenv()

_DEEPSEEK_V4_PRO = "mzai:deepseek-ai/DeepSeek-V4-Pro"
_QWEN = "mzai:Qwen/Qwen3-32B"
_PING = [{"role": "user", "content": "Reply with ok"}]
_HTML = re.compile(r"</?[a-zA-Z][^>]*>")


def _live_enabled() -> bool:
    return os.getenv("RUN_OTARI_LIVE", "").strip().lower() in {"1", "true", "yes"}


def _api_key() -> str:
    return os.getenv("OTARI_API_KEY", "").strip()


pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        not _live_enabled(),
        reason="Set RUN_OTARI_LIVE=1 to hit api.otari.ai",
    ),
]


def _assert_no_secret(value: object) -> None:
    blob = str(value)
    key = _api_key()
    if key:
        assert key not in blob
    assert "gho_" not in blob
    assert not _HTML.search(blob)


def _status(exc: BaseException) -> int | None:
    status = getattr(exc, "status_code", None)
    return status if isinstance(status, int) else None


def _is_not_found(exc: BaseException) -> bool:
    message = str(exc).lower()
    status = _status(exc)
    return status == 404 or "404" in message or "does not exist" in message or "not found" in message


def _is_unauthorized(exc: BaseException) -> bool:
    message = str(exc).lower()
    status = _status(exc)
    return (
        status == 401
        or "401" in message
        or "authentication" in message
        or "unauthorized" in message
        or "invalid" in message and "key" in message
    )


@pytest.fixture
def live_config() -> OtariConfig:
    if not _api_key():
        pytest.skip("OTARI_API_KEY unset")
    return OtariConfig.from_env()


@pytest.fixture
def live_client(live_config: OtariConfig) -> OtariClient:
    return OtariClient.from_config(live_config)


def test_live_dummy_key_is_rejected():
    client = OtariClient(base_url="https://api.otari.ai/v1", api_key="tk_dummy_not_a_real_key")
    with pytest.raises(Exception) as caught:
        client.complete(model=_DEEPSEEK_V4_PRO, messages=_PING, session_label="live-test-auth")
    assert _is_unauthorized(caught.value), caught.value
    _assert_no_secret(caught.value)


def test_live_complete_deepseek_v4_pro_returns_nonempty(live_client: OtariClient):
    content = live_client.complete(
        model=_DEEPSEEK_V4_PRO,
        messages=_PING,
        session_label="live-test-deepseek-v4-pro",
    )
    assert content.strip()
    _assert_no_secret(content)


def test_live_preflight_ping_model_answers():
    if not _api_key():
        pytest.skip("OTARI_API_KEY unset")
    ping_otari()


def test_live_summary_model_from_env_completes(live_config: OtariConfig, live_client: OtariClient):
    content = live_client.complete(
        model=live_config.summary_model,
        messages=_PING,
        session_label="live-test-summary",
    )
    assert live_config.summary_model
    assert content.strip()
    _assert_no_secret(content)
    _assert_no_secret(live_config)


def test_live_qwen3_32b_complete_when_listed(live_client: OtariClient):
    try:
        content = live_client.complete(
            model=_QWEN,
            messages=_PING,
            session_label="live-test-qwen",
        )
    except Exception as exc:
        if _is_not_found(exc):
            pytest.skip(f"{_QWEN} is not in this Otari catalog")
        raise
    assert content.strip()
    _assert_no_secret(content)


def test_live_enrichment_json_includes_score_reason(live_client: OtariClient):
    pipeline = EnrichmentPipeline(live_client, config=live_client.config, job_label="live-test-enrich")
    result = pipeline.enrich(
        {
            "title": "server: login leak",
            "body": "Usernames can be enumerated on the login form.",
            "score": 0.56,
            "commits_on_closing_prs": 5,
            "subtasks_count": 0,
            "comments_count": 0,
            "last_activity_at": "2026-08-14T19:37:53Z",
        }
    )
    reason = result["score_reason"].strip()
    assert result["summary"].strip()
    assert reason, result
    assert len(reason) >= 20
    _assert_no_secret(json.dumps(result))


def test_live_board_load_enriches_once_then_serves_from_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("LIVE_LOAD_LOG", str(tmp_path / "live-load.jsonl"))
    engine = get_engine(f"sqlite:///{tmp_path / 'live-cache.db'}")
    scraped = {
        "repo": "acme/app",
        "number": 4242,
        "title": "server: login leak",
        "body": "Usernames can be enumerated on the login form.",
        "comments_count": 0,
        "reactions_count": 0,
        "subtasks_count": 0,
        "commits_on_closing_prs": 5,
        "last_activity_at": "2026-08-14T19:37:53Z",
        "status": "backlog",
        "score": 0.0,
        "created_at": "2026-08-10T00:00:00Z",
        "updated_at": "2026-08-14T19:37:53Z",
    }

    with patch("src.live.load.fetch_issues_graphql", return_value=[scraped]):
        first = load_board("oauth-token", ["acme/app"], engine=engine)
        first_calls = otari_call_count()
        reset_otari_call_counts()
        second = load_board("oauth-token", ["acme/app"], engine=engine)
        second_calls = otari_call_count()

    assert "warning" not in first, first.get("warning")
    assert first_calls >= 1
    assert second_calls == 0
    reason = (first["issues"][0]["score_reason"] or "").strip()
    assert reason
    assert second["issues"][0]["score_reason"] == reason
    assert second["issues"][0]["summary"] == first["issues"][0]["summary"]
    _assert_no_secret(json.dumps(second))


def test_live_enrichment_json_parses_as_object(live_client: OtariClient):
    raw = live_client.complete(
        model=_DEEPSEEK_V4_PRO,
        messages=[
            {
                "role": "user",
                "content": (
                    "Reply with JSON only, no markdown: "
                    '{"summary":"one line","category":"bugfix","worked_on":false,'
                    '"score_reason":"two sentences about the score."}'
                ),
            }
        ],
        session_label="live-test-json-shape",
    )
    blob = raw.strip()
    start = blob.find("{")
    end = blob.rfind("}")
    assert start >= 0 and end > start, raw[:200]
    data = json.loads(blob[start : end + 1])
    assert isinstance(data, dict)
    assert str(data.get("summary") or "").strip()
    assert str(data.get("score_reason") or "").strip()
    _assert_no_secret(raw)
