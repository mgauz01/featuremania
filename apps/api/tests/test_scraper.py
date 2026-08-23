from unittest.mock import MagicMock, patch

from sqlmodel import Session, select

from src.models.board import Board
from src.models.issue import Issue
from src.scraper.cron import get_engine, scrape_repo
from src.scraper.github_graphql import fetch_issues_graphql


def test_mcp_client_available():
    from src.scraper.mcp_client import MCPClient
    client = MCPClient()
    assert hasattr(client, 'list_issues')


def test_graphql_fallback_query():
    from src.scraper.github_graphql import ISSUES_QUERY
    assert "commits" in ISSUES_QUERY
    assert "comments" in ISSUES_QUERY
    assert "reactions" in ISSUES_QUERY
    assert "CROSS_REFERENCED_EVENT" in ISSUES_QUERY


def test_fetch_issues_graphql_maps_nullable_body():
    payload = {
        "data": {
            "repository": {
                "issues": {
                    "nodes": [
                        {
                            "number": 7,
                            "title": "Empty issue",
                            "body": None,
                            "state": "OPEN",
                            "comments": {"totalCount": 2},
                            "reactions": {"totalCount": 1},
                            "timelineItems": {
                                "nodes": [
                                    {"source": {"commits": {"totalCount": 4}, "state": "MERGED"}}
                                ]
                            },
                            "updatedAt": "2026-08-22T00:00:00Z",
                            "createdAt": "2026-08-20T00:00:00Z",
                        }
                    ],
                    "pageInfo": {"hasNextPage": False, "endCursor": None},
                }
            }
        }
    }
    response = MagicMock()
    response.json.return_value = payload
    client = MagicMock()
    client.__enter__.return_value = client
    client.post.return_value = response

    with patch("src.scraper.github_graphql.httpx.Client", return_value=client):
        issues = fetch_issues_graphql("mozilla-ai", "otari", token="test-token")

    assert issues == [
        {
            "repo": "mozilla-ai/otari",
            "number": 7,
            "title": "Empty issue",
            "body": None,
            "comments_count": 2,
            "reactions_count": 1,
            "subtasks_count": 0,
            "commits_on_closing_prs": 4,
            "last_activity_at": "2026-08-22T00:00:00Z",
            "status": "backlog",
            "score": 0.0,
            "created_at": "2026-08-20T00:00:00Z",
            "updated_at": "2026-08-22T00:00:00Z",
        }
    ]


def test_scrape_repo_falls_back_to_graphql():
    mapped = [
        {
            "repo": "mozilla-ai/otari",
            "number": 7,
            "title": "Empty issue",
            "body": None,
            "comments_count": 2,
            "reactions_count": 1,
            "subtasks_count": 0,
            "commits_on_closing_prs": 4,
            "last_activity_at": "2026-08-22T00:00:00Z",
            "status": "backlog",
            "score": 0.0,
            "created_at": "2026-08-20T00:00:00Z",
            "updated_at": "2026-08-22T00:00:00Z",
        }
    ]
    engine = get_engine("sqlite://")
    with Session(engine) as session:
        board = Board(name="Otari Board", repos=["mozilla-ai/otari"])
        session.add(board)
        session.commit()
        session.refresh(board)
        board_id = board.id

    with patch(
        "src.scraper.cron.fetch_issues_graphql_from_env",
        return_value=mapped,
    ) as fallback:
        issues = scrape_repo("mozilla-ai", "otari", board_id=board_id, engine=engine)

    fallback.assert_called_once_with("mozilla-ai", "otari")
    assert issues[0]["number"] == 7

    with Session(engine) as session:
        stored = session.exec(select(Issue)).one()
        assert stored.board_id == board_id
        assert stored.body is None
        assert stored.commits_on_closing_prs == 4
        first_score = stored.score
        stored.status = "in_progress"
        session.add(stored)
        session.commit()
        assert first_score > 0

    rescrape = [
        {
            **mapped[0],
            "title": "Empty issue (updated)",
            "comments_count": 3,
            "score": 0.0,
            "status": "backlog",
        }
    ]
    with patch(
        "src.scraper.cron.fetch_issues_graphql_from_env",
        return_value=rescrape,
    ):
        scrape_repo("mozilla-ai", "otari", board_id=board_id, engine=engine)

    with Session(engine) as session:
        stored = session.exec(select(Issue)).one()
        assert stored.title == "Empty issue (updated)"
        assert stored.comments_count == 3
        assert stored.score > first_score
        assert stored.status == "in_progress"
