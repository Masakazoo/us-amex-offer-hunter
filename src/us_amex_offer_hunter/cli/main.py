from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import structlog
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver

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


def run_verify_once(
    log_path: Optional[Path] = None,
    dump_elements: bool = False,
    elements_log_path: Optional[Path] = None,
    dump_page_source: bool = False,
    dump_body_text: bool = False,
    dump_dir: Optional[Path] = None,
) -> None:
    """Run one non-notifying verification pass and optionally persist results."""
    settings = Settings.load()
    engine = SeleniumEngine(settings=settings)
    detector = OfferDetector(engine=engine)
    output_path = log_path or Path("runs/verify_amounts.jsonl")
    elements_path = elements_log_path or Path("runs/verify_elements.jsonl")
    out_dir = dump_dir or Path("runs/debug")

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
            if dump_elements:
                elements = _capture_debug_elements(engine.driver)
                _append_elements_log(elements_path, url=url, iteration=1, elements=elements)
                logger.info("verify_once_elements_dumped", url=url, elements_count=len(elements))
            if dump_page_source or dump_body_text:
                _dump_debug_artifacts(
                    out_dir,
                    driver=engine.driver,
                    iteration=1,
                    url=url,
                    dump_page_source=dump_page_source,
                    dump_body_text=dump_body_text,
                )
    finally:
        engine.close()


def run_verify_loop(
    iterations: int = 5,
    interval_seconds: float = 45.0,
    log_path: Optional[Path] = None,
    dump_elements: bool = False,
    elements_log_path: Optional[Path] = None,
    dump_page_source: bool = False,
    dump_body_text: bool = False,
    dump_dir: Optional[Path] = None,
) -> None:
    """Run repeated non-notifying verification passes with a cooldown between runs."""
    settings = Settings.load()
    engine = SeleniumEngine(settings=settings)
    detector = OfferDetector(engine=engine)
    output_path = log_path or Path("runs/verify_amounts.jsonl")
    elements_path = elements_log_path or Path("runs/verify_elements.jsonl")
    out_dir = dump_dir or Path("runs/debug")

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
                if dump_elements:
                    elements = _capture_debug_elements(engine.driver)
                    _append_elements_log(elements_path, url=url, iteration=index, elements=elements)
                    logger.info(
                        "verify_loop_elements_dumped",
                        iteration=index,
                        url=url,
                        elements_count=len(elements),
                    )
                if dump_page_source or dump_body_text:
                    _dump_debug_artifacts(
                        out_dir,
                        driver=engine.driver,
                        iteration=index,
                        url=url,
                        dump_page_source=dump_page_source,
                        dump_body_text=dump_body_text,
                    )

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


def _capture_debug_elements(driver: WebDriver, max_items: int = 120) -> List[Dict[str, str]]:
    """Capture text-bearing page elements relevant to offer analysis."""
    selector = "h1,h2,h3,h4,p,span,div,button,a"
    keywords = ("point", "reward", "earn", "offer", "welcome", "membership")
    out: List[Dict[str, str]] = []
    try:
        elements = driver.find_elements(By.CSS_SELECTOR, selector)
    except WebDriverException as exc:
        logger.warning("verify_elements_capture_failed", error=str(exc))
        return out

    for element in elements:
        try:
            text = " ".join(element.text.split())
        except WebDriverException:
            # DOM can re-render frequently; stale references are expected.
            continue
        if not text:
            continue
        lowered = text.lower()
        if not any(keyword in lowered for keyword in keywords):
            continue
        try:
            out.append(
                {
                    "tag": element.tag_name,
                    "id": element.get_attribute("id") or "",
                    "class": element.get_attribute("class") or "",
                    "text": text,
                }
            )
        except WebDriverException:
            continue
        if len(out) >= max_items:
            break
    return out


def _append_elements_log(path: Path, url: str, iteration: int, elements: List[Dict[str, str]]) -> None:
    """Append captured element snapshot as a JSON Lines row."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "iteration": iteration,
        "url": url,
        "elements": elements,
    }
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _dump_debug_artifacts(
    out_dir: Path,
    *,
    driver: WebDriver,
    iteration: int,
    url: str,
    dump_page_source: bool,
    dump_body_text: bool,
) -> None:
    """Persist raw artifacts for debugging extraction issues."""
    out_dir.mkdir(parents=True, exist_ok=True)

    safe_iter = f"iter{iteration:03d}"
    if dump_page_source:
        html_path = out_dir / f"{safe_iter}.page_source.html"
        html_path.write_text(driver.page_source, encoding="utf-8", errors="ignore")
    if dump_body_text:
        body_path = out_dir / f"{safe_iter}.body_text.txt"
        try:
            body_text = driver.find_element(By.TAG_NAME, "body").text
        except WebDriverException:
            body_text = ""
        body_path.write_text(body_text, encoding="utf-8")

    meta_path = out_dir / f"{safe_iter}.meta.json"
    meta = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "iteration": iteration,
        "url_requested": url,
        "url_current": getattr(driver, "current_url", ""),
        "title": getattr(driver, "title", ""),
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


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
    parser.add_argument(
        "--dump-elements",
        action="store_true",
        help="dump selenium-captured text elements relevant to offers",
    )
    parser.add_argument(
        "--elements-log-path",
        type=Path,
        default=Path("runs/verify_elements.jsonl"),
        help="output JSONL path for captured elements",
    )
    parser.add_argument(
        "--dump-page-source",
        action="store_true",
        help="dump driver.page_source for debugging",
    )
    parser.add_argument(
        "--dump-body-text",
        action="store_true",
        help="dump selenium body visible text for debugging",
    )
    parser.add_argument(
        "--dump-dir",
        type=Path,
        default=Path("runs/debug"),
        help="output directory for debug artifacts",
    )
    args = parser.parse_args()

    if args.notify_test:
        notify_test()
        return
    if args.verify_once:
        run_verify_once(
            log_path=args.verify_log_path,
            dump_elements=args.dump_elements,
            elements_log_path=args.elements_log_path,
            dump_page_source=args.dump_page_source,
            dump_body_text=args.dump_body_text,
            dump_dir=args.dump_dir,
        )
        return
    if args.verify_loop:
        run_verify_loop(
            iterations=args.iterations,
            interval_seconds=args.interval_sec,
            log_path=args.verify_log_path,
            dump_elements=args.dump_elements,
            elements_log_path=args.elements_log_path,
            dump_page_source=args.dump_page_source,
            dump_body_text=args.dump_body_text,
            dump_dir=args.dump_dir,
        )
        return
    app()


__all__: List[str] = ["app", "run_once", "notify_test", "run_verify_once", "run_verify_loop", "main_cli"]


if __name__ == "__main__":
    main_cli()
