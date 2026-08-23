from sqlmodel import Field, SQLModel


class Score(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    issue_id: int = Field(foreign_key="issue.id")
    value: float
    computed_at: str
