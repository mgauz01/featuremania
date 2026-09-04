from fastapi import Depends, FastAPI, HTTPException
import httpx
from pydantic import BaseModel, Field

from src.auth.bearer import github_bearer
from src.auth.github import router as auth_router
from src.enrichment.overlap import OverlapPipeline
from src.envload import load_repo_dotenv
from src.live.load import _otari_fail_detail, get_live_board, get_load_progress, load_board
from src.live.preflight import list_repos, run_preflight
from src.otari.client import OtariClient
from src.otari.config import OtariConfig
from src.otari.usage import get_tracker

load_repo_dotenv()

app = FastAPI()
app.include_router(auth_router, prefix="/auth")


class LoadBoardBody(BaseModel):
    repos: list[str] = Field(default_factory=list)


class OverlapIssueBody(BaseModel):
    issueKey: str
    title: str
    summary: str = ""


class OverlapBody(BaseModel):
    issues: list[OverlapIssueBody] = Field(default_factory=list)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/v1/usage")
def usage():
    tracker = get_tracker()
    events = list(tracker.events)
    try:
        config = OtariConfig.from_env()
    except RuntimeError:
        return {"events": events}
    try:
        remote = tracker.fetch_otari(base_url=config.base_url, api_key=config.api_key)
    except httpx.HTTPError:
        return {"events": events}
    return {"events": remote if remote else events}


@app.get("/v1/preflight")
def preflight(token: str = Depends(github_bearer)):
    return run_preflight(token)


@app.get("/v1/repos")
def repos(token: str = Depends(github_bearer)):
    return {"repos": list_repos(token)}


@app.post("/v1/boards/load")
def boards_load(body: LoadBoardBody, token: str = Depends(github_bearer)):
    return load_board(token, body.repos)


@app.get("/v1/boards/load/progress")
def boards_load_progress(_token: str = Depends(github_bearer)):
    return get_load_progress()


@app.get("/v1/boards/live")
def boards_live(_token: str = Depends(github_bearer)):
    return get_live_board()


@app.post("/v1/boards/overlap")
def boards_overlap(body: OverlapBody, _token: str = Depends(github_bearer)):
    if len(body.issues) < 2:
        raise HTTPException(status_code=400, detail="Select at least two issues")
    payload = [
        {
            "issueKey": issue.issueKey,
            "title": issue.title,
            "summary": issue.summary,
        }
        for issue in body.issues
    ]
    try:
        config = OtariConfig.from_env()
        pipeline = OverlapPipeline(OtariClient.from_config(config), config=config)
        return pipeline.score(payload)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=_otari_fail_detail(exc)) from exc
