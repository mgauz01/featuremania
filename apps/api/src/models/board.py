from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class Board(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    repos: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
