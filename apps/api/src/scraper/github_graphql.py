import os

import httpx

_graphql_calls = 0


def reset_graphql_call_count() -> None:
    global _graphql_calls
    _graphql_calls = 0


def graphql_call_count() -> int:
    return _graphql_calls

GITHUB_GRAPHQL_URL = "https://api.github.com/graphql"

VIEWER_LOGIN_QUERY = """
query {
  viewer {
    login
  }
}
"""

REPOS_QUERY = """
query($cursor: String) {
  viewer {
    repositories(
      first: 50
      after: $cursor
      ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
    ) {
      nodes {
        nameWithOwner
        isPrivate
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
"""

ORG_REPOS_QUERY = """
query($login: String!, $cursor: String) {
  organization(login: $login) {
    repositories(
      first: 50
      after: $cursor
      orderBy: {field: NAME, direction: ASC}
    ) {
      nodes {
        nameWithOwner
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
"""

DEFAULT_ORG_LOGIN = "mozilla-ai"
DEFAULT_ISSUE_STATES = ["OPEN", "CLOSED"]

_ISSUE_FIELDS = """
        number
        title
        body
        state
        assignees(first: 1) { totalCount }
        labels(first: 20) { nodes { name } }
        comments { totalCount }
        reactions { totalCount }
        closedByPullRequestsReferences(first: 10) {
          nodes {
            commits { totalCount }
            state
            isDraft
          }
        }
        timelineItems(itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT], first: 20) {
          nodes {
            ... on CrossReferencedEvent {
              source {
                ... on PullRequest {
                  commits { totalCount }
                  state
                  isDraft
                }
              }
            }
            ... on ConnectedEvent {
              subject {
                ... on PullRequest {
                  commits { totalCount }
                  state
                  isDraft
                }
              }
            }
          }
        }
        updatedAt
        createdAt
"""


def _issues_query(*, order_by_updated: bool) -> str:
    order = ", orderBy: { field: UPDATED_AT, direction: DESC }" if order_by_updated else ""
    return f"""
query($owner: String!, $name: String!, $cursor: String, $states: [IssueState!]) {{
  repository(owner: $owner, name: $name) {{
    issues(first: 50, after: $cursor, states: $states{order}) {{
      nodes {{{_ISSUE_FIELDS}
      }}
      pageInfo {{ hasNextPage endCursor }}
    }}
  }}
}}
"""


ISSUES_QUERY = _issues_query(order_by_updated=False)
ISSUES_QUERY_UPDATED = _issues_query(order_by_updated=True)


_IN_PROGRESS_LABELS = frozenset({"in progress", "in-progress", "wip", "working"})
_IN_REVIEW_LABELS = frozenset({"in review", "review", "awaiting review"})
_TRIAGED_LABELS = frozenset({"triaged", "accepted"})


def _as_pull_request(value: object) -> dict | None:
    if not isinstance(value, dict) or "commits" not in value:
        return None
    return value


def _linked_pull_requests(node: dict, timeline_nodes: list[dict]) -> list[dict]:
    """Pull requests GitHub has attached to the issue.

    Cross-references, the Development sidebar (ConnectedEvent), and PRs that
    used a closing keyword all count. A non-PR source has no commits field,
    so that key keeps issue-to-issue mentions out.
    """
    prs: list[dict] = []
    for item in timeline_nodes:
        event = item or {}
        found = _as_pull_request(event.get("source")) or _as_pull_request(event.get("subject"))
        if found is not None:
            prs.append(found)
    for item in (node.get("closedByPullRequestsReferences") or {}).get("nodes") or []:
        found = _as_pull_request(item)
        if found is not None:
            prs.append(found)
    return prs


def _label_names(node: dict) -> set[str]:
    names: set[str] = set()
    for item in (node.get("labels") or {}).get("nodes") or []:
        name = str((item or {}).get("name") or "").strip().lower()
        if name:
            names.add(name)
    return names


def _commits_on_closing_prs(node: dict, timeline_nodes: list[dict]) -> int:
    total = 0
    for source in _linked_pull_requests(node, timeline_nodes):
        commits = source.get("commits") or {}
        total += int(commits.get("totalCount") or 0)
    return total


