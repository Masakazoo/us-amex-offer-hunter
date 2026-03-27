from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import structlog
import yaml
from pydantic import BaseModel, Field, ValidationError

logger = structlog.get_logger(__name__)


class ProxySettings(BaseModel):
    """Proxy configuration."""

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


class SeleniumSettings(BaseModel):
    """Selenium runtime settings for verification experiments."""

    headless: bool = True
    disable_automation_flags: bool = True
    user_agent: Optional[str] = None


class ConditionProfile(BaseModel):
    """Named execution profile for condition-based verification runs."""

    name: Optional[str] = None
    label: Optional[str] = None
    selenium: Optional[SeleniumSettings] = None
    proxies: Optional[ProxySettings] = None


class AppConfig(BaseModel):
    """Top-level config model."""

    proxies: ProxySettings
    discord: DiscordSettings
    telegram: Optional[TelegramSettings] = None
    selenium: SeleniumSettings = Field(default_factory=SeleniumSettings)
    profiles: Dict[str, ConditionProfile] = Field(default_factory=dict)
    urls: List[str]
    targets: List[int]


class Settings(BaseModel):
    """Application settings loaded from config.yaml and overridden by .env/environment."""

    config_path: Path = Field(default=Path("config.yaml"), description="Path to YAML config file.")
    dotenv_path: Path = Field(default=Path(".env"), description="Path to .env file.")

    config: AppConfig

    @classmethod
    def load(cls, config_path: Optional[Path] = None, dotenv_path: Optional[Path] = None) -> "Settings":
        """Load settings from config.yaml and override secrets via .env/environment variables."""
        resolved_config_path = config_path or Path("config.yaml")
        resolved_dotenv_path = dotenv_path or Path(".env")

        raw_yaml = _load_yaml(resolved_config_path)
        overlay = _load_env_overlay(resolved_dotenv_path)
        merged = _deep_merge(raw_yaml, overlay)

        try:
            app_config = AppConfig.model_validate(merged)
        except ValidationError as exc:
            logger.error("config_validation_error", errors=exc.errors())
            raise RuntimeError("Invalid configuration") from exc

        return cls(
            config_path=resolved_config_path,
            dotenv_path=resolved_dotenv_path,
            config=app_config,
        )


__all__ = [
    "Settings",
    "AppConfig",
    "ProxySettings",
    "DiscordSettings",
    "TelegramSettings",
    "SeleniumSettings",
    "ConditionProfile",
]


def _load_yaml(path: Path) -> Dict[str, Any]:
    """Load YAML file into a dict."""
    try:
        with path.open("r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
    except FileNotFoundError as exc:
        logger.error("config_file_not_found", path=str(path))
        raise RuntimeError(f"Config file not found: {path}") from exc
    except yaml.YAMLError as exc:
        logger.error("config_yaml_parse_error", path=str(path), error=str(exc))
        raise RuntimeError(f"Failed to parse YAML config: {path}") from exc

    if not isinstance(raw, dict):
        raise RuntimeError(f"Invalid YAML root type: expected mapping, got {type(raw).__name__}")

    return raw


def _parse_dotenv(path: Path) -> Dict[str, str]:
    """Parse a minimal .env file (KEY=VALUE lines) into a dict."""
    if not path.exists():
        return {}

    out: Dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        out[key.strip()] = value.strip()
    return out


def _load_env_overlay(dotenv_path: Path) -> Dict[str, Any]:
    """Build overlay dict from .env and process environment variables.

    Only keys under the prefix ``US_AMEX_OFFER_HUNTER_CONFIG__`` are considered.
    """

    prefix = "US_AMEX_OFFER_HUNTER_CONFIG__"
    kv: Dict[str, str] = {}
    kv.update(_parse_dotenv(dotenv_path))
    kv.update({k: v for k, v in os.environ.items() if k.startswith(prefix)})

    overlay: Dict[str, Any] = {}
    for key, value in kv.items():
        if not key.startswith(prefix):
            continue
        path_parts = [p.lower() for p in key[len(prefix) :].split("__") if p]
        if not path_parts:
            continue
        _set_path(overlay, path_parts, _maybe_parse_json_array(value))

    return overlay


def _maybe_parse_json_array(value: str) -> Any:
    """Parse JSON arrays from env overlay values when possible.

    Example:
      US_AMEX_OFFER_HUNTER_CONFIG__URLS='["https://a.example","https://b.example"]'
    """
    stripped = value.strip()
    if not (stripped.startswith("[") and stripped.endswith("]")):
        return value
    try:
        parsed: Any = json.loads(stripped)
    except json.JSONDecodeError:
        return value
    if isinstance(parsed, list):
        return parsed
    return value


def _set_path(root: Dict[str, Any], parts: List[str], value: Any) -> None:
    cur: Dict[str, Any] = root
    for part in parts[:-1]:
        next_obj = cur.get(part)
        if not isinstance(next_obj, dict):
            next_obj = {}
            cur[part] = next_obj
        cur = next_obj
    cur[parts[-1]] = value


def _deep_merge(base: Dict[str, Any], overlay: Dict[str, Any]) -> Dict[str, Any]:
    """Deep-merge overlay onto base (overlay wins)."""
    out: Dict[str, Any] = dict(base)
    for key, overlay_value in overlay.items():
        base_value = out.get(key)
        if isinstance(base_value, dict) and isinstance(overlay_value, dict):
            out[key] = _deep_merge(base_value, overlay_value)
        else:
            out[key] = overlay_value
    return out
