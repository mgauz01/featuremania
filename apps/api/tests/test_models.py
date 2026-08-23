from sqlmodel import Session, SQLModel, create_engine, select

from src.models.board import Board
from src.models.issue import Issue
from src.models.score import Score


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
        assert stored_score.issue_id == stored_issue.id
        assert stored_score.value == 1.5