def _issue_status(
    state: str,
    assignee_count: int,
    pull_requests: list[dict],
    labels: set[str] | None = None,
) -> str:
    """Map GitHub's signals onto the five board columns.

    GitHub itself only tracks open and closed, so the middle columns are
    inferred from the work attached to an issue: an open pull request awaiting
    review outranks a draft or already-merged one, which outranks a bare
    assignment. Labels fill the same gaps when a repo uses them instead of
    assignees. Without this every open issue lands in Backlog.
    """
    names = labels or set()
    if state == "CLOSED":
        return "done"
    for pull_request in pull_requests:
        ready = (pull_request.get("state") or "").upper() == "OPEN"
        if ready and not pull_request.get("isDraft"):
            return "in_review"
    if names & _IN_REVIEW_LABELS:
        return "in_review"
    if pull_requests or names & _IN_PROGRESS_LABELS:
        return "in_progress"
    if assignee_count > 0 or names & _TRIAGED_LABELS:
        return "triaged"
    return "backlog"


def _map_issue(node: dict, repo: str) -> dict:
    state = (node.get("state") or "OPEN").upper()
    timeline_nodes = (node.get("timelineItems") or {}).get("nodes") or []
    pull_requests = _linked_pull_requests(node, timeline_nodes)
    assignee_count = int((node.get("assignees") or {}).get("totalCount") or 0)
    return {
        "repo": repo,
        "number": node["number"],
        "title": node.get("title") or "",
        "body": node.get("body"),
        "comments_count": (node.get("comments") or {}).get("totalCount") or 0,
        "reactions_count": (node.get("reactions") or {}).get("totalCount") or 0,
        "subtasks_count": 0,
        "commits_on_closing_prs": _commits_on_closing_prs(node, timeline_nodes),
        "last_activity_at": node.get("updatedAt") or "",
        "status": _issue_status(state, assignee_count, pull_requests, _label_names(node)),
        "score": 0.0,
        "created_at": node.get("createdAt") or "",
        "updated_at": node.get("updatedAt") or "",
    }


def _github_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }


def _post_graphql(
    client: httpx.Client,
    token: str,
    query: str,
    variables: dict | None = None,
    *,
    raise_on_errors: bool = True,
) -> dict:
    global _graphql_calls
    _graphql_calls += 1
    response = client.post(
        GITHUB_GRAPHQL_URL,
        headers=_github_headers(token),
        json={"query": query, "variables": variables or {}},
    )
    response.raise_for_status()
    payload = response.json()
    if raise_on_errors and payload.get("errors"):
        raise RuntimeError(payload["errors"])
    return payload


def fetch_viewer_login(token: str) -> str:
    with httpx.Client(timeout=30.0) as client:
        payload = _post_graphql(client, token, VIEWER_LOGIN_QUERY)
    login = ((payload.get("data") or {}).get("viewer") or {}).get("login")
    if not isinstance(login, str) or not login:
        raise RuntimeError("GitHub viewer login missing")
    return login


def fetch_viewer_repos(token: str, *, limit: int = 100) -> list[str]:
    repos: list[str] = []
    cursor: str | None = None
    with httpx.Client(timeout=30.0) as client:
        while len(repos) < limit:
            payload = _post_graphql(
                client,
                token,
                REPOS_QUERY,
                {"cursor": cursor},
            )
            connection = (((payload.get("data") or {}).get("viewer") or {}).get("repositories")) or {}
            for node in connection.get("nodes") or []:
                name = (node or {}).get("nameWithOwner")
                if isinstance(name, str) and name:
                    repos.append(name)
                    if len(repos) >= limit:
                        break
            page_info = connection.get("pageInfo") or {}
            if not page_info.get("hasNextPage"):
                break
            cursor = page_info.get("endCursor")
    return repos


def org_logins_from_env() -> list[str]:
    raw = os.getenv("GITHUB_ORG_LOGINS", DEFAULT_ORG_LOGIN)
    return [part.strip() for part in raw.split(",") if part.strip()]


def fetch_org_repos(token: str, login: str, *, limit: int = 100) -> list[str]:
    repos: list[str] = []
    cursor: str | None = None
    try:
        with httpx.Client(timeout=30.0) as client:
            while len(repos) < limit:
                payload = _post_graphql(
                    client,
                    token,
                    ORG_REPOS_QUERY,
                    {"login": login, "cursor": cursor},
                    raise_on_errors=False,
                )
                organization = (payload.get("data") or {}).get("organization")
                if not organization:
                    break
                connection = organization.get("repositories") or {}
                for node in connection.get("nodes") or []:
                    name = (node or {}).get("nameWithOwner")
                    if isinstance(name, str) and name:
                        repos.append(name)
                        if len(repos) >= limit:
                            break
                page_info = connection.get("pageInfo") or {}
                if not page_info.get("hasNextPage"):
                    break
                cursor = page_info.get("endCursor")
    except (httpx.HTTPError, RuntimeError):
        pass
    if repos:
        return repos
    return fetch_org_repos_public_rest(login, limit=limit)


