from django.urls import URLPattern, URLResolver, include, path, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from common.exceptions import route_not_found
from common.health import HealthView, LiveView, ReadyView

api_v1: list[URLPattern | URLResolver] = [
    path("health", HealthView.as_view(), name="health"),
    path("health/live", LiveView.as_view(), name="health-live"),
    path("health/ready", ReadyView.as_view(), name="health-ready"),
    path("", include("apps.accounts.urls")),
]

urlpatterns = [
    path("api/v1/", include(api_v1)),
    path("api/docs.json", SpectacularAPIView.as_view(), name="openapi-schema"),
    path("api/docs", SpectacularSwaggerView.as_view(url_name="openapi-schema"), name="swagger-ui"),
    # Unknown API paths get the JSON envelope, not Django's HTML page.
    re_path(r"^api/", route_not_found),
]

handler500 = "common.exceptions.server_error"
