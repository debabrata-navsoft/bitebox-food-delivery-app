from typing import Any

from channels.db import database_sync_to_async

from apps.accounts.authentication import user_for_token
from common.api import ApiError


@database_sync_to_async
def _user(token: str) -> Any | None:
    try:
        return user_for_token(token)
    except ApiError:
        return None


async def user_from_token(token: Any) -> Any | None:
    """The active user an access token belongs to (same checks as HTTP), or None."""
    if not isinstance(token, str) or not token:
        return None
    return await _user(token)
