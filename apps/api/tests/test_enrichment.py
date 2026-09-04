from unittest.mock import MagicMock

from src.enrichment.pipeline import ISSUE_TEXT_LIMIT, EnrichmentPipeline


def test_enrichment_pipeline():
    mock_client = MagicMock()
    mock_client.complete.return_value = (
        '{"summary": "Add a dark-mode setting.", "category": "enhancement", "worked_on": true}'
    )
    pipeline = EnrichmentPipeline(otari_client=mock_client)
    result = pipeline.enrich(issue={"title": "Add dark mode", "body": "Please add dark mode..."})
    assert "summary" in result
    assert "category" in result
    assert "worked_on" in result
    assert result["summary"] == "Add a dark-mode setting."
    assert result["category"] == "enhancement"
    assert result["worked_on"] is True
    assert result["route"] == "easy"
    assert mock_client.complete.call_count == 1


def test_enrichment_routes_hard_issues_to_specialized_models():
    mock_client = MagicMock()
    mock_client.complete.return_value = (
        '{"summary": "Summary", "category": "bugfix", "worked_on": true}'
    )
    mock_client.config = None
    pipeline = EnrichmentPipeline(otari_client=mock_client)
    result = pipeline.enrich(
        {
            "title": "Fix login",
            "body": "Users cannot sign in after the last deploy.",
            "commits_on_closing_prs": 4,
            "comments_count": 8,
        }
    )
    assert result["route"] == "hard"
    models = [call.kwargs["model"] for call in mock_client.complete.call_args_list]
    assert models == ["mzai:moonshotai/Kimi-K2.6"]
    assert mock_client.complete.call_count == 1
    assert mock_client.complete.call_args_list[0].kwargs["session_label"] == "enrichment"


def test_enrichment_parses_fenced_json():
    mock_client = MagicMock()
    mock_client.complete.return_value = (
        '```json\n{"summary": "Ship it.", "category": "chore", "worked_on": false}\n```'
    )
    pipeline = EnrichmentPipeline(otari_client=mock_client)
    result = pipeline.enrich({"title": "Release", "body": "Cut a tag."})
    assert result["summary"] == "Ship it."
    assert result["category"] == "chore"
    assert result["worked_on"] is False


def test_enrichment_truncates_long_issue_text():
    mock_client = MagicMock()
    mock_client.complete.return_value = (
        '{"summary": "Long issue.", "category": "docs", "worked_on": false}'
    )
    pipeline = EnrichmentPipeline(otari_client=mock_client)
    pipeline.enrich({"title": "Huge", "body": "x" * 20000})
    content = mock_client.complete.call_args.kwargs["messages"][0]["content"]
    assert "x" * (ISSUE_TEXT_LIMIT + 1) not in content
    assert len(content) < ISSUE_TEXT_LIMIT + 400
