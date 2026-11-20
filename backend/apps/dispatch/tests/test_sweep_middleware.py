from unittest import mock

import pytest
from django.core.exceptions import MiddlewareNotUsed
from django.http import HttpResponse
from django.test import RequestFactory, override_settings

from apps.dispatch.middleware import DispatchSweepMiddleware

get = RequestFactory().get


def _middleware() -> DispatchSweepMiddleware:
    return DispatchSweepMiddleware(lambda request: HttpResponse("ok"))


@override_settings(DISPATCH_SWEEP_ON_REQUESTS=True)
def test_api_traffic_sweeps_at_most_once_per_interval_and_survives_failures() -> None:
    middleware = _middleware()
    clock = [100.0, 105.0, 116.0, 200.0, 300.0]
    with (
        mock.patch("apps.dispatch.middleware.sweep") as sweep,
        mock.patch("apps.dispatch.middleware.time.monotonic", side_effect=clock),
    ):
        for _ in range(3):
            middleware(get("/api/v1/my/restaurant/orders/board"))
        assert sweep.call_count == 2  # at 100 s and 116 s, not 105 s
        middleware(get("/admin/"))  # not the API
        assert sweep.call_count == 2
        sweep.side_effect = RuntimeError("db down")
        assert middleware(get("/api/v1/health")).status_code == 200


def test_left_out_when_turned_off() -> None:  # the test settings turn it off
    with pytest.raises(MiddlewareNotUsed):
        _middleware()
