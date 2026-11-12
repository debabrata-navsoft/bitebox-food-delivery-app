"""
Tests. Never touches the developer's database:
- TEST_DATABASE_URL (PostgreSQL), whose database name must end in "_test" (CI sets it), or
- an in-memory SQLite database when it is not set. That is enough for the skeleton; from
  Phase 4 (PostGIS models) the suite needs TEST_DATABASE_URL.
Redis, Celery and Channels run in-process.
"""

from django.core.exceptions import ImproperlyConfigured

from .base import *

SECRET_KEY = "test-only-secret-key-with-at-least-32-characters"  # noqa: S105
JWT_SECRET = "test-only-jwt-secret-that-is-long-enough-0123456789"  # noqa: S105
REFRESH_COOKIE_SECURE = False
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
# Fast hashing in tests (same algorithm name, tiny cost).
PASSWORD_HASHERS = [
    "common.testing.FastArgon2PasswordHasher",
    "django.contrib.auth.hashers.BCryptPasswordHasher",
]
AUTH_RATE_LIMIT = "1000/900s"
SENSITIVE_RATE_LIMIT = "1000/900s"
DEBUG = False
ALLOWED_HOSTS = ["testserver", "localhost"]

_test_db = env.str("TEST_DATABASE_URL", default="")
if _test_db:
    _db = env.db_url_config(_test_db)
    if not str(_db.get("NAME", "")).endswith("_test"):
        raise ImproperlyConfigured(
            "TEST_DATABASE_URL must point at a database whose name ends in _test"
        )
    DATABASES = {"default": {**_db, "TEST": {"NAME": _db["NAME"]}}}
else:
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}

CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
CELERY_BROKER_URL = "memory://"
REDIS_URL = "redis://redis.invalid:6379/0"  # tests replace the Redis client; never a real server
LOGGING = {**LOGGING, "root": {"handlers": ["console"], "level": "WARNING"}}
