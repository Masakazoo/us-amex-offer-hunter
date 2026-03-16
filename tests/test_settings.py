from __future__ import annotations

from pathlib import Path

from core.settings import Settings


def test_settings_loads_sample_config(tmp_path: Path) -> None:
    config_content = """
proxies:
  provider: proxyrack
  api_key: "KEY"
  country: "US"

discord:
  bot_token: "DISCORD_TOKEN"
  channel_id: "1234567890"

urls:
  - "https://example.com"

targets:
  - 300000
"""
    cfg = tmp_path / "config.yaml"
    cfg.write_text(config_content, encoding="utf-8")

    settings = Settings.load(config_path=cfg)

    assert settings.config.proxies.provider == "proxyrack"
    assert settings.config.discord.bot_token == "DISCORD_TOKEN"
    assert settings.config.urls == ["https://example.com"]
    assert settings.config.targets == [300000]

