"""In-memory session store for GitHub OAuth sessions."""

import secrets

_sessions: dict[str, dict] = {}


def create_session(user_id: int | str | None) -> str:
    token = secrets.token_urlsafe(32)
    _sessions[token] = {"user_id": user_id}
    return token


def get_session(token: str) -> dict | None:
    return _sessions.get(token)


def delete_session(token: str) -> None:
    _sessions.pop(token, None)
