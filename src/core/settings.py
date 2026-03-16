from __future__ import annotations

from typing import List, Optional

import structlog
from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = structlog.get_logger(__name__)


class ProxySettings(BaseModel):
    """Proxy configuration loaded from environment variables."""

    provider: str
    api_key: str
    country: str = "US"


class DiscordSettings(BaseModel):
    """Discord notification settings."""

    bot_token: str
    channel_id: str


class TelegramSettings(BaseModel):
    """Telegram notification settings (optional)."""

    bot_token: str
    chat_id: str


class AppConfig(BaseModel):
    """Top-level config model mirroring logical configuration structure."""

    proxies: ProxySettings
    discord: DiscordSettings
    telegram: Optional[TelegramSettings] = None
    urls: List[str]
    targets: List[int]


class Settings(BaseSettings):
    """Application settings loaded purely from .env and environment variables."""

    model_config = SettingsConfigDict(
        env_nested_delimiter="__",
        env_prefix="US_AMEX_OFFER_HUNTER_",
        env_file=".env",
        env_file_encoding="utf-8",
    )

    config: AppConfig

    @classmethod
    def load(cls) -> "Settings":
        """Load settings from .env and environment variables."""
        return cls()  # type: ignore[call-arg]


__all__ = ["Settings", "AppConfig", "ProxySettings", "DiscordSettings", "TelegramSettings"]
