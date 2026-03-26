from __future__ import annotations

import sys
from typing import List

import pytest

from us_amex_offer_hunter.cli import main


def test_app_calls_run_once(monkeypatch: pytest.MonkeyPatch) -> None:
    called: List[bool] = []

    def fake_run_once() -> None:
        called.append(True)

    monkeypatch.setattr(main, "run_once", fake_run_once)

    main.app()

    assert called == [True]


def test_main_cli_dispatches_verify_once(monkeypatch: pytest.MonkeyPatch) -> None:
    called: List[str] = []

    def fake_verify_once(*, log_path: object = None) -> None:
        _ = log_path
        called.append("verify_once")

    monkeypatch.setattr(main, "run_verify_once", fake_verify_once)
    monkeypatch.setattr(sys, "argv", ["prog", "--verify-once"])

    main.main_cli()

    assert called == ["verify_once"]
