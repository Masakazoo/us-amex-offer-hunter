from __future__ import annotations

from typing import Protocol


class NotifierProtocol(Protocol):
    """Protocol for notification backends."""

    def notify_offer_found(
        self, message: str
    ) -> None:  # pragma: no cover - interface only
        """Notify when a target offer has been found."""

    def notify_error(self, message: str) -> None:  # pragma: no cover - interface only
        """Notify when an error occurs in the system."""


__all__ = ["NotifierProtocol"]
