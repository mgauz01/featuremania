from sqlmodel import Field, SQLModel


class EnrichmentCache(SQLModel, table=True):
    """One stored Otari enrichment, addressed by the content it was derived from.

    Lives outside the board so it survives the delete-and-reinsert that every
    board load performs on the issue rows.
    """

    fingerprint: str = Field(primary_key=True)
    otari_model: str
    summary: str
    category: str
    score_reason: str | None = None
    created_at: str
