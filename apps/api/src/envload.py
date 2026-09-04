import os
from pathlib import Path


def apply_env_file(path: Path, *, override: bool = False) -> None:
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if not key:
            continue
        if not override and os.getenv(key) is not None:
            continue
        os.environ[key] = value


def load_repo_dotenv(start: Path | None = None) -> Path | None:
    current = (start or Path(__file__).resolve().parents[1]).resolve()
    for _ in range(6):
        candidate = current / ".env"
        if candidate.is_file():
            apply_env_file(candidate, override=False)
            return candidate
        at_repo_root = (current / "apps" / "web").is_dir() or (current / "pnpm-workspace.yaml").is_file()
        if at_repo_root or current.parent == current:
            return None
        current = current.parent
    return None
