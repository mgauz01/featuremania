import os

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine, select

from src.models import Board, Issue
from src.scraper.github_graphql import fetch_issues_graphql, fetch_issues_graphql_from_env
from src.scraper.mcp_client import MCPClient
from src.scoring.engine import score_issue


def _sqlite_url() -> str:
    return os.getenv("DATABASE_URL", "sqlite:///featuremania.db")


def get_engine(url: str | None = None):
    engine = create_engine(url or _sqlite_url())

    if engine.dialect.name == "sqlite":

        @event.listens_for(engine, "connect")
        def _enable_foreign_keys(dbapi_connection, _connection_record):
            dbapi_connection.execute("PRAGMA foreign_keys=ON")

    SQLModel.metadata.create_all(engine)
    _ensure_sqlite_columns(engine)
    return engine


def _ensure_sqlite_columns(engine) -> None:
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as conn:
        rows = conn.exec_driver_sql("PRAGMA table_info(issue)").fetchall()
        names = {row[1] for row in rows}
        if names and "score_reason" not in names:
            conn.exec_driver_sql("ALTER TABLE issue ADD COLUMN score_reason VARCHAR")


ISSUE_FIELDS = {
    "repo",
    "number",
    "title",
    "body",
    "comments_count",
    "reactions_count",
    "subtasks_count",
    "commits_on_closing_prs",
    "last_activity_at",
    "status",
    "score",
    "created_at",
    "updated_at",
    "summary",
    "category",
    "score_reason",
}


def _issue_fields(payload: dict) -> dict:
    return {key: value for key, value in payload.items() if key in ISSUE_FIELDS}


def _upsert_issues(session: Session, board_id: int, issues: list[dict]) -> None:
    for payload in issues:
        fields = _issue_fields(payload)
        existing = session.exec(
            select(Issue).where(
                Issue.board_id == board_id,
                Issue.repo == fields["repo"],
                Issue.number == fields["number"],
            )
        ).first()
        if existing is None:
            session.add(Issue(board_id=board_id, **fields))
            continue
        new_status = fields.pop("status")
        for key, value in fields.items():
            setattr(existing, key, value)
        if new_status == "done" or existing.status in ("backlog", "done"):
            existing.status = new_status


def scrape_repo(
    owner: str,
    repo: str,
    board_id: int,
    engine=None,
    token: str | None = None,
    *,
    max_issues: int | None = None,
) -> list[dict]:
    try:
        issues = MCPClient().list_issues(owner, repo)
    except Exception:
        if token:
            issues = fetch_issues_graphql(owner, repo, token=token, max_issues=max_issues)
        else:
            issues = fetch_issues_graphql_from_env(owner, repo)

    for issue in issues:
        score_issue(issue)

    if engine is None:
        engine = get_engine()
    with Session(engine) as session:
        _upsert_issues(session, board_id, issues)
        session.commit()
    return issues


def scrape_all_repos(engine=None) -> None:
    if engine is None:
        engine = get_engine()
    with Session(engine) as session:
        boards = session.exec(select(Board)).all()
        jobs = [
            (board.id, repo_slug)
            for board in boards
            if board.id is not None
            for repo_slug in board.repos
        ]
    for board_id, repo_slug in jobs:
        owner, name = repo_slug.split("/", 1)
        scrape_repo(owner, name, board_id, engine=engine)


scheduler = AsyncIOScheduler()
scheduler.add_job(scrape_all_repos, "interval", minutes=15)
