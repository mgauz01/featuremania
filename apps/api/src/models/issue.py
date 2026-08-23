from sqlmodel import Field, SQLModel


class Issue(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    board_id: int = Field(foreign_key="board.id")
    repo: str
    number: int
    title: str
    body: str | None = None
    comments_count: int
    reactions_count: int
    subtasks_count: int
    commits_on_closing_prs: int
    last_activity_at: str
    status: str  # backlog | triaged | in_progress | in_review | done
    score: float
    created_at: str
    updated_at: str
