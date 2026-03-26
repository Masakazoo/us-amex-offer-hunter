from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

import structlog

from core.settings import Settings
from us_amex_offer_hunter.core.engine import OfferDetector, OfferResult, SeleniumEngine
from us_amex_offer_hunter.notifier.discord_bot import DiscordNotifier

logger = structlog.get_logger(__name__)


def run_once() -> None:
    """Run a single sweep over configured URLs and report any hits."""
    settings = Settings.load()
    engine = SeleniumEngine(settings=settings)
    notifier = DiscordNotifier(settings=settings)
    detector = OfferDetector(engine=engine)

    try:
        for url in settings.config.urls:
            result = detector.check_offer(url)
            if result.found:
                message = f"🎯 Found target offer {result.amount} at {result.url}"
                logger.info("offer_found", url=result.url, amount=result.amount)
                notifier.notify_offer_found(message)
            else:
                logger.info("offer_not_found", url=result.url)
    finally:
        engine.close()


def notify_test() -> None:
    """Send a single test notification to the configured Discord channel."""
    settings = Settings.load()
    notifier = DiscordNotifier(settings=settings)
    logger.info("discord_notify_test_start")
    notifier.notify_offer_found("🔔 Amex Offer Hunter Discord test notification")
    logger.info("discord_notify_test_done")


def run_verify_once(log_path: Optional[Path] = None) -> None:
    """Run one non-notifying verification pass and optionally persist results."""
    settings = Settings.load()
    engine = SeleniumEngine(settings=settings)
    detector = OfferDetector(engine=engine)
    output_path = log_path or Path("runs/verify_amounts.jsonl")

    try:
        for url in settings.config.urls:
            result = detector.check_offer(url)
            logger.info(
                "verify_once_result",
                url=result.url,
                found=result.found,
                amount=result.amount,
            )
            _append_verify_log(output_path, result=result, iteration=1)
    finally:
        engine.close()


def run_verify_loop(iterations: int = 5, interval_seconds: float = 45.0, log_path: Optional[Path] = None) -> None:
    """Run repeated non-notifying verification passes with a cooldown between runs."""
    settings = Settings.load()
    engine = SeleniumEngine(settings=settings)
    detector = OfferDetector(engine=engine)
    output_path = log_path or Path("runs/verify_amounts.jsonl")

    try:
        for index in range(1, iterations + 1):
            logger.info("verify_loop_iteration_start", iteration=index, iterations=iterations)
            for url in settings.config.urls:
                result = detector.check_offer(url)
                logger.info(
                    "verify_loop_result",
                    iteration=index,
                    url=result.url,
                    found=result.found,
                    amount=result.amount,
                )
                _append_verify_log(output_path, result=result, iteration=index)

            if index < iterations:
                time.sleep(interval_seconds)
    finally:
        engine.close()


def _append_verify_log(path: Path, result: OfferResult, iteration: int) -> None:
    """Append a single verification result row as JSON Lines."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "iteration": iteration,
        "url": result.url,
        "found": result.found,
        "amount": result.amount,
    }
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def app() -> None:
    """Entry point for console_script."""
    run_once()


def main_cli() -> None:
    """Entry point for module execution with optional verify modes."""
    import argparse

    parser = argparse.ArgumentParser(description="US Amex Offer Hunter CLI utilities.")
    parser.add_argument(
        "--notify-test",
        action="store_true",
        help="send a single test notification to Discord and exit",
    )
    parser.add_argument(
        "--verify-once",
        action="store_true",
        help="visit configured URL(s) once and log extracted amount without notifications",
    )
    parser.add_argument(
        "--verify-loop",
        action="store_true",
        help="repeat URL verification with sleep intervals without notifications",
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=5,
        help="number of verify-loop iterations (default: 5)",
    )
    parser.add_argument(
        "--interval-sec",
        type=float,
        default=45.0,
        help="sleep seconds between verify-loop iterations (default: 45)",
    )
    parser.add_argument(
        "--verify-log-path",
        type=Path,
        default=Path("runs/verify_amounts.jsonl"),
        help="output JSONL path for verify results",
    )
    args = parser.parse_args()

    if args.notify_test:
        notify_test()
        return
    if args.verify_once:
        run_verify_once(log_path=args.verify_log_path)
        return
    if args.verify_loop:
        run_verify_loop(
            iterations=args.iterations,
            interval_seconds=args.interval_sec,
            log_path=args.verify_log_path,
        )
        return
    app()


__all__: List[str] = ["app", "run_once", "notify_test", "run_verify_once", "run_verify_loop", "main_cli"]


if __name__ == "__main__":
    main_cli()
