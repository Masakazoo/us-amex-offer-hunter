"""
Thin re-export layer for core engine modules.

This package exists at the top-level ``src/core`` to match the expected
Cursor project layout, while the actual implementation lives under
``us_amex_offer_hunter.core``.
"""

from us_amex_offer_hunter.core.engine import OfferDetector, SeleniumEngine

__all__ = ["OfferDetector", "SeleniumEngine"]

