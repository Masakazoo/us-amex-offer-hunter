from __future__ import annotations

import time
from typing import List

import structlog
from discord import Client, Intents, TextChannel

from core.settings import Settings
from us_amex_offer_hunter.notifier.base import NotifierProtocol

logger = structlog.get_logger(__name__)


class DiscordNotifier(NotifierProtocol):  # type: ignore[misc]
    """Discord-based notifier with simple retry logic."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._token = settings.config.discord.bot_token
        self._channel_id = int(settings.config.discord.channel_id)

    def notify_offer_found(self, message: str) -> None:
        self._send_with_retries(message)

    def notify_error(self, message: str) -> None:
        self._send_with_retries(f"[ERROR] {message}")

    def _send_with_retries(
        self, message: str, max_retries: int = 3, delay_seconds: float = 1.0
    ) -> None:
        for attempt in range(1, max_retries + 1):
            try:
                self._send_message_sync(message)
                return
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "discord_send_failed",
                    attempt=attempt,
                    max_retries=max_retries,
                    error=str(exc),
                )
                if attempt == max_retries:
                    break
                time.sleep(delay_seconds)

    def _send_message_sync(self, message: str) -> None:
        intents = Intents.default()
        client = Client(intents=intents)
        channel_id = self._channel_id

        @client.event
        async def on_ready() -> None:
            channel = client.get_channel(channel_id)
            if isinstance(channel, TextChannel):
                await channel.send(message)
            await client.close()

        client.run(self._token)


__all__: List[str] = ["DiscordNotifier"]
