import sqlite3
from pathlib import Path
from shutil import copy2

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from src.models.board import Board
from src.models.issue import Issue
from src.models.score import Score
from src.scraper.cron import get_engine


_OLD_ISSUE_DDL = """
CREATE TABLE issue (
    id INTEGER PRIMARY KEY,
    board_id INTEGER,
    repo VARCHAR,
    number INTEGER,
    title VARCHAR,
    body VARCHAR,
    comments_count INTEGER,
    reactions_count INTEGER,
    subtasks_count INTEGER,
    commits_on_closing_prs INTEGER,
    last_activity_at VARCHAR,
    status VARCHAR,
    score FLOAT,
    created_at VARCHAR,
    updated_at VARCHAR,
    summary VARCHAR,
    category VARCHAR
)
"""


def _issue_columns(path: Path) -> set[str]:
    with sqlite3.connect(path) as conn:
        return {row[1] for row in conn.execute("PRAGMA table_info(issue)").fetchall()}



def test_board_model():
    board = Board(name="Otari Board", repos=["mozilla-ai/otari"])
    assert board.name == "Otari Board"
    assert len(board.repos) == 1


def test_models_persist_in_sqlite():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        board = Board(name="Otari Board", repos=["mozilla-ai/otari"])
        session.add(board)
        session.commit()
        session.refresh(board)

        issue = Issue(
            board_id=board.id,
            repo="mozilla-ai/otari",
            number=1,
            title="Add dark mode",
            body=None,
            comments_count=2,
            reactions_count=1,
            subtasks_count=0,
            commits_on_closing_prs=3,
            last_activity_at="2026-08-22T00:00:00Z",
            status="backlog",
            score=1.5,
            created_at="2026-08-20T00:00:00Z",
            updated_at="2026-08-22T00:00:00Z",
        )
        session.add(issue)
        session.commit()
        session.refresh(issue)

        score = Score(issue_id=issue.id, value=1.5, computed_at="2026-08-22T00:00:00Z")
        session.add(score)
        session.commit()

        stored_board = session.exec(select(Board)).one()
        stored_issue = session.exec(select(Issue)).one()
        stored_score = session.exec(select(Score)).one()

        assert stored_board.repos == ["mozilla-ai/otari"]
        assert stored_issue.board_id == stored_board.id
        assert stored_issue.title == "Add dark mode"
        assert stored_issue.body is None
        assert stored_issue.score_reason is None
        stored_issue.score_reason = "Five commits lift this score."
        session.add(stored_issue)
        session.commit()
        session.refresh(stored_issue)
        assert stored_issue.score_reason == "Five commits lift this score."
        assert stored_score.issue_id == stored_issue.id
        assert stored_score.value == 1.5


def test_get_engine_adds_score_reason_to_existing_sqlite(tmp_path):
    db = tmp_path / "old.db"
    with sqlite3.connect(db) as conn:
        conn.execute(_OLD_ISSUE_DDL)
        conn.commit()
    assert "score_reason" not in _issue_columns(db)

    get_engine(f"sqlite:///{db}")

    assert "score_reason" in _issue_columns(db)


def test_get_engine_migrates_local_featuremania_db_copy(tmp_path):
    src = Path(__file__).resolve().parents[1] / "featuremania.db"
    if not src.is_file():
        pytest.skip("no local apps/api/featuremania.db")
    dest = tmp_path / "featuremania.db"
    copy2(src, dest)
    get_engine(f"sqlite:///{dest}")
    assert "score_reason" in _issue_columns(dest)
