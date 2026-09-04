import os
import time

from openai import OpenAI

from src.otari.config import OtariConfig

_RETRY_STATUSES = {403, 408, 409, 429, 500, 502, 503, 504}
_RETRY_BACKOFF = (0.8, 2.0)
_MAX_ATTEMPTS = 3

_otari_calls = 0
_otari_retries = 0


def reset_otari_call_counts() -> None:
    global _otari_calls, _otari_retries
    _otari_calls = 0
    _otari_retries = 0


def otari_call_count() -> int:
    return _otari_calls


def otari_retry_count() -> int:
    return _otari_retries


def _retryable(exc: BaseException) -> bool:
    status = getattr(exc, "status_code", None)
    if isinstance(status, int):
        return status in _RETRY_STATUSES
    name = type(exc).__name__
    return name in {
        "APITimeoutError",
        "APIConnectionError",
        "RateLimitError",
        "InternalServerError",
        "TimeoutError",
    }


class OtariClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        config: OtariConfig | None = None,
        client: OpenAI | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.config = config
        self.client = client or OpenAI(
            base_url=self.base_url,
            api_key=api_key,
            timeout=30.0,
            max_retries=0,
        )

    @classmethod
    def from_config(cls, config: OtariConfig, client: OpenAI | None = None) -> "OtariClient":
        return cls(
            base_url=config.base_url,
            api_key=config.api_key,
            config=config,
            client=client,
        )

    def summarize(self, text: str) -> str:
        model = (
            self.config.summary_model
            if self.config is not None
            else "mzai:moonshotai/Kimi-K2.6"
        )
        return self.complete(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": f"Summarize this GitHub issue in one line:\n{text}",
                }
            ],
        )

    def complete(
        self,
        *,
        model: str,
        messages: list[dict],
        user: str | None = None,
        session_label: str | None = None,
    ) -> str:
        label = session_label or user or self._budget_label()
        last_exc: BaseException | None = None
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            global _otari_calls, _otari_retries
            _otari_calls += 1
            try:
                resp = self.client.chat.completions.create(
                    model=model,
                    messages=messages,
                    user=label,
                    extra_body=self._extra_body(label),
                )
                content = resp.choices[0].message.content
                if not content:
                    raise RuntimeError("Otari completion returned empty content")
                return content
            except Exception as exc:
                last_exc = exc
                if attempt < _MAX_ATTEMPTS and _retryable(exc):
                    _otari_retries += 1
                    time.sleep(_RETRY_BACKOFF[min(attempt - 1, len(_RETRY_BACKOFF) - 1)])
                    continue
                raise
        assert last_exc is not None
        raise last_exc

    def _budget_label(self) -> str:
        if self.config is not None:
            return self.config.budget_user
        return "featuremania"

    def _guardrails(self) -> list[dict[str, str]]:
        if self.config is not None:
            return self.config.guardrails()
        return [{"profile": "prompt-injection", "mode": "block"}]

    def _extra_body(self, session_label: str | None = None) -> dict:
        label = (session_label or self._budget_label())[:255]
        body: dict = {"session_label": label}
        url = os.getenv("OTARI_GUARDRAILS_URL", "").strip()
        if url:
            body["guardrails"] = [{**entry, "url": url} for entry in self._guardrails()]
        return body
