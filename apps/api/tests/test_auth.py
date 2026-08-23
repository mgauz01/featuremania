def test_github_login_redirect():
    from src.auth.github import router
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(router, prefix="/auth")
    client = TestClient(app)
    resp = client.get("/auth/github", follow_redirects=False)
    assert resp.status_code == 302
    assert "github.com/login/oauth/authorize" in resp.headers["location"]
