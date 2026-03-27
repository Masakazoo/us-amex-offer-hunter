from __future__ import annotations

from pathlib import Path
from typing import Optional

import pytest

from core.settings import AppConfig, DiscordSettings, ProxySettings, Settings
from us_amex_offer_hunter.core.engine import OfferDetector, OfferResult, SeleniumEngine


class DummyDriver:
    def __init__(self, body_text: str, page_source: Optional[str] = None) -> None:
        self._body_text = body_text
        self.page_source = page_source if page_source is not None else body_text

    def get(self, url: str) -> None:  # pragma: no cover - no-op
        _ = url

    def find_element(self, by: str, value: str) -> object:
        _ = (by, value)

        class Element:
            def __init__(self, text: str) -> None:
                self.text = text

        return Element(self._body_text)

    def find_elements(self, by: str, value: str) -> list[object]:
        _ = (by, value)
        return [self.find_element(by=by, value=value)]

    def quit(self) -> None:  # pragma: no cover - no-op
        return


class DummyEngine(SeleniumEngine):  # type: ignore[misc]
    def __init__(self, settings: Settings, body_text: str, page_source: Optional[str] = None) -> None:
        self._settings = settings
        self._driver = DummyDriver(body_text=body_text, page_source=page_source)


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


def test_offer_detector_prefers_earn_points_over_points_back() -> None:
    settings = make_settings([200000])
    engine = DummyEngine(
        settings=settings,
        body_text=(
            "Earn 200,000 Membership Rewards points after spend. "
            "Get 35% points back up to 1,000,000 points back per calendar year."
        ),
    )
    detector = OfferDetector(engine=engine)

    result: OfferResult = detector.check_offer("https://example.com")
    assert result.amount == 200000
    assert result.found is True


def test_offer_detector_parses_rewards_with_registered_mark_spacing() -> None:
    settings = make_settings([200000])
    engine = DummyEngine(
        settings=settings,
        body_text="Earn 200,000 Membership Rewards ® Points after eligible spend.",
    )
    detector = OfferDetector(engine=engine)

    result: OfferResult = detector.check_offer("https://example.com")
    assert result.amount == 200000
    assert result.found is True


def test_offer_detector_extracts_amount_even_when_not_target() -> None:
    settings = make_settings([250000])
    engine = DummyEngine(
        settings=settings,
        body_text="Earn 200,000 Membership Rewards points after eligible spend.",
    )
    detector = OfferDetector(engine=engine)

    result: OfferResult = detector.check_offer("https://example.com")
    assert result.found is False
    assert result.amount == 200000


def test_offer_detector_extracts_amount_from_initial_state() -> None:
    settings = make_settings([200000])
    # Simulate the real Amex style: window.__INITIAL_STATE__ assigned to a JSON string.
    initial_state = 'window.__INITIAL_STATE__ = "Earn 200,000 Membership Rewards Points";'
    engine = DummyEngine(settings=settings, body_text="", page_source=initial_state)
    detector = OfferDetector(engine=engine)

    result: OfferResult = detector.check_offer("https://example.com")
    assert result.found is True
    assert result.amount == 200000


def test_offer_detector_ignores_dollar_thresholds_for_target_matching() -> None:
    settings = make_settings([200000])
    engine = DummyEngine(
        settings=settings,
        body_text=(
            "Spend $200,000 in eligible purchases to unlock additional benefits. Earn 100,000 Membership Rewards points."
        ),
    )
    detector = OfferDetector(engine=engine)

    result: OfferResult = detector.check_offer("https://example.com")
    assert result.amount == 100000
    assert result.found is False


def test_offer_detector_double_check_uses_fresh_engine(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = make_settings([200000])
    original_engine = DummyEngine(settings=settings, body_text="No offer here.")
    detector = OfferDetector(engine=original_engine)

    class FreshEngine(DummyEngine):
        def __init__(self, settings: Settings) -> None:
            super().__init__(
                settings=settings,
                body_text="Earn 200,000 Membership Rewards points after eligible spend.",
            )

    monkeypatch.setattr("us_amex_offer_hunter.core.engine.SeleniumEngine", FreshEngine)

    result = detector.double_check("https://example.com")
    assert result.found is True
    assert result.amount == 200000
