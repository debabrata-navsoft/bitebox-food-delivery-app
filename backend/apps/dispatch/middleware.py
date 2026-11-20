"""
Runs the dispatch sweep from API traffic, at most once per `sweep_interval_seconds` per process,
for hosts without Celery Beat (`runserver`, Vercel); otherwise offers never expire and the order
timeouts never apply. The sweep is compare-and-set throughout, so overlapping runs are safe.
Removed at start-up when `DISPATCH_SWEEP_ON_REQUESTS` is False (tests call `sweep(now)`).
"""

import logging
import time
from collections.abc import Callable

from django.conf import settings
from django.core.exceptions import MiddlewareNotUsed
from django.http import HttpRequest, HttpResponse

from .config import DISPATCH
from .services import sweep

log = logging.getLogger(__name__)


class DispatchSweepMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        if not settings.DISPATCH_SWEEP_ON_REQUESTS:
            raise MiddlewareNotUsed
        self.get_response = get_response
        self.next_at = 0.0

    def __call__(self, request: HttpRequest) -> HttpResponse:
        now = time.monotonic()
        if request.path.startswith("/api/") and now >= self.next_at:
            self.next_at = now + DISPATCH["sweep_interval_seconds"]
            try:  # before the view, so this response already shows the result
                sweep()
            except Exception:
                log.exception("Dispatch sweep failed")
        return self.get_response(request)
