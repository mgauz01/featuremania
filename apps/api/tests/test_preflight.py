from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from src.live.preflight import list_repos, ping_otari, run_preflight
from src.main import app


def test_preflight_ready_when_github_and_otari_answer():
    with (
        patch("src.live.preflight.fetch_viewer_login", return_value="octocat"),
        patch("src.live.preflight.ping_otari"),
    ):
        result = run_preflight("oauth-token")
    assert result["ready"] is True
    assert result["github"] == "ok"
    assert result["otari"] == "ok"
    assert result["github_error"] is None
    assert result["otari_error"] is None


def test_preflight_blocks_picker_when_otari_missing():
    with (
        patch("src.live.preflight.fetch_viewer_login", return_value="octocat"),
        patch("src.live.preflight.ping_otari", side_effect=RuntimeError("no key")),
    ):
        result = run_preflight("oauth-token")
    assert result["ready"] is False
    assert result["otari"] == "error"
    assert result["otari_error"]


def test_ping_otari_uses_configured_summary_model(monkeypatch):
    monkeypatch.setenv("OTARI_API_KEY", "gw-test")
    monkeypatch.setenv("OTARI_SUMMARY_MODEL", "mzai:deepseek-ai/DeepSeek-V4-Pro")
    mock_client = MagicMock()
    with patch("src.live.preflight.OtariClient.from_config", return_value=mock_client):
        ping_otari()
    kwargs = mock_client.complete.call_args.kwargs
    assert kwargs["model"] == "mzai:deepseek-ai/DeepSeek-V4-Pro"
    assert kwargs["session_label"] == "preflight"


def test_preflight_endpoint_returns_github_failure():
    client = TestClient(app)
    with (
        patch("src.live.preflight.fetch_viewer_login", side_effect=RuntimeError("401")),
        patch("src.live.preflight.ping_otari"),
    ):
        resp = client.get("/v1/preflight", headers={"Authorization": "Bearer gho_test"})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["ready"] is False
    assert payload["github"] == "error"


def test_list_repos_merges_mozilla_ai_org_catalog():
    with patch(
        "src.live.preflight.list_accessible_repos",
        return_value=["mozilla-ai/otari", "mgauz01/dotfiles"],
    ) as merged:
        repos = list_repos("oauth-token")
    merged.assert_called_once_with("oauth-token", limit=200)
    assert repos[0] == "mozilla-ai/otari"
