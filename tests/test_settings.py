from __future__ import annotations

from core.settings import AppConfig, DiscordSettings, ProxySettings, Settings


def test_settings_model_construction() -> None:
    proxies = ProxySettings(provider="proxyrack", api_key="KEY", country="US")
    discord = DiscordSettings(bot_token="DISCORD_TOKEN", channel_id="1234567890")
    app_cfg = AppConfig(
        proxies=proxies,
        discord=discord,
        telegram=None,
        urls=["https://example.com"],
        targets=[300000],
    )

    settings = Settings(config=app_cfg)

    assert settings.config.proxies.provider == "proxyrack"
    assert settings.config.discord.bot_token == "DISCORD_TOKEN"
    assert settings.config.urls == ["https://example.com"]
    assert settings.config.targets == [300000]
