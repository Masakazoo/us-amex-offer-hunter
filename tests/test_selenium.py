from __future__ import annotations

from pathlib import Path
from typing import Optional

import pytest

from core.settings import AppConfig, DiscordSettings, ProxySettings, Settings
from us_amex_offer_hunter.core.engine import OfferDetector, OfferResult, SeleniumEngine


class DummyDriver:
    def __init__(self, body_text: str) -> None:
        self._body_text = body_text

    def get(self, url: str) -> None:  # pragma: no cover - no-op
        _ = url

    def find_elements(self, by: str, value: str) -> list[object]:
        class Element:
            def __init__(self, text: str) -> None:
                self.text = text

        return [Element(self._body_text)]

    def quit(self) -> None:  # pragma: no cover - no-op
        return


class DummyEngine(SeleniumEngine):  # type: ignore[misc]
    def __init__(self, settings: Settings, body_text: str) -> None:
        self._settings = settings
        self._driver = DummyDriver(body_text=body_text)


def make_settings(targets: Optional[list[int]] = None) -> Settings:
    proxies = ProxySettings(provider="proxyrack", api_key="KEY", country="US")
    discord = DiscordSettings(bot_token="TOKEN", channel_id="123")
    app_cfg = AppConfig(
        proxies=proxies,
        discord=discord,
        telegram=None,
        urls=["https://example.com"],
        targets=targets or [300000, 250000],
    )
    return Settings(config_path=Path("config.yaml"), dotenv_path=Path(".env"), config=app_cfg)


def test_offer_detector_finds_target_amount(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = make_settings([300000])
    engine = DummyEngine(
        settings=settings,
        body_text="Congratulations, you are pre-approved for 300000 points!",
    )
    detector = OfferDetector(engine=engine)

    result: OfferResult = detector.check_offer("https://example.com")
    assert result.found is True
    assert result.amount == 300000


def test_offer_detector_handles_no_match() -> None:
    settings = make_settings([300000])
    engine = DummyEngine(settings=settings, body_text="No bonus for you today.")
    detector = OfferDetector(engine=engine)

    result: OfferResult = detector.check_offer("https://example.com")
    assert result.found is False
    assert result.amount is None


def test_offer_detector_parses_comma_separated_amount() -> None:
    settings = make_settings([200000])
    engine = DummyEngine(
        settings=settings,
        body_text="Limited time offer: Earn up to 200,000 Membership Rewards points.",
    )
    detector = OfferDetector(engine=engine)

    result: OfferResult = detector.check_offer("https://example.com")
    assert result.found is True
    assert result.amount == 200000
