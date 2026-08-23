import os
from dataclasses import dataclass, field


def _env(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip()


@dataclass(frozen=True)
class OtariConfig:
    base_url: str
    api_key: str = field(repr=False)
    summary_model: str
    category_model: str
    judgment_model: str
    guardrail_profile: str
    guardrail_mode: str
    budget_user: str

    @classmethod
    def from_env(cls) -> "OtariConfig":
        api_key = os.getenv("OTARI_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("OTARI_API_KEY is required")
        return cls(
            base_url=_env("OTARI_BASE_URL", "https://api.otari.ai/v1").rstrip("/"),
            api_key=api_key,
            summary_model=_env("OTARI_SUMMARY_MODEL", "mzai:deepseek-ai/DeepSeek-V3.2"),
            category_model=_env("OTARI_CATEGORY_MODEL", "mzai:moonshotai/Kimi-K2.6"),
            judgment_model=_env("OTARI_JUDGMENT_MODEL", "mzai:deepseek-ai/DeepSeek-V3.2"),
            guardrail_profile=_env("OTARI_GUARDRAIL_PROFILE", "prompt-injection"),
            guardrail_mode=_env("OTARI_GUARDRAIL_MODE", "block"),
            budget_user=_env("OTARI_BUDGET_USER", "featuremania"),
        )

    def guardrails(self) -> list[dict[str, str]]:
        return [{"profile": self.guardrail_profile, "mode": self.guardrail_mode}]
