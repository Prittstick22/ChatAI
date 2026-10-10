"""Invisible AI nudges: after people stop typing for a moment, ask the AI service whether
the newest messages contain a plan or an open choice, and push any proposal into the
room as a `nudge` event. The web app shows it as a card in the conversation.

main.post_message schedules after_message() as a background task once a message is
saved and broadcast, so it never delays sending. The AI never writes to the database:
a person approves any poll or calendar event.

When the group changes a plan, the AI proposes the event again with the new time and
cites the earlier messages too; when someone adds an option, the poll comes back with
it. A proposal that shares a source message with one of the same type already shown
replaces it: it carries `replaces` (the old proposal id), and an event also carries
`previous_start_at`, so the card can say what moved.
"""

import asyncio
import os
from collections.abc import Awaitable, Callable

import store
from realtime import Hub

Ask = Callable[[str, dict, dict], Awaitable[dict]]

CONTEXT = 40  # messages sent to the AI for context


class Nudger:
    def __init__(self, hub: Hub, ask: Ask):
        self.hub = hub
        self.ask = ask
        # Wait this long after a message for the room to go quiet, so a burst of
        # messages is analysed once.
        self.debounce = float(os.getenv("NUDGE_DEBOUNCE", "2.5"))
        self.latest: dict[str, int] = {}  # room -> newest message id seen
        self.analysed: dict[str, int] = {}  # room -> highest id already analysed
        self.sent: dict[str, set[str]] = {}  # room -> proposal ids already pushed
        self.shown: dict[str, list[dict]] = {}  # room -> proposals on screen
        self.locks: dict[str, asyncio.Lock] = {}

    async def after_message(self, message: dict) -> None:
        room, message_id = message["room"], message["id"]
        self.latest[room] = max(self.latest.get(room, 0), message_id)
        # Only messages from now on count as new: after a restart, older history is
        # context, so the seeded demo chat doesn't produce stale nudges.
        self.analysed.setdefault(room, message_id - 1)
        await asyncio.sleep(self.debounce)
        if self.latest.get(room) != message_id:
            return  # a newer message will run the analysis
        async with self.locks.setdefault(room, asyncio.Lock()):
            await self._analyse(room)

    def forget(self, room: str | None = None) -> None:
        """Drop what's known about a room (every room by default) once its messages
        are replaced (devtools.py)."""
        for state in (self.latest, self.analysed, self.sent, self.shown):
            if room is None:
                state.clear()
            else:
                state.pop(room, None)

    async def _analyse(self, room: str) -> None:
        history = store.recent_for_ai(room, CONTEXT)
        since = self.analysed.get(room, 0)
        fresh = [m for m in history if m["id"] > since]
        if not fresh:
            return
        self.analysed[room] = fresh[-1]["id"]
        # A poll message is context: the group already has that poll.
        new_ids = [m["id"] for m in fresh if not m.get("poll_id")]
        if not new_ids:
            return
        result = await self.ask(
            "/suggest",
            {"messages": history, "new_message_ids": new_ids},
            {"proposals": []},
        )
        known = {m["id"] for m in history}
        sent = self.sent.setdefault(room, set())
        for proposal in result.get("proposals") or []:
            if not _valid(proposal, known) or proposal["id"] in sent:
                continue
            self._replace_earlier(room, proposal)
            sent.add(proposal["id"])
            await self.hub.broadcast(
                {"type": "nudge", "room": room, "nudge": proposal}, room=room
            )

    def _replace_earlier(self, room: str, proposal: dict) -> None:
        shown = self.shown.setdefault(room, [])
        cited = set(proposal["source_message_ids"])
        for old in reversed(shown):
            if old["type"] == proposal["type"] and cited & set(
                old["source_message_ids"]
            ):
                proposal["replaces"] = old["id"]
                if proposal["type"] == "event":
                    proposal["previous_start_at"] = old.get("start_at")
                shown.remove(old)
                # The plan may move back to the old time later.
                self.sent[room].discard(old["id"])
                break
        shown.append(proposal)


def _valid(proposal: object, known: set[int]) -> bool:
    """The AI service validates its own output; this only guards the shape the web
    client relies on, since the response crosses a service boundary."""
    if not isinstance(proposal, dict) or not isinstance(proposal.get("id"), str):
        return False
    ids = proposal.get("source_message_ids")
    if not isinstance(ids, list) or not ids or not set(ids) <= known:
        return False
    if proposal.get("type") == "event":
        return isinstance(proposal.get("title"), str) and bool(proposal["title"])
    if proposal.get("type") == "poll":
        options = proposal.get("options")
        return (
            isinstance(proposal.get("question"), str)
            and isinstance(options, list)
            and 2 <= len(options) <= 10
            and all(isinstance(o, str) and o for o in options)
        )
    return False
