from __future__ import annotations

import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import structlog
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver

from core.settings import ConditionProfile, Settings
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
    profile_name: Optional[str] = None,
) -> None:
    """Run one non-notifying verification pass and optionally persist results."""
    settings, profile = _load_settings_for_profile(profile_name)
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
                profile=profile,
            )
            _append_verify_log(
                output_path,
                result=result,
                iteration=1,
                settings=settings,
                condition_label=profile.label,
                profile_name=profile.name,
                driver=engine.driver,
            )
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
    stop_on_hit: bool = False,
    notify_on_hit: bool = False,
    profile_name: Optional[str] = None,
) -> bool:
    """Run repeated non-notifying verification passes with a cooldown between runs."""
    settings, profile = _load_settings_for_profile(profile_name)
    engine = SeleniumEngine(settings=settings)
    detector = OfferDetector(engine=engine)
    notifier = DiscordNotifier(settings=settings) if notify_on_hit else None
    output_path = log_path or Path("runs/verify_amounts.jsonl")
    elements_path = elements_log_path or Path("runs/verify_elements.jsonl")
    out_dir = dump_dir or Path("runs/debug")
    hit_found = False

    try:
        for index in range(1, iterations + 1):
            logger.info(
                "verify_loop_iteration_start",
                iteration=index,
                iterations=iterations,
                profile=profile.name,
            )
            for url in settings.config.urls:
                result = detector.check_offer(url)
                logger.info(
                    "verify_loop_result",
                    iteration=index,
                    url=result.url,
                    found=result.found,
                    amount=result.amount,
                    profile=profile.name,
                )
                _append_verify_log(
                    output_path,
                    result=result,
                    iteration=index,
                    settings=settings,
                    condition_label=profile.label,
                    profile_name=profile.name,
                    driver=engine.driver,
                )
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
                if stop_on_hit and result.found:
                    hit_found = True
                    logger.info(
                        "hit_detected_stopping",
                        iteration=index,
                        url=result.url,
                        amount=result.amount,
                        profile=profile.name,
                    )
                    if notifier is not None:
                        verified = detector.double_check(result.url)
                        logger.info(
                            "hit_double_check_result",
                            url=result.url,
                            first_amount=result.amount,
                            verified=verified.found,
                            verified_amount=verified.amount,
                        )
                        if verified.found:
                            notifier.notify_offer_found(f"Verified target offer {verified.amount} at {verified.url}")
                        else:
                            logger.warning(
                                "false_positive_suspected",
                                url=result.url,
                                first_amount=result.amount,
                                second_amount=verified.amount,
                            )
                    break

            if hit_found:
                break

            if index < iterations:
                time.sleep(interval_seconds)
    finally:
        engine.close()
    return hit_found


def _append_verify_log(
    path: Path,
    *,
    result: OfferResult,
    iteration: int,
    settings: Settings,
    condition_label: str,
    profile_name: str,
    driver: Optional[WebDriver],
) -> None:
    """Append a single verification result row as JSON Lines."""
    path.parent.mkdir(parents=True, exist_ok=True)
    runtime_meta = _runtime_metadata(driver)
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "iteration": iteration,
        "url": result.url,
        "found": result.found,
        "amount": result.amount,
        "headless": settings.config.selenium.headless,
        "user_agent": settings.config.selenium.user_agent or "",
        "profile_name": profile_name,
        "condition_label": condition_label,
        "runtime": runtime_meta,
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


