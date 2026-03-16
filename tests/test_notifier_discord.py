from __future__ import annotations

from typing import List

from core.settings import AppConfig, DiscordSettings, ProxySettings, Settings
from us_amex_offer_hunter.notifier.discord_bot import DiscordNotifier


class DummyDiscordNotifier(DiscordNotifier):  # type: ignore[misc]
    def __init__(self, settings: Settings) -> None:
        super().__init__(settings)
        self.sent_messages: List[str] = []

    def _send_message_sync(self, message: str) -> None:
        self.sent_messages.append(message)


def make_settings() -> Settings:
    proxies = ProxySettings(provider="proxyrack", api_key="KEY", country="US")
    discord = DiscordSettings(bot_token="TOKEN", channel_id="123")
    app_cfg = AppConfig(
        proxies=proxies,
        discord=discord,
        telegram=None,
        urls=["https://example.com"],
        targets=[300000],
    )
    return Settings(config=app_cfg)


def test_discord_notifier_sends_offer_message() -> None:
    settings = make_settings()
    notifier = DummyDiscordNotifier(settings=settings)

    notifier.notify_offer_found("Found 300k")

    assert "Found 300k" in notifier.sent_messages


def test_discord_notifier_sends_error_message() -> None:
    settings = make_settings()
    notifier = DummyDiscordNotifier(settings=settings)

    notifier.notify_error("Something went wrong")

    assert any(msg.startswith("[ERROR]") for msg in notifier.sent_messages)
