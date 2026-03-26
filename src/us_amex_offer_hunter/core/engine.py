from __future__ import annotations

from dataclasses import dataclass
import re
from typing import List, Optional

import structlog
from selenium import webdriver
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.common.by import By

from core.settings import Settings

logger = structlog.get_logger(__name__)


@dataclass
class OfferResult:
    """Structured result for a single offer check."""

    url: str
    found: bool
    amount: Optional[int]
    raw_text: str


class SeleniumEngine:
    """Selenium WebDriver wrapper with proxy and user-agent hooks."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._driver = self._create_driver()

    def _create_driver(self) -> webdriver.Chrome:
        options = ChromeOptions()
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")

        proxy = self._settings.config.proxies
        if proxy.api_key:
            # NOTE: ProxyManager integration will be wired here later.
            logger.info("configuring_proxy", provider=proxy.provider, country=proxy.country)

        try:
            driver = webdriver.Chrome(options=options)
        except WebDriverException as exc:
            logger.error("webdriver_init_failed", error=str(exc))
            raise
        return driver

    @property
    def driver(self) -> webdriver.Chrome:
        return self._driver

    def close(self) -> None:
        try:
            self._driver.quit()
        except WebDriverException as exc:
            logger.warning("webdriver_quit_failed", error=str(exc))


class OfferDetector:
    """High-level offer detection logic built on SeleniumEngine."""

    def __init__(self, engine: SeleniumEngine, targets: Optional[List[int]] = None) -> None:
        self._engine = engine
        self._targets = targets or self._engine._settings.config.targets

    def check_offer(self, url: str) -> OfferResult:
        """Open the URL and attempt to detect a target offer amount."""
        driver = self._engine.driver
        try:
            logger.info("offer_check_start", url=url)
            driver.get(url)
            # TODO: refine selector based on real Amex DOM structure.
            elements = driver.find_elements(By.TAG_NAME, "body")
            body_text = " ".join(el.text for el in elements)
            amount = self._extract_amount(body_text)
            found = amount in self._targets if amount is not None else False
            logger.info("offer_check_done", url=url, found=found, amount=amount)
            return OfferResult(url=url, found=found, amount=amount, raw_text=body_text)
        except WebDriverException as exc:
            logger.error("offer_check_error", url=url, error=str(exc))
            return OfferResult(url=url, found=False, amount=None, raw_text="")

    def _extract_amount(self, text: str) -> Optional[int]:
        """Extract a target offer amount from raw text.

        Supports plain and comma-separated numbers, such as ``300000`` and ``300,000``.
        """
        number_pattern = re.compile(r"\b\d{1,3}(?:,\d{3})+\b|\b\d+\b")
        candidates: List[str] = number_pattern.findall(text)
        for token in candidates:
            normalized = token.replace(",", "")
            try:
                value = int(normalized)
            except ValueError:
                continue
            if value in self._targets:
                return value
        return None


__all__: List[str] = ["SeleniumEngine", "OfferDetector", "OfferResult"]
