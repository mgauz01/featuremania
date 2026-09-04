from __future__ import annotations

import os
import re
import threading
import time

from fastapi import HTTPException
from sqlmodel import Session, select

from src.enrichment.cache import fingerprint, read_enrichment, write_enrichment
from src.enrichment.pipeline import EnrichmentPipeline
from src.live.loadlog import write_load_event
from src.models import Board, Issue
from src.otari.client import (
    OtariClient,
    otari_call_count,
    otari_retry_count,
    reset_otari_call_counts,
)
from src.otari.config import OtariConfig
from src.otari.usage import get_tracker
from src.scraper.cron import _issue_fields, get_engine
from src.scraper.github_graphql import (
    fetch_issues_graphql,
    graphql_call_count,
    reset_graphql_call_count,
)
from src.scoring.engine import score_issue

MAX_REPOS = 15
MAX_ISSUES_HARD = 200
DEFAULT_MAX_ISSUES = 20
LIVE_BOARD_NAME = "Live board"
FALLBACK_SUMMARY = "Otari enrichment skipped."
FALLBACK_CATEGORY = "unknown"
_HTML_MARK = re.compile(r"</?[a-zA-Z][^>]*>")

_progress_lock = threading.Lock()
_progress: dict[str, int | str] = {
    "status": "idle",
    "current": 0,
    "total": 0,
    "detail": "",
}


def max_issues() -> int:
    raw = os.getenv("LIVE_MAX_ISSUES", str(DEFAULT_MAX_ISSUES))
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_MAX_ISSUES
    return max(1, min(value, MAX_ISSUES_HARD))


def get_load_progress() -> dict[str, int | str]:
    with _progress_lock:
        return dict(_progress)


def _set_progress(*, status: str, current: int, total: int, detail: str) -> None:
    with _progress_lock:
        _progress["status"] = status
        _progress["current"] = current
        _progress["total"] = total
        _progress["detail"] = detail


def _split_repo(slug: str) -> tuple[str, str]:
    if slug.count("/") != 1:
        raise HTTPException(status_code=400, detail=f"Invalid repository: {slug}")
    owner, name = slug.split("/", 1)
    if not owner or not name:
        raise HTTPException(status_code=400, detail=f"Invalid repository: {slug}")
    return owner, name


def _serialize_issue(issue: Issue) -> dict:
    return {
        "id": issue.id,
        "number": issue.number,
        "title": issue.title,
        "score": issue.score,
        "repo": issue.repo,
        "summary": issue.summary,
        "category": issue.category,
        "status": issue.status,
        "last_activity_at": issue.last_activity_at,
        "commits_on_closing_prs": issue.commits_on_closing_prs,
        "subtasks_count": issue.subtasks_count,
        "comments_count": issue.comments_count,
        "score_reason": issue.score_reason,
    }


def _log_enrichment(model: str) -> None:
    get_tracker().log(model=model, tokens=0, cost=0.0, feature="enrich")


def _otari_fail_detail(exc: BaseException) -> str:
    message = str(exc).replace("\n", " ").strip()
    key = os.getenv("OTARI_API_KEY", "").strip()
    if key and key in message:
        message = message.replace(key, "[redacted]")
    lowered = message.lower()
    status = getattr(exc, "status_code", None)
    if "<html" in lowered or "<!doctype" in lowered or _HTML_MARK.search(message):
        if status == 403 or "403" in message:
            message = (
                "Otari gateway returned HTTP 403 Forbidden. "
                "This is usually a temporary gateway block, not a GitHub scrape failure."
            )
        else:
            message = "Otari gateway returned an HTML error page."
    if len(message) > 240:
        message = message[:237] + "..."
    kind = type(exc).__name__
    suffix = kind
    if isinstance(status, int):
        suffix += f" {status}"
    if message:
        return f"Otari failed ({suffix}): {message}"
    return f"Otari failed ({suffix})"


