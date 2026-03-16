from __future__ import annotations

from typing import List

import structlog

from core.settings import Settings
from us_amex_offer_hunter.core.engine import OfferDetector, SeleniumEngine
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


def app() -> None:
    """Entry point for console_script."""
    run_once()


__all__: List[str] = ["app", "run_once", "notify_test"]


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="US Amex Offer Hunter CLI utilities.")
    parser.add_argument(
        "--notify-test",
        action="store_true",
        help="send a single test notification to Discord and exit",
    )
    args = parser.parse_args()

    if args.notify_test:
        notify_test()
    else:
        app()
