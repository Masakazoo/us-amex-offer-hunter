from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

from us_amex_offer_hunter.cli import main
from us_amex_offer_hunter.core.engine import OfferResult


def test_app_calls_run_once(monkeypatch: pytest.MonkeyPatch) -> None:
    called: List[bool] = []

    def fake_run_once() -> None:
        called.append(True)

    monkeypatch.setattr(main, "run_once", fake_run_once)

    main.app()

    assert called == [True]


def test_main_cli_dispatches_verify_once(monkeypatch: pytest.MonkeyPatch) -> None:
    called: List[str] = []

    def fake_verify_once(**_kwargs: object) -> None:
        called.append("verify_once")

    monkeypatch.setattr(main, "run_verify_once", fake_verify_once)
    monkeypatch.setattr(sys, "argv", ["prog", "--verify-once"])

    main.main_cli()

    assert called == ["verify_once"]


def test_verify_loop_stop_on_hit(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    class FakeSettings:
        class Cfg:
            urls = ["https://example.com/a", "https://example.com/b"]

            class Selenium:
                headless = False
                user_agent = ""

            selenium = Selenium()
            profiles: Dict[str, Any] = {}

        config = Cfg()

    class FakeEngine:
        class Driver:
            capabilities = {"browserVersion": "137"}

        def __init__(self, settings: object) -> None:
            self._settings = settings
            self.driver = self.Driver()

        def close(self) -> None:
            return

    calls: List[str] = []

    class FakeDetector:
        def __init__(self, engine: object) -> None:
            self._responses = [
                OfferResult(url="https://example.com/a", found=False, amount=150000, raw_text=""),
                OfferResult(url="https://example.com/b", found=True, amount=200000, raw_text=""),
            ]

        def check_offer(self, url: str) -> OfferResult:
            calls.append(url)
            return self._responses[len(calls) - 1]

        def double_check(self, url: str) -> OfferResult:
            return OfferResult(url=url, found=True, amount=200000, raw_text="")

    monkeypatch.setattr(main.Settings, "load", lambda: FakeSettings())
    monkeypatch.setattr(main, "SeleniumEngine", FakeEngine)
    monkeypatch.setattr(main, "OfferDetector", FakeDetector)

    hit = main.run_verify_loop(
        iterations=3,
        interval_seconds=0,
        log_path=tmp_path / "verify.jsonl",
        stop_on_hit=True,
    )

    assert hit is True
    assert calls == ["https://example.com/a", "https://example.com/b"]


def test_main_cli_verify_loop_exit_code(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "run_verify_loop", lambda **_kwargs: False)
    monkeypatch.setattr(sys, "argv", ["prog", "--verify-loop"])

    with pytest.raises(SystemExit) as exc:
        main.main_cli()

    assert exc.value.code == 1