def fetch_org_repos_public_rest(login: str, *, limit: int = 100) -> list[str]:
    repos: list[str] = []
    page = 1
    try:
        with httpx.Client(timeout=30.0) as client:
            while len(repos) < limit:
                response = client.get(
                    f"https://api.github.com/orgs/{login}/repos",
                    params={
                        "type": "public",
                        "per_page": 100,
                        "page": page,
                        "sort": "full_name",
                    },
                    headers={"Accept": "application/vnd.github+json"},
                )
                if response.status_code == 404:
                    return repos
                response.raise_for_status()
                batch = response.json()
                if not isinstance(batch, list) or not batch:
                    break
                for item in batch:
                    full_name = (item or {}).get("full_name")
                    if isinstance(full_name, str) and full_name:
                        repos.append(full_name)
                        if len(repos) >= limit:
                            return repos
                if len(batch) < 100:
                    break
                page += 1
    except httpx.HTTPError:
        return repos
    return repos


def merge_repo_names(*groups: list[str], limit: int = 100) -> list[str]:
    seen: set[str] = set()
    merged: list[str] = []
    for group in groups:
        for name in group:
            if name in seen:
                continue
            seen.add(name)
            merged.append(name)
            if len(merged) >= limit:
                return merged
    return merged


def list_accessible_repos(token: str, *, limit: int = 200) -> list[str]:
    per_source = min(100, limit)
    org_repos: list[str] = []
    for login in org_logins_from_env():
        try:
            org_repos.extend(fetch_org_repos(token, login, limit=per_source))
        except (httpx.HTTPError, RuntimeError):
            continue
    viewer_repos = fetch_viewer_repos(token, limit=per_source)
    return merge_repo_names(org_repos, viewer_repos, limit=limit)


def fetch_issues_graphql(
    owner: str,
    repo: str,
    token: str,
    *,
    max_issues: int | None = None,
    states: list[str] | None = None,
    fill_open_first: bool = False,
) -> list[dict]:
    repo_slug = f"{owner}/{repo}"
    with httpx.Client(timeout=30.0) as client:
        if fill_open_first:
            open_issues = _fetch_issues_pass(
                client,
                owner,
                repo,
                token,
                repo_slug=repo_slug,
                states=["OPEN"],
                max_issues=max_issues,
                order_by_updated=True,
            )
            remaining = None if max_issues is None else max(0, max_issues - len(open_issues))
            closed_issues = _fetch_issues_pass(
                client,
                owner,
                repo,
                token,
                repo_slug=repo_slug,
                states=["CLOSED"],
                max_issues=remaining,
                order_by_updated=True,
            )
            return open_issues + closed_issues
        return _fetch_issues_pass(
            client,
            owner,
            repo,
            token,
            repo_slug=repo_slug,
            states=states or list(DEFAULT_ISSUE_STATES),
            max_issues=max_issues,
            order_by_updated=False,
        )


def _fetch_issues_pass(
    client: httpx.Client,
    owner: str,
    repo: str,
    token: str,
    *,
    repo_slug: str,
    states: list[str],
    max_issues: int | None,
    order_by_updated: bool,
) -> list[dict]:
    if max_issues is not None and max_issues <= 0:
        return []

    issues: list[dict] = []
    cursor: str | None = None
    query = ISSUES_QUERY_UPDATED if order_by_updated else ISSUES_QUERY

    while True:
        if max_issues is not None and len(issues) >= max_issues:
            break
        payload = _post_graphql(
            client,
            token,
            query,
            {"owner": owner, "name": repo, "cursor": cursor, "states": states},
        )
        repository = (payload.get("data") or {}).get("repository")
        if repository is None:
            raise RuntimeError(f"GitHub repository not found: {repo_slug}")
        connection = repository["issues"]
        for node in connection["nodes"]:
            issues.append(_map_issue(node, repo_slug))
            if max_issues is not None and len(issues) >= max_issues:
                break
        page_info = connection["pageInfo"]
        if max_issues is not None and len(issues) >= max_issues:
            break
        if not page_info.get("hasNextPage"):
            break
        cursor = page_info.get("endCursor")

    return issues


def fetch_issues_graphql_from_env(owner: str, repo: str) -> list[dict]:
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN is required for GraphQL fallback")
    return fetch_issues_graphql(owner, repo, token)