def load_board(token: str, repos: list[str], *, engine=None) -> dict:
    if len(repos) > MAX_REPOS:
        raise HTTPException(status_code=400, detail=f"Pick at most {MAX_REPOS} repositories")
    if not repos:
        raise HTTPException(status_code=400, detail="Pick at least one repository")

    issue_cap = max_issues()
    reset_graphql_call_count()
    reset_otari_call_counts()
    started = time.perf_counter()
    _set_progress(status="running", current=0, total=0, detail="Scraping issues…")
    remaining = issue_cap
    scraped: list[dict] = []
    try:
        scrape_started = time.perf_counter()
        for slug in repos:
            if remaining <= 0:
                break
            owner, name = _split_repo(slug)
            batch = fetch_issues_graphql(
                owner, name, token, max_issues=remaining, fill_open_first=True
            )
            remaining -= len(batch)
            scraped.extend(batch)
        scrape_s = time.perf_counter() - scrape_started

        try:
            config = OtariConfig.from_env()
            pipeline = EnrichmentPipeline(OtariClient.from_config(config), config=config)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=_otari_fail_detail(exc)) from exc

        db = engine or get_engine()
        prepared: list[dict] = []
        warnings: list[str] = []
        total = len(scraped)
        enriched_ok = 0
        fallbacks = 0
        cache_hits = 0
        enrich_started = time.perf_counter()
        with Session(db) as cache_session:
            for index, issue in enumerate(scraped, start=1):
                _set_progress(
                    status="running",
                    current=index,
                    total=total,
                    detail=f"Enriching {index} of {total}…",
                )
                score_issue(issue)
                try:
                    model = pipeline.model_for(issue)
                    key = fingerprint(model, pipeline.build_prompt(issue))
                    enriched = read_enrichment(cache_session, key)
                    if enriched is None:
                        enriched = pipeline.enrich(issue)
                        write_enrichment(cache_session, key, model=model, enriched=enriched)
                        _log_enrichment(model)
                    else:
                        cache_hits += 1
                    issue["summary"] = enriched["summary"]
                    issue["category"] = enriched["category"]
                    issue["score_reason"] = enriched.get("score_reason") or None
                    enriched_ok += 1
                except Exception as exc:
                    fallbacks += 1
                    issue["summary"] = FALLBACK_SUMMARY
                    issue["category"] = FALLBACK_CATEGORY
                    issue["score_reason"] = None
                    warnings.append(_otari_fail_detail(exc))
                prepared.append(issue)
            cache_session.commit()
        enrich_s = time.perf_counter() - enrich_started

        with Session(db) as session:
            board = session.exec(select(Board).where(Board.name == LIVE_BOARD_NAME)).first()
            if board is None:
                board = Board(name=LIVE_BOARD_NAME, repos=list(repos))
                session.add(board)
                session.commit()
                session.refresh(board)
            else:
                board.repos = list(repos)
                session.add(board)
            assert board.id is not None
            existing = session.exec(select(Issue).where(Issue.board_id == board.id)).all()
            for row in existing:
                session.delete(row)
            session.flush()
            stored: list[Issue] = []
            for payload in prepared:
                row = Issue(board_id=board.id, **_issue_fields(payload))
                session.add(row)
                stored.append(row)
            session.commit()
            for row in stored:
                session.refresh(row)
            issues = [_serialize_issue(row) for row in stored]

        warning_text = ""
        if warnings:
            warning_text = f"Otari failed on {fallbacks} of {total} issues. {warnings[0]}"

        write_load_event(
            {
                "event": "load_done",
                "repos": list(repos),
                "issues_scraped": total,
                "issues_enriched": enriched_ok,
                "issues_fallback": fallbacks,
                "otari_cache_hits": cache_hits,
                "github_graphql_calls": graphql_call_count(),
                "otari_calls": otari_call_count(),
                "otari_retries": otari_retry_count(),
                "scrape_s": round(scrape_s, 2),
                "enrich_s": round(enrich_s, 2),
                "total_s": round(time.perf_counter() - started, 2),
                "warning": warning_text or None,
            }
        )
        print(
            "live-load"
            f" repos={len(repos)}"
            f" scraped={total}"
            f" enriched={enriched_ok}"
            f" fallback={fallbacks}"
            f" cache_hits={cache_hits}"
            f" github_graphql={graphql_call_count()}"
            f" otari={otari_call_count()}"
            f" retries={otari_retry_count()}"
            f" scrape_s={scrape_s:.1f}"
            f" enrich_s={enrich_s:.1f}",
            flush=True,
        )

        _set_progress(status="idle", current=total, total=total, detail="")
        result: dict = {"issues": issues}
        if warning_text:
            result["warning"] = warning_text
        return result
    except Exception:
        _set_progress(status="idle", current=0, total=0, detail="")
        raise


def get_live_board(*, engine=None) -> dict:
    db = engine or get_engine()
    with Session(db) as session:
        board = session.exec(select(Board).where(Board.name == LIVE_BOARD_NAME)).first()
        if board is None:
            return {"issues": [], "repos": []}
        rows = session.exec(select(Issue).where(Issue.board_id == board.id)).all()
        return {
            "issues": [_serialize_issue(row) for row in rows],
            "repos": list(board.repos),
        }
