from fastapi.testclient import TestClient

from src.main import app


def test_github_login_redirect():
    from src.auth.github import router
    from fastapi import FastAPI

    isolated = FastAPI()
    isolated.include_router(router, prefix="/auth")
    client = TestClient(isolated)
    resp = client.get("/auth/github", follow_redirects=False)
    assert resp.status_code == 302
    assert "github.com/login/oauth/authorize" in resp.headers["location"]


def test_live_routes_require_bearer():
    client = TestClient(app)
    assert client.get("/v1/preflight").status_code == 401
    assert client.get("/v1/repos").status_code == 401
    assert client.post("/v1/boards/load", json={"repos": ["acme/app"]}).status_code == 401
    assert client.get("/v1/boards/live").status_code == 401
    assert client.get("/v1/boards/load/progress").status_code == 401
    assert client.post("/v1/boards/overlap", json={"issues": []}).status_code == 401
