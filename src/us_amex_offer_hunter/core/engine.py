from __future__ import annotations

from dataclasses import dataclass
import json
import time
import re
from typing import Any, Iterator, List, Optional

import structlog
from selenium import webdriver
from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

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
        selenium_cfg = self._settings.config.selenium

        if selenium_cfg.headless:
            options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")
        options.add_argument("--window-size=1440,2000")

        if selenium_cfg.disable_automation_flags:
            options.add_argument("--disable-blink-features=AutomationControlled")
            options.add_experimental_option("excludeSwitches", ["enable-automation"])
            options.add_experimental_option("useAutomationExtension", False)

        if selenium_cfg.user_agent:
            options.add_argument(f"--user-agent={selenium_cfg.user_agent}")

        proxy = self._settings.config.proxies
        if proxy.api_key:
            # NOTE: ProxyManager integration will be wired here later.
            logger.info("configuring_proxy", provider=proxy.provider, country=proxy.country)

        try:
            driver = webdriver.Chrome(options=options)
        except WebDriverException as exc:
            logger.error("webdriver_init_failed", error=str(exc))
            raise

        if selenium_cfg.disable_automation_flags:
            # Best-effort: reduce easy webdriver fingerprinting.
            try:
                driver.execute_cdp_cmd(
                    "Page.addScriptToEvaluateOnNewDocument",
                    {
                        "source": """
                        Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
                        """,
                    },
                )
            except Exception:
                logger.debug("webdriver_stealth_injection_failed")
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

            # The referral landing page can show a blocking modal ("You've Been Referred").
            # Best-effort close it so the underlying offer copy becomes accessible.
            self._dismiss_referral_modal(driver=driver)

            # Amex offer content is rendered client-side; wait briefly for it.
            self._wait_for_offer_render(driver=driver, timeout_seconds=18.0)

            # Preferred path (B): repeatedly sample underlying headings and body text
            # until amount appears, because offer copy can render a few seconds late.
            amount, raw_text = self._extract_amount_with_retries(driver=driver, timeout_seconds=12.0)

            # Final fallback: parse window.__INITIAL_STATE__ (embedded JSON), but avoid
            # generic numeric fallback that can pick up unrelated IDs.
            if amount is None:
                amount_from_initial = self._extract_amount_from_initial_state(driver.page_source, strict=True)
                if amount_from_initial is not None:
                    amount = amount_from_initial
                    raw_text = "__INITIAL_STATE__"

            found = amount in self._targets if amount is not None else False
            logger.info("offer_check_done", url=url, found=found, amount=amount)
            return OfferResult(url=url, found=found, amount=amount, raw_text=self._truncate(raw_text))
        except (WebDriverException, TimeoutException) as exc:
            logger.error("offer_check_error", url=url, error=str(exc))
            return OfferResult(url=url, found=False, amount=None, raw_text="")

    def double_check(self, url: str) -> OfferResult:
        """Re-check the same URL in a fresh browser session for false-positive mitigation."""
        retry_engine = SeleniumEngine(settings=self._engine._settings)
        retry_detector = OfferDetector(engine=retry_engine, targets=list(self._targets))
        try:
            return retry_detector.check_offer(url)
        finally:
            retry_engine.close()

    def _extract_amount_with_retries(self, *, driver: webdriver.Chrome, timeout_seconds: float) -> tuple[Optional[int], str]:
        """Retry amount extraction from live DOM for a short window."""
        deadline = time.monotonic() + timeout_seconds
        latest_text = ""

        while time.monotonic() < deadline:
            # 1) Prefer non-dialog headings (works even if modal remains open).
            headings_text = self._get_underlying_headings_text(driver=driver)
            if headings_text.strip():
                latest_text = headings_text
                amount = self._extract_amount(headings_text)
                if amount is not None:
                    return amount, headings_text

            # 2) Fallback to body text.
            try:
                body_text = driver.find_element(By.TAG_NAME, "body").text
            except Exception:
                body_text = ""

            if body_text.strip():
                latest_text = body_text
                amount = self._extract_amount(body_text)
                if amount is not None:
                    return amount, body_text

            time.sleep(0.45)

        return None, latest_text

    def _get_underlying_headings_text(self, *, driver: webdriver.Chrome) -> str:
        """Return concatenated text of headings not inside a modal dialog."""
        try:
            texts: Any = driver.execute_script(
                """
                const nodes = Array.from(document.querySelectorAll('h1,h2,h3,h4'));
                const out = [];
                for (const n of nodes) {
                  if (n.closest('[role="dialog"][aria-modal="true"]')) continue;
                  const t = (n.innerText || n.textContent || '').trim();
                  if (!t) continue;
                  out.push(t);
                }
                return out;
                """
            )
        except Exception:
            return ""

        if not isinstance(texts, list):
            return ""
        cleaned: list[str] = []
        for t in texts:
            if isinstance(t, str) and t.strip():
                cleaned.append(t.strip())
        return "\n".join(cleaned)

    def _dismiss_referral_modal(self, *, driver: webdriver.Chrome) -> None:
        """Best-effort dismiss referral modal that blocks the page."""
        # We intentionally keep this resilient: failures here should not break verification.
        # The referral modal often uses non-standard markup, so we try multiple ways to click "Continue".

        modal_title_xpaths: list[str] = [
            "//*[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'), 'you’ve been referred')]",
            "//*[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'), concat('you', \"'\", 've been referred'))]",
        ]
        dialog_xpaths: list[str] = [
            "//*[@role='dialog' and @aria-modal='true']",
            "//*[@data-qe-id='premium-welcome-popup-modal-container']//*[@role='dialog' and @aria-modal='true']",
        ]
        continue_xpaths: list[str] = [
            # Continue within modal dialog (broad clickable nodes)
            "//*[@role='dialog' and @aria-modal='true']//*[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'), 'continue') and (self::button or self::a or @role='button' or @role='link' or @tabindex)]",
            # Some implementations wrap the text in a non-button element
            "//*[@role='dialog' and @aria-modal='true']//*[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'), 'continue')]",
        ]

        def modal_present() -> bool:
            def has_referred_text(els: list[Any]) -> bool:
                for el in els:
                    try:
                        text = getattr(el, "text", "") or ""
                    except Exception:
                        text = ""
                    if "referred" in text.lower():
                        return True
                return False

            # Prefer title-based detection.
            for xp in modal_title_xpaths:
                try:
                    els = driver.find_elements(By.XPATH, xp)
                except Exception:
                    continue
                if has_referred_text(els):
                    return True

            # Fallback: look for dialog container text.
            for xp in dialog_xpaths:
                try:
                    els = driver.find_elements(By.XPATH, xp)
                except Exception:
                    continue
                if has_referred_text(els):
                    return True

            return False

        if not modal_present():
            return

        # Fast-path: click Continue inside the known modal container using DOM APIs.
        # This avoids issues where Selenium click is intercepted by overlays.
        try:
            clicked_by_js = bool(
                driver.execute_script(
                    """
                    const root = document.querySelector("[data-qe-id='premium-welcome-popup-modal-container']");
                    if (!root) return false;
                    const dialog = root.querySelector("[role='dialog'][aria-modal='true']") || root;
                    const nodes = Array.from(dialog.querySelectorAll("button,a,[role='button'],[role='link']"));
                    for (const n of nodes) {
                      const t = (n.textContent || "").trim().toLowerCase();
                      if (t === "continue" || t.includes("continue")) { n.click(); return true; }
                    }
                    return false;
                    """
                )
            )
            if clicked_by_js:
                time.sleep(0.6)
        except Exception:
            pass

        # Prefer clicking the Continue label, retrying until the dialog disappears.
        click_deadline = time.monotonic() + 12.0
        while time.monotonic() < click_deadline:
            if not modal_present():
                return

            clicked = False
            for xp in continue_xpaths:
                try:
                    for el in driver.find_elements(By.XPATH, xp):
                        try:
                            # Sometimes modal is already closing; stale elements are expected.
                            if hasattr(el, "is_displayed") and not el.is_displayed():
                                continue
                        except Exception:
                            # If is_displayed fails, just try clicking.
                            pass
                        try:
                            el.click()
                            clicked = True
                            time.sleep(0.4)
                            break
                        except Exception:
                            # Selenium click can be blocked by overlays; fall back to JS click.
                            try:
                                driver.execute_script("arguments[0].click();", el)
                                clicked = True
                                time.sleep(0.4)
                                break
                            except Exception:
                                continue
                except Exception:
                    continue
                if clicked:
                    break

            if clicked:
                # Wait a short moment for the dialog to disappear.
                settle_deadline = time.monotonic() + 4.0
                while time.monotonic() < settle_deadline:
                    try:
                        if not any(driver.find_elements(By.XPATH, xp) for xp in dialog_xpaths):
                            return
                    except Exception:
                        if not modal_present():
                            return
                    time.sleep(0.2)

            # Could not click or dialog remains; wait and retry.
            time.sleep(0.35)

        # Last resort: try ESC to close dialogs.
        try:
            body = driver.find_element(By.TAG_NAME, "body")
            body.send_keys(Keys.ESCAPE)
            time.sleep(0.5)
        except Exception:
            return

    def _wait_for_offer_render(self, *, driver: webdriver.Chrome, timeout_seconds: float) -> None:
        """Wait until the client-rendered offer content is likely available."""
        # Unit tests use a DummyDriver; skipping avoids wasting `timeout_seconds` for negative cases.
        if not hasattr(driver, "execute_script"):
            logger.debug("offer_render_wait_skipped_non_selenium_driver", timeout_seconds=timeout_seconds)
            return

        deadline = time.monotonic() + timeout_seconds

        def condition(d: Any) -> bool:
            try:
                body_text = d.find_element(By.TAG_NAME, "body").text
                if body_text and body_text.strip() and ("earn" in body_text.lower() or "points" in body_text.lower()):
                    return True
            except Exception:
                # Dummy drivers in unit tests may not implement full Selenium behavior.
                pass

            try:
                source = d.page_source
                lowered = source.lower()
                # Avoid exiting early just because `__INITIAL_STATE__` exists.
                # Require something that looks like the actual offer copy.
                return bool(
                    re.search(
                        r"earn\s+(?:up\s+to\s+)?\d{1,3}(?:,\d{3})+\s+(?:membership\s*rewards(?:\s*®)?\s*)?points",
                        lowered,
                        flags=re.IGNORECASE,
                    )
                )
            except Exception:
                return False

        while time.monotonic() < deadline:
            if condition(driver):
                return
            time.sleep(0.35)

        # Best-effort: we still attempt extraction paths after the wait.
        logger.warning("offer_render_wait_timeout_best_effort", timeout_seconds=timeout_seconds)
        return

    def _truncate(self, text: str, *, limit: int = 2500) -> str:
        """Truncate long raw strings for debug payload size control."""
        if len(text) <= limit:
            return text
        return text[:limit] + "...(truncated)"

    def _extract_amount_from_initial_state(self, page_source: str, *, strict: bool = False) -> Optional[int]:
        """Extract points amount by parsing `window.__INITIAL_STATE__`.

        When `strict=True`, avoids generic numeric fallbacks and only accepts values
        that clearly look like points offers (e.g. "Earn 200,000 ... Points").
        """
        payload = self._extract_initial_state_payload(page_source)
        if payload is None:
            return None

        amount = self._extract_amount_strict(payload) if strict else self._extract_amount(payload)
        if amount is not None:
            return amount

        data: Any = payload
        # Best-effort JSON decode(s): Amex sometimes embeds JSON as a quoted string.
        for _ in range(3):
            if not isinstance(data, str):
                break
            stripped = data.strip()
            if not stripped:
                break
            if stripped[0] not in ("{", "[", '"'):
                break
            try:
                data = json.loads(stripped)
            except json.JSONDecodeError:
                break

        for s in self._iter_string_values(data):
            amount = self._extract_amount_strict(s) if strict else self._extract_amount(s)
            if amount is not None:
                return amount

        return None

    def _extract_amount_strict(self, text: str) -> Optional[int]:
        """Extract points amount without generic numeric fallback."""
        # Reuse the same logic but stop before the final broad numeric scan.
        # 1) Explicit targets (safe)
        for target in sorted(self._targets, reverse=True):
            comma = f"{target:,}"
            plain = str(target)
            target_pattern = re.compile(
                rf"(?<!\$)\b(?:{re.escape(comma)}|{re.escape(plain)})\b",
                re.IGNORECASE,
            )
            if target_pattern.search(text):
                return int(target)

        earn_points_pattern = re.compile(
            r"earn\s+(?:up\s+to\s+)?(\d{1,3}(?:,\d{3})+|\d+)\s*(?:membership\s*rewards(?:\s*®)?\s*)?points",
            re.IGNORECASE,
        )
        candidates: List[int] = []
        for match in earn_points_pattern.findall(text):
            normalized = match.replace(",", "")
            try:
                candidates.append(int(normalized))
            except ValueError:
                continue
        if candidates:
            return max(candidates)

        points_pattern = re.compile(
            r"(?<!\$)(\d{1,3}(?:,\d{3})+|\d+)\s*(?:membership\s*rewards(?:\s*®)?\s*)?points(?![\s-]*back)",
            re.IGNORECASE,
        )
        candidates = []
        for match in points_pattern.findall(text):
            normalized = match.replace(",", "")
            try:
                candidates.append(int(normalized))
            except ValueError:
                continue
        if candidates:
            return max(candidates)

        return None

    def _extract_initial_state_payload(self, page_source: str) -> Optional[str]:
        """Extract the payload assigned to `window.__INITIAL_STATE__`."""
        key = "window.__INITIAL_STATE__"
        key_idx = page_source.find(key)
        if key_idx < 0:
            return None

        eq_idx = page_source.find("=", key_idx)
        if eq_idx < 0:
            return None

        i = eq_idx + 1
        while i < len(page_source) and page_source[i].isspace():
            i += 1
        if i >= len(page_source):
            return None

        # Case 1: object literal
        if page_source[i] == "{":
            start_idx = i
            end_idx = self._find_matching_brace(page_source, start_idx)
            if end_idx is None:
                return None
            return page_source[start_idx : end_idx + 1]

        # Case 2: JSON string literal
        if page_source[i] == '"':
            end_quote = self._find_string_end(page_source, i)
            if end_quote is None:
                return None
            quoted = page_source[i : end_quote + 1]
            try:
                decoded: Any = json.loads(quoted)
            except json.JSONDecodeError:
                return None
            if isinstance(decoded, str):
                return decoded
            return json.dumps(decoded, ensure_ascii=False)

        # Unknown / unsupported encoding
        return None

    def _find_matching_brace(self, text: str, start_idx: int) -> Optional[int]:
        """Find the matching closing brace for a JSON-like object literal."""
        depth = 0
        in_string: Optional[str] = None
        escaped = False

        for i in range(start_idx, len(text)):
            ch = text[i]

            if in_string is not None:
                if escaped:
                    escaped = False
                    continue
                if ch == "\\":
                    escaped = True
                    continue
                if ch == in_string:
                    in_string = None
                continue

            if ch in ("'", '"'):
                in_string = ch
                continue

            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return i

        return None

    def _find_string_end(self, text: str, start_idx: int) -> Optional[int]:
        """Find the end quote index of a JSON string literal starting at `start_idx`."""
        if start_idx >= len(text) or text[start_idx] != '"':
            return None
        escaped = False
        for i in range(start_idx + 1, len(text)):
            ch = text[i]
            if escaped:
                escaped = False
                continue
            if ch == "\\":
                escaped = True
                continue
            if ch == '"':
                return i
        return None

    def _iter_string_values(self, data: Any) -> Iterator[str]:
        """Yield string values from nested JSON-like data."""
        if isinstance(data, str):
            yield data
        elif isinstance(data, list):
            for item in data:
                yield from self._iter_string_values(item)
        elif isinstance(data, dict):
            for value in data.values():
                yield from self._iter_string_values(value)

    def _extract_amount(self, text: str) -> Optional[int]:
        """Extract the most likely points amount from raw text.

        Prioritizes numbers appearing close to ``points`` and supports formats like
        ``200000`` and ``200,000``.
        """
        # 1) Highest priority: explicit target amounts shown on the page, excluding
        #    dollar-denominated spending thresholds (e.g. "$200,000").
        for target in sorted(self._targets, reverse=True):
            comma = f"{target:,}"
            plain = str(target)
            target_pattern = re.compile(
                rf"(?<!\$)\b(?:{re.escape(comma)}|{re.escape(plain)})\b",
                re.IGNORECASE,
            )
            if target_pattern.search(text):
                return int(target)

        earn_points_pattern = re.compile(
            r"earn\s+(?:up\s+to\s+)?(\d{1,3}(?:,\d{3})+|\d+)\s*(?:membership\s*rewards(?:\s*®)?\s*)?points",
            re.IGNORECASE,
        )
        earn_candidates: List[int] = []
        for match in earn_points_pattern.findall(text):
            normalized = match.replace(",", "")
            try:
                value = int(normalized)
            except ValueError:
                continue
            earn_candidates.append(value)

        if earn_candidates:
            return max(earn_candidates)

        # Secondary fallback: generic "<number> ... points" while filtering
        # "points back" promo clauses that can include unrelated large numbers.
        points_pattern = re.compile(
            r"(?<!\$)(\d{1,3}(?:,\d{3})+|\d+)\s*(?:membership\s*rewards(?:\s*®)?\s*)?points(?![\s-]*back)",
            re.IGNORECASE,
        )
        points_candidates: List[int] = []
        for match in points_pattern.findall(text):
            normalized = match.replace(",", "")
            try:
                value = int(normalized)
            except ValueError:
                continue
            points_candidates.append(value)

        if points_candidates:
            return max(points_candidates)

        # Fallback for pages that omit the explicit "points" suffix.
        number_pattern = re.compile(r"\b\d{1,3}(?:,\d{3})+\b|\b\d+\b")
        fallback: List[int] = []
        lowered_text = text.lower()
        for token_match in number_pattern.finditer(text):
            token = token_match.group(0)
            normalized = token.replace(",", "")
            try:
                value = int(normalized)
            except ValueError:
                continue
            # Heuristic: plausible points range for offer pages.
            if 10_000 <= value <= 1_000_000:
                start, end = token_match.span()
                left = lowered_text[max(0, start - 40) : start]
                right = lowered_text[end : min(len(lowered_text), end + 60)]
                ctx = f"{left} {right}"
                if ("points" not in ctx) and ("membership" not in ctx):
                    continue
                if "points back" in ctx:
                    continue
                fallback.append(value)

        if fallback:
            return max(fallback)

        return None


__all__: List[str] = ["SeleniumEngine", "OfferDetector", "OfferResult"]
