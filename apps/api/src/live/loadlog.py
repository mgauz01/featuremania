from __future__ import annotations

import json
import os
import time
from pathlib import Path
from threading import Lock

_lock = Lock()


def log_path() -> Path | None:
    raw = os.getenv("LIVE_LOAD_LOG", "").strip()
    if raw.lower() in {"0", "off", "false", "none"}:
        return None
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parents[2] / "logs" / "live-load.jsonl"


def write_load_event(event: dict) -> None:
    path = log_path()
    if path is None:
        return
    payload = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **event}
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(payload, default=str)
        with _lock:
            with path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
    except OSError:
        return
