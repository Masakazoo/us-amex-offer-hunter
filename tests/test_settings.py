from __future__ import annotations

from pathlib import Path

import pytest

from core.settings import Settings


def test_settings_loads_yaml_and_overrides_secrets_from_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    cfg = tmp_path / "config.yaml"
    cfg.write_text(
        """
proxies:
  provider: proxyrack
  api_key: ""
  country: "US"

discord:
  bot_token: ""
  channel_id: "1234567890"

telegram:
  bot_token: ""
  chat_id: ""

urls:
  - "https://example.com"

targets:
  - 300000
selenium:
  headless: true
  disable_automation_flags: true
  user_agent: ""
""".lstrip(),
        encoding="utf-8",
    )

    monkeypatch.setenv("US_AMEX_OFFER_HUNTER_CONFIG__PROXIES__API_KEY", "KEY")
    monkeypatch.setenv("US_AMEX_OFFER_HUNTER_CONFIG__DISCORD__BOT_TOKEN", "DISCORD_TOKEN")
    monkeypatch.setenv(
        "US_AMEX_OFFER_HUNTER_CONFIG__URLS",
        '["https://a.example","https://b.example"]',
    )

    settings = Settings.load(config_path=cfg, dotenv_path=tmp_path / ".env")

    assert settings.config.proxies.provider == "proxyrack"
    assert settings.config.proxies.api_key == "KEY"
    assert settings.config.discord.bot_token == "DISCORD_TOKEN"
    assert settings.config.urls == ["https://a.example", "https://b.example"]
    assert settings.config.targets == [300000]
    assert settings.config.selenium.headless is True
