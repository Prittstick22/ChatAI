"""In-memory WebSocket hub: fan-out of chat events, presence and typing.

Single-process by design. Clients connected to another chat-api instance would not
see each other's events; scaling out needs a shared pub/sub (see docs/ARCHITECTURE.md).
"""

import asyncio
from contextlib import suppress
from dataclasses import dataclass, field

from fastapi import WebSocket

SEND_TIMEOUT = 5


@dataclass(eq=False)
class Client:
    ws: WebSocket
    user: str | None = None
    # None receives events for every room, matching the original global /ws.
    room: str | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def wants(self, room: str | None) -> bool:
        return room is None or self.room is None or self.room == room


class Hub:
    def __init__(self) -> None:
        self.clients: set[Client] = set()

    def online(self) -> list[str]:
        return sorted({c.user for c in self.clients if c.user})

    async def join(self, client: Client) -> None:
        self.clients.add(client)
        await self.broadcast_presence()

    def leave(self, client: Client) -> None:
        # Synchronous on purpose: it must still run when the socket's task is being
        # cancelled. The caller schedules broadcast_presence() separately.
        self.clients.discard(client)

    async def broadcast_presence(self) -> None:
        await self.broadcast({"type": "presence", "online": self.online()})

    async def send(self, client: Client, event: dict) -> bool:
        try:
            async with client.lock:
                await asyncio.wait_for(client.ws.send_json(event), SEND_TIMEOUT)
            return True
        except Exception:
            # A client that can't keep up is disconnected rather than silently
            # skipped, so it reconnects and refetches what it missed.
            self.clients.discard(client)
            with suppress(Exception):
                await asyncio.wait_for(client.ws.close(code=1011), 1)
            return False

    async def broadcast(
        self, event: dict, room: str | None = None, exclude: Client | None = None
    ) -> None:
        """Send to every client subscribed to `room` (all clients when room is None)."""
        targets = [c for c in self.clients if c is not exclude and c.wants(room)]
        await asyncio.gather(*(self.send(c, event) for c in targets))
