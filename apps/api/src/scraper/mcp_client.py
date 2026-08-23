import os


class MCPClient:
    """Primary scraper: GitHub MCP server via Otari."""

    def __init__(self):
        self.enabled = bool(os.getenv("GITHUB_MCP_URL"))

    def list_issues(self, owner: str, repo: str) -> list[dict]:
        if not self.enabled:
            raise RuntimeError("GitHub MCP server is unavailable")
        raise RuntimeError("GitHub MCP server is not wired yet")

    def get_pr_commits(self, owner: str, repo: str, pr_number: int) -> int:
        if not self.enabled:
            raise RuntimeError("GitHub MCP server is unavailable")
        raise RuntimeError("GitHub MCP server is not wired yet")
