from src.otari.client import OtariClient
from src.otari.config import OtariConfig
from src.scraper.github_graphql import fetch_viewer_login, list_accessible_repos

_GITHUB_FAIL = "GitHub is not reachable with this sign-in"
_OTARI_FAIL = "Otari is not configured or did not answer"
_PING_MODEL = "mzai:moonshotai/Kimi-K2.6"


def ping_otari() -> None:
    config = OtariConfig.from_env()
    client = OtariClient.from_config(config)
    client.complete(
        model=_PING_MODEL,
        messages=[{"role": "user", "content": "Reply with ok"}],
        session_label="preflight",
    )


def run_preflight(token: str) -> dict:
    github = "ok"
    github_error = None
    try:
        fetch_viewer_login(token)
    except Exception:
        github = "error"
        github_error = _GITHUB_FAIL

    otari = "ok"
    otari_error = None
    try:
        ping_otari()
    except Exception:
        otari = "error"
        otari_error = _OTARI_FAIL

    return {
        "github": github,
        "otari": otari,
        "github_error": github_error,
        "otari_error": otari_error,
        "ready": github == "ok" and otari == "ok",
    }


def list_repos(token: str) -> list[str]:
    return list_accessible_repos(token, limit=200)
