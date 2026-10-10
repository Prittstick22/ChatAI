"""Automatic catch-up summaries. A room is summarised when it has had SUMMARY_EVERY new
messages (default 10), or when it goes quiet for SUMMARY_QUIET seconds (default 30)
after at least one new message. The summary is pushed to the room as a `summary`
event and kept, so a tab that opens later can fetch the latest one.

main.post_message schedules after_message() as a background task, so summarising never
delays sending. Summaries live in memory: a restart starts over.
"""

import asyncio
import os
from collections.abc import Awaitable, Callable

import store
from realtime import Hub

Ask = Callable[[str, dict, dict], Awaitable[dict]]


class Summariser:
    def __init__(self, hub: Hub, ask: Ask):
        self.hub = hub
        self.ask = ask
        self.every = int(os.getenv("SUMMARY_EVERY", "10"))
        self.quiet = float(os.getenv("SUMMARY_QUIET", "30"))
        self.pending: dict[str, int] = {}  # room -> messages since the last summary
        self.newest: dict[str, int] = {}  # room -> newest message id seen
        self.latest: dict[str, dict] = {}  # room -> latest summary
        self.locks: dict[str, asyncio.Lock] = {}

    async def after_message(self, message: dict) -> None:
        room, message_id = message["room"], message["id"]
        self.newest[room] = max(self.newest.get(room, 0), message_id)
        self.pending[room] = self.pending.get(room, 0) + 1
        if self.pending[room] >= self.every:
            await self._summarise(room, "messages")
            return
        await asyncio.sleep(self.quiet)
        if self.newest.get(room) == message_id:  # nobody has posted since
            await self._summarise(room, "quiet")

    def forget(self, room: str | None = None) -> None:
        """Drop a room's summary and counts (every room's by default) once its
        messages are replaced (devtools.py)."""
        for state in (self.pending, self.newest, self.latest):
            if room is None:
                state.clear()
            else:
                state.pop(room, None)

    async def _summarise(self, room: str, trigger: str) -> None:
        async with self.locks.setdefault(room, asyncio.Lock()):
            if self.pending.get(room):  # otherwise another trigger covered them
                await self._run(room, trigger)

    async def summarise_now(self, room: str) -> dict | None:
        """On demand ("Summarise now"); shared with the room like any other."""
        async with self.locks.setdefault(room, asyncio.Lock()):
            return await self._run(room, "manual")

    async def _run(self, room: str, trigger: str) -> dict | None:
        history = store.recent_for_ai(room)
        if not history:
            return None
        # Reset before the AI call, so messages sent meanwhile count towards the next
        # summary.
        self.pending[room] = 0
        result = await self.ask("/digest", {"messages": history}, {})
        text = result.get("summary")
        if not isinstance(text, str) or not text.strip():
            return None
        summary = {
            "room": room,
            "text": text.strip(),
            # Structured catch-up from the AI service; absent from older versions.
            "headline": result.get("headline")
            if isinstance(result.get("headline"), str)
            else None,
            **{key: _dicts(result.get(key)) for key in STRUCTURED},
            "upto_message_id": history[-1]["id"],
            "message_count": len(history),
            "trigger": trigger,
            "created_at": store.now(),
        }
        self.latest[room] = summary
        await self.hub.broadcast(
            {"type": "summary", "room": room, "summary": summary}, room=room
        )
        return summary


STRUCTURED = ("topics", "decisions", "actions", "questions")


def _dicts(value: object) -> list[dict]:
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []
