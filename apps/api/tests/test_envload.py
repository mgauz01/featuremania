import os

from src.envload import apply_env_file, load_repo_dotenv


def test_apply_env_file_sets_missing_keys(tmp_path, monkeypatch):
    monkeypatch.delenv("OTARI_API_KEY", raising=False)
    monkeypatch.delenv("OTARI_BASE_URL", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text("OTARI_API_KEY=tk_from_file\n# comment\nOTARI_BASE_URL=https://example.test/v1\n")

    apply_env_file(env_file, override=False)

    assert os.getenv("OTARI_API_KEY") == "tk_from_file"
    assert os.getenv("OTARI_BASE_URL") == "https://example.test/v1"


def test_apply_env_file_does_not_override_existing(tmp_path, monkeypatch):
    monkeypatch.setenv("OTARI_API_KEY", "already-set")
    env_file = tmp_path / ".env"
    env_file.write_text("OTARI_API_KEY=from-file\n")

    apply_env_file(env_file, override=False)

    assert os.getenv("OTARI_API_KEY") == "already-set"


def test_load_repo_dotenv_reads_parent_env_when_api_dir_has_none(tmp_path, monkeypatch):
    monkeypatch.delenv("OTARI_API_KEY", raising=False)
    repo = tmp_path / "featuremania"
    api_dir = repo / "apps" / "api"
    api_dir.mkdir(parents=True)
    (repo / ".env").write_text("OTARI_API_KEY=tk_parent\n")

    loaded = load_repo_dotenv(start=api_dir)

    assert loaded == repo / ".env"
    assert os.getenv("OTARI_API_KEY") == "tk_parent"


def test_load_repo_dotenv_prefers_api_local_env(tmp_path, monkeypatch):
    monkeypatch.delenv("OTARI_API_KEY", raising=False)
    repo = tmp_path / "featuremania"
    api_dir = repo / "apps" / "api"
    api_dir.mkdir(parents=True)
    (repo / ".env").write_text("OTARI_API_KEY=tk_parent\n")
    (api_dir / ".env").write_text("OTARI_API_KEY=tk_api\n")

    loaded = load_repo_dotenv(start=api_dir)

    assert loaded == api_dir / ".env"
    assert os.getenv("OTARI_API_KEY") == "tk_api"
