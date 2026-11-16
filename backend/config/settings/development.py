"""Local development: DEBUG on, a dev-only secret key if none is set."""

from .base import *

DEBUG = True
SECRET_KEY = SECRET_KEY or "dev-only-insecure-key-never-use-in-production"
JWT_SECRET = JWT_SECRET or "dev-only-jwt-secret-that-is-long-enough-0123456789"
REFRESH_COOKIE_SECURE = False  # http://localhost
ALLOWED_HOSTS = ALLOWED_HOSTS or ["localhost", "127.0.0.1", "[::1]"]

# `manage.py runserver` serves ASGI through Daphne (requirements/dev.txt), so the /ws/
# WebSocket works there too, not only under uvicorn.
INSTALLED_APPS = ["daphne", *INSTALLED_APPS]


def _redis_running(url: str) -> bool:
    """Whether something listens at the Redis address (a quick TCP check, no command sent)."""
    import socket
    from urllib.parse import urlsplit

    parts = urlsplit(url)
    try:
        with socket.create_connection((parts.hostname or "localhost", parts.port or 6379), 0.3):
            return True
    except OSError:
        return False


# Without Redis (e.g. a laptop with no Docker): WebSockets use an in-process channel layer and
# Celery tasks run inline, so live updates and notifications still work. Single process only:
# never for staging or production, where events must cross processes. Scheduled jobs (the
# dispatch and rewards sweeps) need Redis with a Celery worker and beat.
REDIS_RUNNING = _redis_running(REDIS_URL)
if env.bool("CHANNEL_LAYER_IN_MEMORY", default=False) or not REDIS_RUNNING:
    CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
if not REDIS_RUNNING:
    CELERY_TASK_ALWAYS_EAGER = True
