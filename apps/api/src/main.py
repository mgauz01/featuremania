from fastapi import FastAPI
import httpx

from src.auth.github import router as auth_router
from src.otari.config import OtariConfig
from src.otari.usage import get_tracker

app = FastAPI()
app.include_router(auth_router, prefix="/auth")


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