def run_verify_summary(log_path: Optional[Path] = None, latest: Optional[int] = None) -> int:
    """Print condition-based summary for verification JSONL."""
    path = log_path or Path("runs/verify_amounts.jsonl")
    if not path.exists():
        logger.warning("verify_summary_no_log_file", path=str(path))
        return 1

    rows: List[Dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            rows.append(payload)

    if not rows:
        logger.warning("verify_summary_no_rows", path=str(path))
        return 1

    frame = pd.DataFrame(rows)
    if latest is not None and latest > 0:
        frame = frame.tail(latest)
    if "condition_label" not in frame.columns:
        frame["condition_label"] = "unknown"
    else:
        frame["condition_label"] = frame["condition_label"].fillna("unknown")
        frame.loc[frame["condition_label"] == "", "condition_label"] = "unknown"

    if "amount" not in frame.columns:
        frame["amount"] = None
    if "found" not in frame.columns:
        frame["found"] = False

    summary = (
        frame.groupby("condition_label", dropna=False)
        .agg(
            trials=("found", "size"),
            hits=("found", "sum"),
            null_amount=("amount", lambda s: int(s.isna().sum())),
        )
        .reset_index()
    )
    summary["hit_rate"] = (summary["hits"] / summary["trials"]).round(4)
    print(summary.to_string(index=False))

    amount_dist = (
        frame.assign(amount=frame["amount"].fillna("none").astype(str))
        .groupby(["condition_label", "amount"], dropna=False)
        .size()
        .reset_index(name="count")
        .sort_values(["condition_label", "count"], ascending=[True, False])
    )
    print("\namount_distribution")
    print(amount_dist.to_string(index=False))
    return 0


def run_verify_ab(
    profile_names: List[str],
    *,
    iterations: int,
    interval_seconds: float,
    cooldown_seconds: float,
    log_path: Optional[Path],
    dump_elements: bool,
    elements_log_path: Optional[Path],
    dump_page_source: bool,
    dump_body_text: bool,
    dump_dir: Optional[Path],
) -> bool:
    """Run verify-loop sequentially across profile names."""
    any_hit = False
    for index, profile_name in enumerate(profile_names):
        logger.info("verify_ab_profile_start", profile=profile_name, profile_index=index + 1, total=len(profile_names))
        profile_hit = run_verify_loop(
            iterations=iterations,
            interval_seconds=interval_seconds,
            log_path=log_path,
            dump_elements=dump_elements,
            elements_log_path=elements_log_path,
            dump_page_source=dump_page_source,
            dump_body_text=dump_body_text,
            dump_dir=dump_dir,
            stop_on_hit=False,
            notify_on_hit=False,
            profile_name=profile_name,
        )
        any_hit = any_hit or profile_hit
        if index < len(profile_names) - 1:
            logger.info("verify_ab_cooldown", seconds=cooldown_seconds)
            time.sleep(cooldown_seconds)
    return any_hit


def _runtime_metadata(driver: Optional[WebDriver]) -> Dict[str, str]:
    browser_version = "unknown"
    if driver is not None:
        try:
            capabilities = getattr(driver, "capabilities", {})
            if isinstance(capabilities, dict):
                browser_version = str(capabilities.get("browserVersion") or capabilities.get("version") or "unknown")
        except Exception:
            browser_version = "unknown"
    return {
        "os": platform.platform(),
        "python_version": platform.python_version(),
        "browser_version": browser_version,
    }


def _load_settings_for_profile(profile_name: Optional[str]) -> Tuple[Settings, ConditionProfile]:
    settings = Settings.load()
    if profile_name is None:
        return settings, ConditionProfile(name="default", label="default")
    profile = settings.config.profiles.get(profile_name)
    if profile is None:
        raise RuntimeError(f"Unknown profile: {profile_name}")
    profile.name = profile_name
    if profile.selenium is not None:
        settings.config.selenium = profile.selenium
    if profile.proxies is not None:
        settings.config.proxies = profile.proxies
    if profile.label:
        return settings, profile
    profile.label = profile_name
    return settings, profile


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
        "--verify-summary",
        action="store_true",
        help="summarize verify JSONL results by condition label",
    )
    parser.add_argument(
        "--verify-ab",
        action="store_true",
        help="run verify-loop sequentially for multiple profiles",
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
        "--cooldown-sec",
        type=float,
        default=300.0,
        help="cooldown seconds between profile runs in verify-ab (default: 300)",
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
    parser.add_argument(
        "--stop-on-hit",
        action="store_true",
        default=False,
        help="stop verify-loop immediately after a found=true result",
    )
    parser.add_argument(
        "--notify-on-hit",
        action="store_true",
        default=False,
        help="when combined with --stop-on-hit, double-check and notify verified hits",
    )
    parser.add_argument(
        "--profile",
        type=str,
        default=None,
        help="profile name from config.yaml profiles section",
    )
    parser.add_argument(
        "--profiles",
        type=str,
        default="",
        help="comma-separated profile names for --verify-ab",
    )
    parser.add_argument(
        "--latest",
        type=int,
        default=0,
        help="only summarize latest N rows (0 means all)",
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
            profile_name=args.profile,
        )
        return
    if args.verify_summary:
        rc = run_verify_summary(log_path=args.verify_log_path, latest=args.latest if args.latest > 0 else None)
        raise SystemExit(rc)
    if args.verify_loop:
        hit_found = run_verify_loop(
            iterations=args.iterations,
            interval_seconds=args.interval_sec,
            log_path=args.verify_log_path,
            dump_elements=args.dump_elements,
            elements_log_path=args.elements_log_path,
            dump_page_source=args.dump_page_source,
            dump_body_text=args.dump_body_text,
            dump_dir=args.dump_dir,
            stop_on_hit=args.stop_on_hit,
            notify_on_hit=args.notify_on_hit,
            profile_name=args.profile,
        )
        raise SystemExit(0 if hit_found else 1)
    if args.verify_ab:
        profiles = [name.strip() for name in args.profiles.split(",") if name.strip()]
        if not profiles:
            raise RuntimeError("--verify-ab requires --profiles with comma-separated names")
        any_hit = run_verify_ab(
            profile_names=profiles,
            iterations=args.iterations,
            interval_seconds=args.interval_sec,
            cooldown_seconds=args.cooldown_sec,
            log_path=args.verify_log_path,
            dump_elements=args.dump_elements,
            elements_log_path=args.elements_log_path,
            dump_page_source=args.dump_page_source,
            dump_body_text=args.dump_body_text,
            dump_dir=args.dump_dir,
        )
        raise SystemExit(0 if any_hit else 1)
    app()


__all__: List[str] = [
    "app",
    "run_once",
    "notify_test",
    "run_verify_once",
    "run_verify_loop",
    "run_verify_summary",
    "run_verify_ab",
    "main_cli",
]


if __name__ == "__main__":
    main_cli()
