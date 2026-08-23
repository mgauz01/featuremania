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
            user=self.config.budget_user if self.config is not None else "featuremania",
            extra_body={"guardrails": self._guardrails()},
        )
        content = resp.choices[0].message.content
        if not content:
            raise RuntimeError("Otari summarize returned empty content")
        return content

    def complete(self, *, model: str, messages: list[dict], user: str | None = None) -> str:
        resp = self.client.chat.completions.create(
            model=model,
            messages=messages,
            user=user
            or (self.config.budget_user if self.config is not None else "featuremania"),
            extra_body={"guardrails": self._guardrails()},
        )
        content = resp.choices[0].message.content
        if not content:
            raise RuntimeError("Otari completion returned empty content")
        return content

    def _guardrails(self) -> list[dict[str, str]]:
        if self.config is not None:
            return self.config.guardrails()
        return [{"profile": "prompt-injection", "mode": "block"}]
