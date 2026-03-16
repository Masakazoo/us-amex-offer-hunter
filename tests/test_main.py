from __future__ import annotations

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
