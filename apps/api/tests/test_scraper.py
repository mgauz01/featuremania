from unittest.mock import MagicMock, patch

from sqlmodel import Session, select

from src.models.board import Board
from src.models.issue import Issue
from src.scraper.cron import get_engine, scrape_repo
from src.scraper.github_graphql import (
    _issue_status,
    fetch_issues_graphql,
    fetch_org_repos,
    list_accessible_repos,
)


def test_issue_status_reads_github_signals_not_a_local_workflow():
    merged = [{"state": "MERGED", "commits": {"totalCount": 18}}]
    assert _issue_status("CLOSED", 0, []) == "done"
    assert _issue_status("OPEN", 0, []) == "backlog"
    assert _issue_status("OPEN", 1, []) == "triaged"
    assert _issue_status("OPEN", 0, [], {"triaged"}) == "triaged"
    assert _issue_status("OPEN", 0, merged) == "in_progress"
    assert _issue_status("OPEN", 0, [], {"in progress"}) == "in_progress"
    assert (
        _issue_status("OPEN", 0, [{"state": "OPEN", "isDraft": False, "commits": {"totalCount": 2}}])
        == "in_review"
    )


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
    assert "CONNECTED_EVENT" in ISSUES_QUERY
    assert "closedByPullRequestsReferences" in ISSUES_QUERY
    assert "labels" in ISSUES_QUERY


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

    client.post.assert_called_once()
    headers = client.post.call_args.kwargs["headers"]
    assert headers["Authorization"] == "Bearer test-token"

    assert issues[0]["status"] == "in_progress"
    closed_payload = {
        "data": {
            "repository": {
                "issues": {
                    "nodes": [
                        {
                            "number": 8,
                            "title": "Closed issue",
                            "body": "done",
                            "state": "CLOSED",
                            "comments": {"totalCount": 0},
                            "reactions": {"totalCount": 0},
                            "timelineItems": {"nodes": []},
                            "updatedAt": "2026-08-22T00:00:00Z",
                            "createdAt": "2026-08-20T00:00:00Z",
                        }
                    ],
                    "pageInfo": {"hasNextPage": False, "endCursor": None},
                }
            }
        }
    }
    response.json.return_value = closed_payload
    with patch("src.scraper.github_graphql.httpx.Client", return_value=client):
        closed = fetch_issues_graphql("mozilla-ai", "otari", token="test-token")
    assert closed[0]["status"] == "done"

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
            "status": "in_progress",
            "score": 0.0,
            "created_at": "2026-08-20T00:00:00Z",
            "updated_at": "2026-08-22T00:00:00Z",
        }
    ]


