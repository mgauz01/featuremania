from openai import OpenAI

from src.otari.config import OtariConfig


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
        self.client = client or OpenAI(base_url=self.base_url, api_key=api_key, timeout=30.0)

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
            else "mzai:deepseek-ai/DeepSeek-V3.2"
        )
        resp = self.client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": f"Summarize this GitHub issue in one line:\n{text}",
                }
            ],
            user=self._budget_label(),
            extra_body=self._extra_body(),
        )
        content = resp.choices[0].message.content
        if not content:
            raise RuntimeError("Otari summarize returned empty content")
        return content

    def complete(
        self,
        *,
        model: str,
        messages: list[dict],
        user: str | None = None,
        session_label: str | None = None,
    ) -> str:
        label = session_label or user or self._budget_label()
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
        return {
            "guardrails": self._guardrails(),
            "session_label": label,
        }
