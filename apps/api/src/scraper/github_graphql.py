import os

import httpx

GITHUB_GRAPHQL_URL = "https://api.github.com/graphql"

ISSUES_QUERY = """
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 50, after: $cursor, states: [OPEN, CLOSED]) {
      nodes {
        number
        title
        body
        state
        comments { totalCount }
        reactions { totalCount }
        timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], first: 20) {
          nodes {
            ... on CrossReferencedEvent {
              source {
                ... on PullRequest {
                  commits { totalCount }
                  state
                }
              }
            }
          }
        }
        updatedAt
        createdAt
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
"""


def _commits_on_closing_prs(timeline_nodes: list[dict]) -> int:
    total = 0
    for node in timeline_nodes:
        source = (node or {}).get("source") or {}
        commits = source.get("commits") or {}
        total += int(commits.get("totalCount") or 0)
    return total


def _map_issue(node: dict, repo: str) -> dict:
    state = (node.get("state") or "OPEN").upper()
    return {
        "repo": repo,
        "number": node["number"],
        "title": node.get("title") or "",
        "body": node.get("body"),
        "comments_count": (node.get("comments") or {}).get("totalCount") or 0,
        "reactions_count": (node.get("reactions") or {}).get("totalCount") or 0,
        "subtasks_count": 0,
        "commits_on_closing_prs": _commits_on_closing_prs(
            (node.get("timelineItems") or {}).get("nodes") or []
        ),
        "last_activity_at": node.get("updatedAt") or "",
        "status": "done" if state == "CLOSED" else "backlog",
        "score": 0.0,
        "created_at": node.get("createdAt") or "",
        "updated_at": node.get("updatedAt") or "",
    }


def fetch_issues_graphql(owner: str, repo: str, token: str) -> list[dict]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    issues: list[dict] = []
    cursor: str | None = None
    repo_slug = f"{owner}/{repo}"

    with httpx.Client(timeout=30.0) as client:
        while True:
            response = client.post(
                GITHUB_GRAPHQL_URL,
                headers=headers,
                json={
                    "query": ISSUES_QUERY,
                    "variables": {"owner": owner, "name": repo, "cursor": cursor},
                },
            )
            response.raise_for_status()
            payload = response.json()
            if payload.get("errors"):
                raise RuntimeError(payload["errors"])
            repository = (payload.get("data") or {}).get("repository")
            if repository is None:
                raise RuntimeError(f"GitHub repository not found: {repo_slug}")
            connection = repository["issues"]
            issues.extend(_map_issue(node, repo_slug) for node in connection["nodes"])
            page_info = connection["pageInfo"]
            if not page_info.get("hasNextPage"):
                break
            cursor = page_info.get("endCursor")

    return issues


def fetch_issues_graphql_from_env(owner: str, repo: str) -> list[dict]:
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN is required for GraphQL fallback")
    return fetch_issues_graphql(owner, repo, token)