def test_fetch_issues_graphql_uses_in_progress_label_when_no_pr():
    payload = {
        "data": {
            "repository": {
                "issues": {
                    "nodes": [
                        {
                            "number": 9,
                            "title": "WIP bug",
                            "body": "working",
                            "state": "OPEN",
                            "assignees": {"totalCount": 0},
                            "labels": {"nodes": [{"name": "in progress"}]},
                            "comments": {"totalCount": 0},
                            "reactions": {"totalCount": 0},
                            "timelineItems": {"nodes": []},
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
    assert issues[0]["status"] == "in_progress"


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


def test_scrape_repo_uses_oauth_token_without_github_token_env(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    mapped = [
        {
            "repo": "mozilla-ai/otari",
            "number": 8,
            "title": "OAuth scrape",
            "body": None,
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
    ]
    engine = get_engine("sqlite://")
    with Session(engine) as session:
        board = Board(name="Otari Board", repos=["mozilla-ai/otari"])
        session.add(board)
        session.commit()
        session.refresh(board)
        board_id = board.id

    with patch(
        "src.scraper.cron.fetch_issues_graphql",
        return_value=mapped,
    ) as graphql:
        issues = scrape_repo(
            "mozilla-ai",
            "otari",
            board_id=board_id,
            engine=engine,
            token="oauth-token",
        )

    graphql.assert_called_once()
    assert graphql.call_args.kwargs["token"] == "oauth-token"
    assert issues[0]["number"] == 8


def _graphql_client(payload: dict) -> MagicMock:
    response = MagicMock()
    response.json.return_value = payload
    client = MagicMock()
    client.__enter__.return_value = client
    client.post.return_value = response
    return client


def test_fetch_org_repos_lists_mozilla_ai_owned():
    payload = {
        "data": {
            "organization": {
                "repositories": {
                    "nodes": [
                        {"nameWithOwner": "mozilla-ai/otari"},
                        {"nameWithOwner": "mozilla-ai/any-llm"},
                    ],
                    "pageInfo": {"hasNextPage": False, "endCursor": None},
                }
            }
        }
    }
    client = _graphql_client(payload)
    with patch("src.scraper.github_graphql.httpx.Client", return_value=client):
        repos = fetch_org_repos("oauth-token", "mozilla-ai")

    assert repos == ["mozilla-ai/otari", "mozilla-ai/any-llm"]
    variables = client.post.call_args.kwargs["json"]["variables"]
    assert variables["login"] == "mozilla-ai"
    query = client.post.call_args.kwargs["json"]["query"]
    assert "organization(login" in query.replace(" ", "")


def test_fetch_org_repos_returns_empty_when_org_missing():
    graphql = _graphql_client({"data": {"organization": None}})
    rest_response = MagicMock()
    rest_response.status_code = 404
    rest = MagicMock()
    rest.__enter__.return_value = rest
    rest.get.return_value = rest_response
    with patch("src.scraper.github_graphql.httpx.Client", side_effect=[graphql, rest]):
        repos = fetch_org_repos("oauth-token", "no-such-org")
    assert repos == []


def test_fetch_org_repos_falls_back_to_public_rest_when_graphql_empty():
    graphql = _graphql_client({"data": {"organization": None}})
    rest_response = MagicMock()
    rest_response.status_code = 200
    rest_response.json.return_value = [{"full_name": "mozilla-ai/otari"}]
    rest = MagicMock()
    rest.__enter__.return_value = rest
    rest.get.return_value = rest_response
    with patch("src.scraper.github_graphql.httpx.Client", side_effect=[graphql, rest]):
        repos = fetch_org_repos("oauth-token", "mozilla-ai")
    assert repos == ["mozilla-ai/otari"]
    assert rest.get.call_args.kwargs["params"]["type"] == "public"


def test_list_accessible_repos_puts_org_owned_ahead_of_viewer(monkeypatch):
    monkeypatch.delenv("GITHUB_ORG_LOGINS", raising=False)
    with (
        patch(
            "src.scraper.github_graphql.fetch_org_repos",
            return_value=["mozilla-ai/otari", "mgauz01/featuremania"],
        ),
        patch(
            "src.scraper.github_graphql.fetch_viewer_repos",
            return_value=["mgauz01/featuremania", "mgauz01/dotfiles"],
        ),
    ):
        repos = list_accessible_repos("oauth-token", limit=100)

    assert repos[0] == "mozilla-ai/otari"
    assert repos == ["mozilla-ai/otari", "mgauz01/featuremania", "mgauz01/dotfiles"]


def test_list_accessible_repos_keeps_viewer_list_if_org_query_fails(monkeypatch):
    monkeypatch.setenv("GITHUB_ORG_LOGINS", "mozilla-ai")
    with (
        patch(
            "src.scraper.github_graphql.fetch_org_repos",
            side_effect=RuntimeError("org unavailable"),
        ),
        patch(
            "src.scraper.github_graphql.fetch_viewer_repos",
            return_value=["mgauz01/dotfiles"],
        ),
    ):
        repos = list_accessible_repos("oauth-token", limit=100)

    assert repos == ["mgauz01/dotfiles"]


def _issue_node(number: int, state: str) -> dict:
    return {
        "number": number,
        "title": f"Issue {number}",
        "body": "",
        "state": state,
        "comments": {"totalCount": 0},
        "reactions": {"totalCount": 0},
        "timelineItems": {"nodes": []},
        "updatedAt": "2026-08-22T00:00:00Z",
        "createdAt": "2026-08-20T00:00:00Z",
    }


def _issues_payload(nodes: list[dict], *, has_next: bool = False, cursor: str | None = "cursor-1") -> dict:
    return {
        "data": {
            "repository": {
                "issues": {
                    "nodes": nodes,
                    "pageInfo": {"hasNextPage": has_next, "endCursor": cursor if has_next else None},
                }
            }
        }
    }


def _issues_graphql_client(payloads: list[dict]) -> MagicMock:
    responses = []
    for payload in payloads:
        response = MagicMock()
        response.json.return_value = payload
        responses.append(response)
    client = MagicMock()
    client.__enter__.return_value = client
    client.post.side_effect = responses
    return client


def test_fetch_issues_graphql_live_open_then_closed_under_cap():
    open_nodes = [_issue_node(i, "OPEN") for i in range(1, 16)]
    closed_nodes = [_issue_node(i, "CLOSED") for i in range(100, 110)]
    client = _issues_graphql_client(
        [
            _issues_payload(open_nodes),
            _issues_payload(closed_nodes),
        ]
    )

    with patch("src.scraper.github_graphql.httpx.Client", return_value=client):
        issues = fetch_issues_graphql(
            "mozilla-ai",
            "otari",
            token="test-token",
            max_issues=20,
            fill_open_first=True,
        )

    assert [issue["number"] for issue in issues] == [*range(1, 16), *range(100, 105)]
    assert [issue["status"] for issue in issues] == (["backlog"] * 15) + (["done"] * 5)
    assert client.post.call_count == 2
    first_vars = client.post.call_args_list[0].kwargs["json"]["variables"]
    second_vars = client.post.call_args_list[1].kwargs["json"]["variables"]
    assert first_vars["states"] == ["OPEN"]
    assert second_vars["states"] == ["CLOSED"]
    first_query = client.post.call_args_list[0].kwargs["json"]["query"]
    second_query = client.post.call_args_list[1].kwargs["json"]["query"]
    assert "UPDATED_AT" in first_query
    assert "DESC" in first_query
    assert "UPDATED_AT" in second_query
    assert "orderBy" in first_query
    assert "commits" in first_query
    assert "comments" in first_query
    assert "reactions" in first_query
    assert "CROSS_REFERENCED_EVENT" in first_query


def test_fetch_issues_graphql_does_not_page_past_remaining():
    open_nodes = [_issue_node(i, "OPEN") for i in range(1, 21)]
    client = _issues_graphql_client([_issues_payload(open_nodes, has_next=True)])

    with patch("src.scraper.github_graphql.httpx.Client", return_value=client):
        issues = fetch_issues_graphql(
            "mozilla-ai",
            "otari",
            token="test-token",
            max_issues=20,
            fill_open_first=True,
        )

    assert len(issues) == 20
    assert all(issue["status"] == "backlog" for issue in issues)
    assert client.post.call_count == 1
    assert client.post.call_args.kwargs["json"]["variables"]["states"] == ["OPEN"]


def test_fetch_issues_graphql_from_env_keeps_mixed_states(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "env-token")
    client = _issues_graphql_client([_issues_payload([_issue_node(1, "OPEN")])])

    with patch("src.scraper.github_graphql.httpx.Client", return_value=client):
        from src.scraper.github_graphql import fetch_issues_graphql_from_env

        fetch_issues_graphql_from_env("mozilla-ai", "otari")

    body = client.post.call_args.kwargs["json"]
    assert body["variables"]["states"] == ["OPEN", "CLOSED"]
    assert "orderBy" not in body["query"]
