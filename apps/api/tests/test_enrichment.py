from unittest.mock import MagicMock

from src.enrichment.pipeline import EnrichmentPipeline


def test_enrichment_pipeline():
    mock_client = MagicMock()
    mock_client.complete.side_effect = [
        "Add a dark-mode setting.",
        "enhancement",
        "yes",
    ]
    pipeline = EnrichmentPipeline(otari_client=mock_client)
    result = pipeline.enrich(issue={"title": "Add dark mode", "body": "Please add dark mode..."})
    assert "summary" in result
    assert "category" in result
    assert "worked_on" in result
    assert result["summary"] == "Add a dark-mode setting."
    assert result["category"] == "enhancement"
    assert result["worked_on"] is True
    assert result["route"] == "easy"


def test_enrichment_routes_hard_issues_to_specialized_models():
    mock_client = MagicMock()
    mock_client.complete.side_effect = ["Summary", "bugfix", "yes"]
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
    assert models == [
        "mzai:deepseek-ai/DeepSeek-V3.2",
        "mzai:moonshotai/Kimi-K2.6",
        "mzai:deepseek-ai/DeepSeek-V3.2",
    ]
    assert mock_client.complete.call_args_list[0].kwargs["session_label"] == "enrichment"
