"""
Celery app. Workers: `celery -A config worker`; schedules: `celery -A config beat` (exactly one).
Periodic tasks (dispatch sweep, payment window, rewards, purges) are added to `beat_schedule`
by the phases that own them (docs/django-migration/06 §6.3).
"""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

app = Celery("bitebox")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
app.conf.beat_schedule = {}
