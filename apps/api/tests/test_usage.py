import httpx
from fastapi.testclient import TestClient

from src.main import app
from src.otari.usage import UsageTracker, reset_tracker


def test_usage_tracking():
    from src.otari.usage import UsageTracker

    tracker = UsageTracker()
    tracker.log(model="deepseek-v3", tokens=100, cost=0.001, feature="summary")
    assert len(tracker.events) == 1


def test_usage_log_records_guardrail_blocks():
    tracker = UsageTracker()
    tracker.log(
        model="deepseek-v3",
        tokens=40,
        cost=0.002,
        feature="summary",
        guardrail_block="prompt-injection",
    )
    assert tracker.events[0] == {
        "model": "deepseek-v3",
        "tokens": 40,
        "cost": 0.002,
        "feature": "summary",
        "guardrail_block": "prompt-injection",
    }


def test_fetch_otari_reads_v1_usage():
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "http://localhost:8080/v1/usage"
        assert request.headers["Authorization"] == "Bearer gw-test"
        return httpx.Response(
            200,
            json={
                "events": [
                    {
                        "model": "deepseek-v3",
                        "tokens": 12,
                        "cost": 0.001,
                        "feature": "summary",
                        "guardrail_block": None,
                    }
                ]
            },
        )

    tracker = UsageTracker()
    remote = tracker.fetch_otari(
        base_url="http://localhost:8080/v1",
        api_key="gw-test",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    assert remote[0]["model"] == "deepseek-v3"
    assert remote[0]["feature"] == "summary"
    assert tracker.events == []


def test_usage_endpoint_returns_logged_events(monkeypatch):
    tracker = reset_tracker()
    tracker.log(model="deepseek-v3", tokens=100, cost=0.001, feature="summary")
    monkeypatch.delenv("OTARI_API_KEY", raising=False)
    client = TestClient(app)
    payload = client.get("/v1/usage").json()
    assert payload["events"] == [
        {
            "model": "deepseek-v3",
            "tokens": 100,
            "cost": 0.001,
            "feature": "summary",
            "guardrail_block": None,
        }
    ]
