from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from src.enrichment.overlap import OverlapPipeline, parse_overlap
from src.main import app


def test_parse_overlap_clamps_and_drops_hallucinated_keys():
    parsed = parse_overlap(
        '{"overlap_index": 9, "reason": "same login work", "cited_issue_keys": ["acme/app#1", "invented#9"]}',
        {"acme/app#1", "acme/app#2"},
    )
    assert parsed["overlap_index"] == 4
    assert parsed["cited_issue_keys"] == ["acme/app#1"]
    assert parsed["reason"] == "same login work"


def test_parse_overlap_invalid_object_is_runtime_error():
    try:
        parse_overlap("{overlap_index: 2}", {"acme/app#1"})
    except RuntimeError as exc:
        assert "did not return JSON" in str(exc)
    else:
        raise AssertionError("expected invalid JSON to fail as RuntimeError")


def test_parse_overlap_rejects_missing_citations_when_index_is_positive():
    try:
        parse_overlap(
            '{"overlap_index": 3, "reason": "maybe", "cited_issue_keys": ["invented#9"]}',
            {"acme/app#1", "acme/app#2"},
        )
    except RuntimeError as exc:
        assert "cited no provided" in str(exc)
    else:
        raise AssertionError("expected invalid citations to fail")


def test_overlap_prompt_sorts_keys_and_omits_body():
    mock_client = MagicMock()
    mock_client.complete.return_value = (
        '{"overlap_index": 4, "reason": "same work", "cited_issue_keys": ["acme/app#1", "acme/app#2"]}'
    )
    mock_client.config = None
    pipeline = OverlapPipeline(otari_client=mock_client, cache={})
    first = [
        {"issueKey": "acme/app#2", "title": "Signup", "summary": "B", "body": "secret body"},
        {"issueKey": "acme/app#1", "title": "Login", "summary": "A", "body": "secret body"},
    ]
    second = list(reversed(first))
    assert pipeline.score(first)["overlap_index"] == 4
    assert pipeline.score(second)["overlap_index"] == 4
    assert mock_client.complete.call_count == 1
    prompt = mock_client.complete.call_args.kwargs["messages"][0]["content"]
    assert prompt.index("acme/app#1") < prompt.index("acme/app#2")
    assert "secret body" not in prompt
    assert "body" not in prompt.lower() or "Judge from title and summary only" in prompt


def test_overlap_route_requires_two_issues_and_uses_otari():
    client = TestClient(app)
    assert client.post("/v1/boards/overlap", json={"issues": []}).status_code == 401
    with (
        patch("src.main.OtariConfig.from_env") as from_env,
        patch("src.main.OtariClient.from_config") as from_config,
        patch("src.main.OverlapPipeline.score", return_value={"overlap_index": 0, "reason": "none", "cited_issue_keys": []}),
    ):
        from_env.return_value = MagicMock()
        from_config.return_value = MagicMock()
        too_few = client.post(
            "/v1/boards/overlap",
            json={"issues": [{"issueKey": "acme/app#1", "title": "Login"}]},
            headers={"Authorization": "Bearer oauth-token"},
        )
        assert too_few.status_code == 400
        ok = client.post(
            "/v1/boards/overlap",
            json={
                "issues": [
                    {"issueKey": "acme/app#1", "title": "Login", "summary": "A"},
                    {"issueKey": "acme/app#2", "title": "Signup", "summary": "B"},
                ]
            },
            headers={"Authorization": "Bearer oauth-token"},
        )
    assert ok.status_code == 200
    assert ok.json()["overlap_index"] == 0


def test_overlap_route_maps_non_runtime_otari_errors_to_json_503():
    client = TestClient(app, raise_server_exceptions=False)
    with (
        patch("src.main.OtariConfig.from_env") as from_env,
        patch("src.main.OtariClient.from_config") as from_config,
        patch("src.main.OverlapPipeline.score", side_effect=ValueError("{overlap_index: 2}")),
    ):
        from_env.return_value = MagicMock()
        from_config.return_value = MagicMock()
        response = client.post(
            "/v1/boards/overlap",
            json={
                "issues": [
                    {"issueKey": "acme/app#1", "title": "Login"},
                    {"issueKey": "acme/app#2", "title": "Signup"},
                ]
            },
            headers={"Authorization": "Bearer oauth-token"},
        )
    assert response.status_code == 503
    assert response.headers["content-type"].startswith("application/json")
    detail = response.json()["detail"]
    assert isinstance(detail, str)
    assert "Otari" in detail
    assert "Internal Server Error" not in detail
