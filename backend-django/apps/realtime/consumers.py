"""
The app's single WebSocket, `/ws/` (replaces Socket.IO; docs/django-migration/02 §2.6).

Protocol (JSON frames):
- client → `{"type": "auth", "token": "<access token>"}` within AUTH_TIMEOUT_SECONDS, otherwise
  the server closes with 4401. A bad token also closes with 4401 (the client refreshes and
  reconnects). The token is never put in the URL, so it never lands in access logs.
- client → `{"type": "ping"}`, server → `{"type": "pong", "at": ...}`: the heartbeat, allowed
  before auth.
- server → `{"type": "ready"}` once authenticated.
Rooms and events (`order:updated`, `track:join`, `rider:location`, ...) are added in Phase 7.
"""

import asyncio
import contextlib
from datetime import UTC, datetime
from typing import Any

from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .auth import user_from_token

AUTH_TIMEOUT_SECONDS = 5.0
CLOSE_UNAUTHORIZED = 4401


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class RealtimeConsumer(AsyncJsonWebsocketConsumer):
    user: Any = None
    _auth_deadline: asyncio.Task[None] | None = None

    async def connect(self) -> None:
        await self.accept()
        self._auth_deadline = asyncio.create_task(self._close_if_unauthenticated())

    async def disconnect(self, code: int) -> None:
        if self._auth_deadline:
            self._auth_deadline.cancel()

    async def _close_if_unauthenticated(self) -> None:
        await asyncio.sleep(AUTH_TIMEOUT_SECONDS)
        if self.user is None:
            await self.close(code=CLOSE_UNAUTHORIZED)

    async def receive_json(self, content: Any, **kwargs: Any) -> None:
        kind = content.get("type") if isinstance(content, dict) else None
        if kind == "ping":
            await self.send_json({"type": "pong", "at": _now()})
            return
        if kind == "auth":
            user = await user_from_token(content.get("token"))
            if user is None:
                await self.close(code=CLOSE_UNAUTHORIZED)
                return
            self.user = user
            if self._auth_deadline:
                self._auth_deadline.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await self._auth_deadline
            await self.send_json({"type": "ready", "at": _now()})
            return
        if self.user is None:
            await self.close(code=CLOSE_UNAUTHORIZED)
            return
        await self.send_json({"type": "error", "code": "UNKNOWN_TYPE", "at": _now()})
