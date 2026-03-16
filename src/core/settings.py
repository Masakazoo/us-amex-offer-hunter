from __future__ import annotations

from pathlib import Path
from typing import List, Optional

import structlog
import yaml
from pydantic import BaseModel, Field, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict


logger = structlog.get_logger(__name__)


class ProxySettings(BaseModel):
    """Proxy configuration loaded from config.yaml."""

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
    """Top-level config model mirroring config.yaml structure."""

    proxies: ProxySettings
    discord: DiscordSettings
    telegram: Optional[TelegramSettings] = None
    urls: List[str]
    targets: List[int]


class Settings(BaseSettings):
    """Application settings loaded from config.yaml and environment variables."""

    model_config = SettingsConfigDict(env_nested_delimiter="__", env_prefix="US_AMEX_OFFER_HUNTER_")

    config_path: Path = Field(default=Path("config.yaml"), description="Path to YAML config file.")
    config: AppConfig

    @classmethod
    def load(cls, config_path: Optional[Path] = None) -> "Settings":
        """Load settings from a YAML file and environment variables."""
        resolved_path = config_path or Path("config.yaml")
        try:
            with resolved_path.open("r", encoding="utf-8") as f:
                raw = yaml.safe_load(f) or {}
        except FileNotFoundError as exc:
            logger.error("config_file_not_found", path=str(resolved_path))
            raise RuntimeError(f"Config file not found: {resolved_path}") from exc
        except yaml.YAMLError as exc:
            logger.error("config_yaml_parse_error", path=str(resolved_path), error=str(exc))
            raise RuntimeError(f"Failed to parse YAML config: {resolved_path}") from exc

        try:
            app_config = AppConfig.model_validate(raw)
        except ValidationError as exc:
            logger.error("config_validation_error", errors=exc.errors())
            raise RuntimeError("Invalid configuration in config.yaml") from exc

        return cls(config_path=resolved_path, config=app_config)


__all__ = ["Settings", "AppConfig", "ProxySettings", "DiscordSettings", "TelegramSettings"]

