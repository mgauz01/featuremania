from unittest.mock import MagicMock

from src.otari.client import OtariClient
from src.otari.config import OtariConfig


def test_otari_client_initialization():
    client = OtariClient(base_url="http://localhost:8000/v1", api_key="gw-...")
    assert client.base_url == "http://localhost:8000/v1"


def test_otari_config_from_env(monkeypatch):
    for name in (
        "OTARI_BASE_URL",
        "OTARI_API_KEY",
        "OTARI_SUMMARY_MODEL",
        "OTARI_CATEGORY_MODEL",
        "OTARI_JUDGMENT_MODEL",
        "OTARI_GUARDRAIL_PROFILE",
        "OTARI_GUARDRAIL_MODE",
        "OTARI_BUDGET_USER",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("OTARI_BASE_URL", "http://localhost:8080/v1/")
    monkeypatch.setenv("OTARI_API_KEY", "gw-test")
    monkeypatch.setenv("OTARI_SUMMARY_MODEL", "mzai:deepseek-ai/DeepSeek-V3.2")
    config = OtariConfig.from_env()
    assert config.base_url == "http://localhost:8080/v1"
    assert config.api_key == "gw-test"
    assert config.guardrails() == [{"profile": "prompt-injection", "mode": "block"}]


def test_otari_config_requires_api_key(monkeypatch):
    monkeypatch.delenv("OTARI_API_KEY", raising=False)
    try:
        OtariConfig.from_env()
    except RuntimeError as exc:
        assert "OTARI_API_KEY" in str(exc)
    else:
        raise AssertionError("expected RuntimeError")


def test_summarize_sends_guardrails_and_budget_user():
    completion = MagicMock()
    completion.choices = [MagicMock()]
    completion.choices[0].message.content = "Add dark mode to the settings page."
    openai_client = MagicMock()
    openai_client.chat.completions.create.return_value = completion

    config = OtariConfig(
        base_url="http://localhost:8080/v1",
        api_key="gw-test",
        summary_model="mzai:deepseek-ai/DeepSeek-V3.2",
        category_model="mzai:moonshotai/Kimi-K2.6",
        judgment_model="mzai:deepseek-ai/DeepSeek-V3.2",
        guardrail_profile="prompt-injection",
        guardrail_mode="block",
        budget_user="enrichment",
    )
    client = OtariClient.from_config(config, client=openai_client)

    summary = client.summarize("Please add dark mode...")

    assert summary == "Add dark mode to the settings page."
    openai_client.chat.completions.create.assert_called_once()
    kwargs = openai_client.chat.completions.create.call_args.kwargs
    assert kwargs["model"] == "mzai:deepseek-ai/DeepSeek-V3.2"
    assert kwargs["user"] == "enrichment"
    assert kwargs["extra_body"] == {
        "guardrails": [{"profile": "prompt-injection", "mode": "block"}]
    }


def test_complete_uses_requested_model():
    completion = MagicMock()
    completion.choices = [MagicMock()]
    completion.choices[0].message.content = "bugfix"
    openai_client = MagicMock()
    openai_client.chat.completions.create.return_value = completion
    client = OtariClient(
        base_url="http://localhost:8080/v1/",
        api_key="gw-test",
        client=openai_client,
    )

    result = client.complete(
        model="mzai:moonshotai/Kimi-K2.6",
        messages=[{"role": "user", "content": "Categorize: add dark mode"}],
    )

    assert result == "bugfix"
    assert client.base_url == "http://localhost:8080/v1"
    kwargs = openai_client.chat.completions.create.call_args.kwargs
    assert kwargs["model"] == "mzai:moonshotai/Kimi-K2.6"
    assert kwargs["user"] == "featuremania"
    assert kwargs["extra_body"]["guardrails"][0]["profile"] == "prompt-injection"

